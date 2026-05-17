const {
  deleteMeiliPostingsByCanonicalUrls,
  getMeiliConfig,
  searchMeiliPostings,
  upsertMeiliPostings
} = require("../search/meili");
const searchConfig = require("../search/config");
const { getAdapterMetadata } = require("../ingestion/adapter-metadata");
const {
  buildQualityMetadata,
  buildStoredQualityFields,
  parseQualityFlags
} = require("../ingestion/dataQuality");
const {
  getPostgresQualityAudit,
  makeQualitySummary
} = require("../ingestion/dataQualityAudit");
const {
  classifySourceProtection,
  summarizeSourceMetrics
} = require("../ingestion/sourceQualityPolicy");
const {
  normalizeCountryFromLocation,
  normalizeRegionFromCountry,
  normalizeRemoteTypeFromEvidence,
  validatePosting
} = require("../ingestion/posting");
const { evaluatePublicPosting } = require("../ingestion/publicPostingGate");

const DAY_SECONDS = 24 * 60 * 60;
const POSTING_SORT_OPTIONS = new Set(["relevance", "last_seen", "posted_date", "ats_source", "confidence"]);
const POSTING_FRESHNESS_DAY_OPTIONS = new Set([3, 7, 30]);
const PUBLIC_SOURCE_FACET_LIMIT = 8;
const PUBLIC_SOURCE_FACET_FRESH_DAYS = 3;
const POSTING_SORT_OPTION_ITEMS = Object.freeze([
  { value: "relevance", label: "Relevance" },
  { value: "last_seen", label: "Fresh source" },
  { value: "posted_date", label: "Posted date" },
  { value: "ats_source", label: "ATS/source" },
  { value: "confidence", label: "Confidence" }
]);

function getRetentionConfig(env = process.env) {
  return {
    hotDays: Math.max(1, Number(env.OPENJOBSLOTS_POSTING_HOT_DAYS || 90)),
    hiddenRetentionDays: Math.max(1, Number(env.OPENJOBSLOTS_HIDDEN_POSTING_RETENTION_DAYS || 180)),
    cacheMetadataDays: Math.max(1, Number(env.OPENJOBSLOTS_CACHE_METADATA_RETENTION_DAYS || 365)),
    runSummaryDays: Math.max(1, Number(env.OPENJOBSLOTS_INGESTION_RUN_RETENTION_DAYS || 365)),
    detailedErrorDays: Math.max(1, Number(env.OPENJOBSLOTS_INGESTION_ERROR_RETENTION_DAYS || 90)),
    outboxProcessedDays: Math.max(1, Number(env.OPENJOBSLOTS_SEARCH_OUTBOX_PROCESSED_DAYS || 7))
  };
}

function getRetentionCutoffs(referenceEpoch = Math.floor(Date.now() / 1000), config = getRetentionConfig()) {
  const nowEpoch = Number(referenceEpoch || Math.floor(Date.now() / 1000));
  return {
    staleVisibleEpoch: nowEpoch - config.hotDays * DAY_SECONDS,
    hiddenArchiveEpoch: nowEpoch - config.hiddenRetentionDays * DAY_SECONDS,
    cacheArchiveEpoch: nowEpoch - config.cacheMetadataDays * DAY_SECONDS,
    runArchiveEpoch: nowEpoch - config.runSummaryDays * DAY_SECONDS,
    errorArchiveEpoch: nowEpoch - config.detailedErrorDays * DAY_SECONDS,
    outboxProcessedEpoch: nowEpoch - config.outboxProcessedDays * DAY_SECONDS
  };
}

function normalizeText(value) {
  return searchConfig.normalizeText(value);
}

function cleanSearchToken(value) {
  return String(value || "")
    .trim()
    .replace(/^[`"“”'‘’]+|[`"“”'‘’]+$/g, "")
    .replace(/[“”]/g, "")
    .trim();
}

function inferCountry(location) {
  return normalizeCountryFromLocation(location);
}

function inferRegion(country) {
  return normalizeRegionFromCountry(country);
}

function inferRemoteType(location) {
  return normalizeRemoteTypeFromEvidence(location, location);
}

function normalizeAtsKey(value) {
  return searchConfig.normalizeAtsKey(value);
}

function parseCsv(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePostingSort(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized === "recent" || normalized === "fresh_source" || normalized === "lastseen") return "last_seen";
  if (normalized === "posted" || normalized === "posted_at") return "posted_date";
  if (normalized === "ats" || normalized === "source" || normalized === "company_asc" || normalized === "alphabetical") {
    return "ats_source";
  }
  if (normalized === "quality" || normalized === "quality_score" || normalized === "confidence_score") return "confidence";
  return POSTING_SORT_OPTIONS.has(normalized) ? normalized : "relevance";
}

function normalizeFreshnessDays(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  const rounded = Math.floor(numberValue);
  return POSTING_FRESHNESS_DAY_OPTIONS.has(rounded) ? rounded : null;
}

function getPublicPostingSortOptions() {
  return POSTING_SORT_OPTION_ITEMS.map((option) => ({ ...option }));
}

const COUNTRY_FILTER_ALIASES = new Map([
  ["us", "United States"],
  ["usa", "United States"],
  ["u.s.", "United States"],
  ["u.s.a.", "United States"],
  ["united states", "United States"],
  ["united states of america", "United States"],
  ["uk", "United Kingdom"],
  ["u.k.", "United Kingdom"],
  ["gb", "United Kingdom"],
  ["great britain", "United Kingdom"],
  ["turkiye", "Turkey"],
  ["türkiye", "Turkey"],
  ["turkey", "Turkey"],
  ["turkish", "Turkey"],
  ["ca", "Canada"],
  ["can", "Canada"],
  ["canada", "Canada"],
  ["de", "Germany"],
  ["deutschland", "Germany"],
  ["germany", "Germany"],
  ["fr", "France"],
  ["france", "France"]
]);

const REGION_FILTER_ALIASES = new Map([
  ["amer", "North America"],
  ["americas", "North America"],
  ["america", "North America"],
  ["north america", "North America"],
  ["na", "North America"],
  ["northamerica", "North America"],
  ["emea", "EMEA"],
  ["europe", "EMEA"],
  ["europe middle east africa", "EMEA"],
  ["apac", "APAC"],
  ["asia pacific", "APAC"]
]);

const COUNTRY_LOCATION_FALLBACK_TERMS_BY_LABEL = new Map([
  ["Turkey", ["turkey", "turkiye", "t\u00fcrkiye", "turkish", "istanbul", "ankara", "izmir", "bodrum", "antalya", "bursa", "gebze", "kocaeli"]],
  ["United States", ["united states", "united states of america", "usa", "u.s.", "u.s.a.", "new york", "california", "texas"]],
  ["United Kingdom", ["united kingdom", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "london"]],
  ["Canada", ["canada", "toronto", "vancouver"]],
  ["Germany", ["germany", "deutschland", "berlin"]],
  ["France", ["france", "paris"]]
]);

const REMOTE_LOCATION_FALLBACK_TERMS_BY_TYPE = Object.freeze({
  remote: ["remote", "work from home", "work from anywhere", "wfh", "anywhere", "home based", "telecommute", "telework", "virtual"],
  hybrid: ["hybrid"],
  onsite: ["onsite", "on site", "on-site", "office based", "in office"]
});

function normalizeCountryFilterValue(value) {
  return searchConfig.normalizeCountryFilterValue(value);
}

function normalizeRegionFilterValue(value) {
  return searchConfig.normalizeRegionFilterValue(value);
}

function uniqueNormalizedTerms(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const term = String(value || "").trim();
    const normalized = normalizeText(term).replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(term);
  }
  return result;
}

function getCountryFilterTerms(countryLabel) {
  return searchConfig.getCountryFilterTerms(countryLabel);
}

function getRemoteLocationFallbackTerms(remoteType) {
  return searchConfig.getRemoteLocationFallbackTerms(remoteType);
}

const SEARCH_STOP_WORDS = new Set([
  "job",
  "jobs",
  "posting",
  "postings",
  "opening",
  "openings",
  "career",
  "careers",
  "role",
  "roles",
  "position",
  "positions"
]);

const SEARCH_TOKEN_ALIASES = {
  turkish: ["turkey", "turkiye", "t\u00fcrkiye", "istanbul", "ankara"],
  turkiye: ["turkey", "t\u00fcrkiye", "turkish", "istanbul", "ankara"],
  turkey: ["turkiye", "t\u00fcrkiye", "turkish", "istanbul", "ankara"],
  turkyie: ["turkey", "turkiye", "t\u00fcrkiye", "turkish"],
  turksih: ["turkey", "turkiye", "t\u00fcrkiye", "turkish"],
  remote: ["work from home", "wfh", "anywhere"],
  wfh: ["remote", "work from home"],
  hybrid: ["remote"],
  usa: ["united states", "u.s.", "u.s.a."],
  us: ["united states", "usa", "u.s."],
  uk: ["united kingdom", "england", "london"]
};

function expandSearchTokens(search) {
  return searchConfig.expandSearchTokens(search);
}

function rowToPosting(row) {
  const location = String(row?.location_text || "");
  const country = String(row?.country || inferCountry(location)).trim();
  const region = String(row?.region || inferRegion(country)).trim();
  const remoteEvidence = [row?.location_text, row?.position_name].map((item) => String(item || "").trim()).filter(Boolean).join(" ");
  const storedRemoteType = normalizeRemoteTypeFromEvidence(row?.remote_type, "");
  const remoteType = storedRemoteType === "unknown" ? inferRemoteType(remoteEvidence) : storedRemoteType;
  return {
    id: Number(row?.id || 0),
    company_name: String(row?.company_name || ""),
    position_name: String(row?.position_name || ""),
    job_posting_url: String(row?.canonical_url || ""),
    location: location || null,
    city: String(row?.city || ""),
    country,
    region,
    remote_type: remoteType,
    department: String(row?.department || ""),
    employment_type: String(row?.employment_type || ""),
    description_plain: String(row?.description_plain || ""),
    posting_date: row?.posting_date || null,
    last_seen_epoch: Number(row?.last_seen_epoch || 0),
    ats: String(row?.ats_key || ""),
    applied: Boolean(row?.applied),
    ignored: Boolean(row?.ignored),
    applied_by_type: String(row?.applied_by_type || ""),
    applied_by_label: String(row?.applied_by_label || ""),
    applied_at_epoch: Number(row?.applied_at_epoch || 0),
    last_application_id: Number(row?.last_application_id || 0),
    ignored_at_epoch: Number(row?.ignored_at_epoch || 0),
    ignored_by_label: String(row?.ignored_by_label || "")
  };
}

function buildFilterSql(options, startIndex = 1) {
  const where = ["p.hidden = false"];
  const values = [];
  let index = startIndex;
  const add = (sql, value) => {
    where.push(sql.replace(/\?/g, `$${index}`));
    values.push(value);
    index += 1;
  };
  const addIn = (field, items) => {
    const valuesList = (Array.isArray(items) ? items : []).map((item) => String(item || "").trim()).filter(Boolean);
    if (valuesList.length === 0) return;
    const placeholders = valuesList.map(() => `$${index++}`);
    where.push(`${field} IN (${placeholders.join(", ")})`);
    values.push(...valuesList);
  };
  const addLocationLikeClauses = (terms) => {
    const clauses = [];
    for (const term of uniqueNormalizedTerms(terms)) {
      clauses.push(`lower(unaccent(coalesce(p.location_text, ''))) LIKE lower(unaccent($${index}))`);
      values.push(`%${term}%`);
      index += 1;
    }
    return clauses;
  };
  const addCountryFilters = (items) => {
    const labels = uniqueNormalizedTerms(items.map(normalizeCountryFilterValue));
    if (labels.length === 0) return;
    const countryClauses = [];
    const locationFallbackClauses = [];
    for (const label of labels) {
      for (const term of getCountryFilterTerms(label)) {
        countryClauses.push(`lower(unaccent(coalesce(p.country, ''))) = lower(unaccent($${index}))`);
        values.push(term);
        index += 1;
      }
      locationFallbackClauses.push(...addLocationLikeClauses(getCountryFilterTerms(label)));
    }
    const clauses = [];
    if (countryClauses.length > 0) clauses.push(`(${countryClauses.join(" OR ")})`);
    if (locationFallbackClauses.length > 0) {
      clauses.push(`((p.country IS NULL OR btrim(p.country) = '') AND (${locationFallbackClauses.join(" OR ")}))`);
    }
    if (clauses.length > 0) where.push(`(${clauses.join(" OR ")})`);
  };
  const unknownRemoteSql = "(p.remote_type IS NULL OR btrim(p.remote_type) = '' OR p.remote_type = 'unknown')";
  const addRemoteFilter = (remoteType) => {
    const clauses = [`p.remote_type = $${index}`];
    values.push(remoteType);
    index += 1;
    const locationFallbackClauses = addLocationLikeClauses(getRemoteLocationFallbackTerms(remoteType));
    if (locationFallbackClauses.length > 0) {
      clauses.push(`(${unknownRemoteSql} AND (${locationFallbackClauses.join(" OR ")}))`);
    }
    where.push(`(${clauses.join(" OR ")})`);
  };

  const ats = parseCsv(options.ats).map(normalizeAtsKey);
  const countries = parseCsv(options.countries).map(normalizeCountryFilterValue);
  const regions = parseCsv(options.regions).map(normalizeRegionFilterValue);
  const industries = parseCsv(options.industries);
  const remote = String(options.remote || "all").trim().toLowerCase();
  addIn("p.ats_key", ats);
  addCountryFilters(countries);
  addIn("p.region", regions);
  addIn("p.industry", industries);
  if (remote === "remote" || remote === "hybrid" || remote === "onsite") addRemoteFilter(remote);
  if (remote === "non_remote") {
    const remoteLikeClauses = addLocationLikeClauses([
      ...getRemoteLocationFallbackTerms("remote"),
      ...getRemoteLocationFallbackTerms("hybrid")
    ]);
    where.push(
      remoteLikeClauses.length > 0
        ? `(p.remote_type NOT IN ('remote', 'hybrid') AND NOT (${unknownRemoteSql} AND (${remoteLikeClauses.join(" OR ")})))`
        : "p.remote_type NOT IN ('remote', 'hybrid')"
    );
  }
  if (options.hide_no_date) where.push("p.posting_date IS NOT NULL AND btrim(p.posting_date) <> ''");
  const freshnessDays = normalizeFreshnessDays(options.freshness_days);
  if (freshnessDays) {
    where.push(`COALESCE(p.last_seen_epoch, 0) >= $${index}`);
    values.push(Math.floor(Date.now() / 1000) - freshnessDays * DAY_SECONDS);
    index += 1;
  }
  if (!options.include_applied) where.push("COALESCE(s.applied, false) = false");
  if (!options.include_ignored) where.push("COALESCE(s.ignored, false) = false");

  for (const aliases of expandSearchTokens(options.search)) {
    const clauses = [];
    for (const alias of aliases) {
      clauses.push(
        `(lower(unaccent(p.company_name)) LIKE lower(unaccent($${index})) OR lower(unaccent(p.position_name)) LIKE lower(unaccent($${index})) OR lower(unaccent(coalesce(p.location_text, ''))) LIKE lower(unaccent($${index})) OR lower(unaccent(p.country)) LIKE lower(unaccent($${index})) OR lower(unaccent(p.region)) LIKE lower(unaccent($${index})) OR lower(unaccent(p.remote_type)) LIKE lower(unaccent($${index})))`
      );
      values.push(`%${alias}%`);
      index += 1;
    }
    if (clauses.length > 0) where.push(`(${clauses.join(" OR ")})`);
  }

  return { where, values, nextIndex: index };
}

function getPostgresOrderBy(sortBy) {
  if (sortBy === "posted_date") {
    return "COALESCE(p.posted_at_epoch, 0) DESC, p.last_seen_epoch DESC, p.canonical_url ASC";
  }
  if (sortBy === "ats_source") {
    return "lower(p.ats_key) ASC, lower(p.company_name) ASC, lower(p.position_name) ASC, p.last_seen_epoch DESC, p.canonical_url ASC";
  }
  if (sortBy === "confidence") {
    return "COALESCE(p.confidence, 0) DESC, COALESCE(p.quality_score, 0) DESC, p.last_seen_epoch DESC, p.canonical_url ASC";
  }
  return "p.last_seen_epoch DESC, p.canonical_url";
}

function buildSearchRankSql(search, startIndex = 1) {
  const normalizedQuery = searchConfig.normalizeSearchQuery(search);
  if (!normalizedQuery) {
    return { sql: "", values: [], nextIndex: startIndex };
  }
  const queryIndex = startIndex;
  const likeQuery = `%${normalizedQuery}%`;
  return {
    sql: `
      CASE
        WHEN lower(unaccent(p.position_name)) LIKE lower(unaccent($${queryIndex})) THEN 40
        WHEN lower(unaccent(p.company_name)) LIKE lower(unaccent($${queryIndex})) THEN 30
        WHEN lower(unaccent(coalesce(p.location_text, ''))) LIKE lower(unaccent($${queryIndex}))
          OR lower(unaccent(coalesce(p.city, ''))) LIKE lower(unaccent($${queryIndex}))
          OR lower(unaccent(coalesce(p.country, ''))) LIKE lower(unaccent($${queryIndex}))
          OR lower(unaccent(coalesce(p.region, ''))) LIKE lower(unaccent($${queryIndex})) THEN 20
        WHEN lower(unaccent(coalesce(p.ats_key, ''))) LIKE lower(unaccent($${queryIndex})) THEN 10
        WHEN lower(unaccent(coalesce(p.description_plain, ''))) LIKE lower(unaccent($${queryIndex})) THEN 5
        ELSE 0
      END
    `,
    values: [likeQuery],
    nextIndex: startIndex + 1
  };
}

function logSearchFallback(reason, metadata = {}) {
  console.warn("[openjobslots] search_backend_fallback", JSON.stringify({
    reason,
    search_backend: "meili",
    fallback_backend: "postgres",
    ...metadata
  }));
}

async function hydratePostgresPostings(pool, urls, options = {}) {
  const canonicalUrls = (Array.isArray(urls) ? urls : []).map((url) => String(url || "").trim()).filter(Boolean);
  if (canonicalUrls.length === 0) return [];
  const filter = buildFilterSql(options, 2);
  const result = await pool.query(
    `
      SELECT
        row_number() OVER (ORDER BY p.last_seen_epoch DESC, p.canonical_url) AS id,
        p.*,
        COALESCE(s.applied, false) AS applied,
        COALESCE(s.ignored, false) AS ignored,
        s.applied_by_type,
        s.applied_by_label,
        s.applied_at_epoch,
        s.last_application_id,
        s.ignored_at_epoch,
        s.ignored_by_label
      FROM postings p
      LEFT JOIN posting_application_state s
        ON s.canonical_url = p.canonical_url
      WHERE p.canonical_url = ANY($1)
        AND ${filter.where.join(" AND ")};
    `,
    [canonicalUrls, ...filter.values]
  );
  const byUrl = new Map(result.rows.map((row) => [String(row.canonical_url), rowToPosting(row)]));
  return canonicalUrls.map((url) => byUrl.get(url)).filter(Boolean);
}

async function countPostgresPostingsSql(pool, options = {}) {
  const filter = buildFilterSql(options, 1);
  const result = await pool.query(
    `
      SELECT COUNT(*)::int AS count
      FROM postings p
      LEFT JOIN posting_application_state s
        ON s.canonical_url = p.canonical_url
      WHERE ${filter.where.join(" AND ")};
    `,
    filter.values
  );
  if (Object.prototype.hasOwnProperty.call(result.rows[0] || {}, "count")) {
    return Number(result.rows[0]?.count || 0);
  }
  return Array.isArray(result.rows) ? result.rows.length : 0;
}

function sanitizePostgresSourceFacetItem(row = {}) {
  const value = normalizeAtsKey(row.value || row.ats_key || "") || "unknown";
  const count = Math.max(0, Number(row.count || 0));
  const freshCount = Math.max(0, Math.min(count, Number(row.fresh_count || 0)));
  return {
    value,
    label: value === "unknown" ? "Unknown source" : value,
    count,
    avg_confidence: Math.round((Number(row.avg_confidence || 0) || 0) * 100) / 100,
    avg_quality: Math.round((Number(row.avg_quality || 0) || 0) * 10) / 10,
    latest_seen_epoch: Math.max(0, Number(row.latest_seen_epoch || 0)),
    fresh_count: freshCount,
    fresh_percentage: count > 0 ? Math.round((freshCount / count) * 100) : 0
  };
}

async function getPostgresSourceFacets(pool, options = {}, limit = PUBLIC_SOURCE_FACET_LIMIT) {
  const filter = buildFilterSql(options, 1);
  const freshCutoffIndex = filter.nextIndex;
  const limitIndex = filter.nextIndex + 1;
  const result = await pool.query(
    `
      SELECT
        COALESCE(NULLIF(btrim(p.ats_key), ''), 'unknown') AS value,
        COUNT(*)::int AS count,
        COALESCE(AVG(COALESCE(p.confidence, 0)), 0)::float AS avg_confidence,
        COALESCE(AVG(COALESCE(p.quality_score, 0)), 0)::float AS avg_quality,
        COALESCE(MAX(COALESCE(p.last_seen_epoch, 0)), 0)::bigint AS latest_seen_epoch,
        SUM(
          CASE
            WHEN COALESCE(p.last_seen_epoch, 0) >= $${freshCutoffIndex} THEN 1
            ELSE 0
          END
        )::int AS fresh_count
      FROM postings p
      LEFT JOIN posting_application_state s
        ON s.canonical_url = p.canonical_url
      WHERE ${filter.where.join(" AND ")}
      GROUP BY COALESCE(NULLIF(btrim(p.ats_key), ''), 'unknown')
      ORDER BY count DESC, value ASC
      LIMIT $${limitIndex};
    `,
    [
      ...filter.values,
      Math.floor(Date.now() / 1000) - PUBLIC_SOURCE_FACET_FRESH_DAYS * DAY_SECONDS,
      Math.max(1, Math.min(20, Number(limit || PUBLIC_SOURCE_FACET_LIMIT)))
    ]
  );
  return (Array.isArray(result.rows) ? result.rows : []).map(sanitizePostgresSourceFacetItem);
}

async function listPostgresPostingsSql(pool, options = {}, limit = 500, offset = 0, sortBy = "recent") {
  const filter = buildFilterSql(options, 1);
  const rank = sortBy === "relevance"
    ? buildSearchRankSql(options.search, filter.nextIndex)
    : { sql: "", values: [], nextIndex: filter.nextIndex };
  const limitIndex = rank.nextIndex;
  const offsetIndex = rank.nextIndex + 1;
  const orderBy = getPostgresOrderBy(sortBy);
  const rankedOrderBy = rank.sql ? `${rank.sql} DESC, ${orderBy}` : orderBy;
  const [count, sourceFacets, result] = await Promise.all([
    countPostgresPostingsSql(pool, options),
    getPostgresSourceFacets(pool, options),
    pool.query(
      `
        SELECT
          row_number() OVER (ORDER BY ${rankedOrderBy}) AS id,
          p.*,
          COALESCE(s.applied, false) AS applied,
          COALESCE(s.ignored, false) AS ignored,
          s.applied_by_type,
          s.applied_by_label,
          s.applied_at_epoch,
          s.last_application_id,
          s.ignored_at_epoch,
          s.ignored_by_label
        FROM postings p
        LEFT JOIN posting_application_state s
          ON s.canonical_url = p.canonical_url
        WHERE ${filter.where.join(" AND ")}
        ORDER BY ${rankedOrderBy}
        LIMIT $${limitIndex} OFFSET $${offsetIndex};
      `,
      [...filter.values, ...rank.values, limit, offset]
    )
  ]);
  return {
    items: result.rows.map(rowToPosting).slice(0, limit),
    count,
    count_exact: true,
    source_facets: sourceFacets,
    limit,
    offset,
    filters: {
      search: String(options.search || "").trim(),
      sort_by: sortBy,
      freshness_days: normalizeFreshnessDays(options.freshness_days),
      ats: parseCsv(options.ats).map(normalizeAtsKey),
      countries: parseCsv(options.countries).map(normalizeCountryFilterValue),
      regions: parseCsv(options.regions),
      industries: parseCsv(options.industries),
      remote: String(options.remote || "all").trim().toLowerCase() || "all",
      hide_no_date: Boolean(options.hide_no_date),
      include_ignored: Boolean(options.include_ignored)
    }
  };
}

async function listPostgresPostings(pool, options = {}) {
  const limit = Math.max(1, Math.min(2000, Number(options.limit || 500)));
  const offset = Math.max(0, Number(options.offset || 0));
  const meiliConfig = getMeiliConfig();
  const sortBy = normalizePostingSort(options.sort_by);
  const meiliSortable = sortBy === "relevance" || sortBy === "last_seen" || sortBy === "posted_date";
  const useMeili = meiliConfig.enabled && meiliSortable && offset + limit <= 2000 && (String(options.search || "").trim() || parseCsv(options.ats).length || parseCsv(options.countries).length || parseCsv(options.regions).length || parseCsv(options.industries).length || String(options.remote || "all") !== "all" || normalizeFreshnessDays(options.freshness_days));

  if (useMeili) {
    try {
      const searchLimit = Math.min(2000, offset + Math.max(limit * 3, limit + 100));
      const normalizedOptions = { ...options, sort_by: sortBy, limit: searchLimit, offset: 0 };
      const searchResult = await searchMeiliPostings(normalizedOptions, meiliConfig);
      const urls = (searchResult.hits || []).map((hit) => hit.canonical_url);
      if (urls.length === 0 && Number(searchResult.estimatedTotalHits || 0) === 0) {
        return {
          items: [],
          count: 0,
          count_exact: false,
          source_facets: [],
          limit,
          offset,
          filters: {
            search: String(options.search || "").trim(),
            sort_by: sortBy,
            freshness_days: normalizeFreshnessDays(options.freshness_days),
            ats: parseCsv(options.ats).map(normalizeAtsKey),
            countries: parseCsv(options.countries).map(normalizeCountryFilterValue),
            regions: parseCsv(options.regions),
            industries: parseCsv(options.industries),
            remote: String(options.remote || "all").trim().toLowerCase() || "all",
            hide_no_date: Boolean(options.hide_no_date),
            include_ignored: Boolean(options.include_ignored)
          }
        };
      }
      const hydratedItems = await hydratePostgresPostings(pool, urls, options);
      const items = hydratedItems.slice(offset, offset + limit);
      const estimatedTotalHits = Number(searchResult.estimatedTotalHits || 0);
      const loadedThrough = offset + items.length;
      const hydrationDroppedHits = hydratedItems.length < urls.length;
      const pageUnderfilled = items.length < limit && estimatedTotalHits > loadedThrough;
      const hydrationUnderfilledPage = hydrationDroppedHits && hydratedItems.length < offset + limit;
      if (pageUnderfilled || hydrationUnderfilledPage) {
        logSearchFallback("hydration_underfill", {
          limit,
          offset,
          search_limit: searchLimit,
          meili_hits: urls.length,
          meili_estimated_total_hits: estimatedTotalHits,
          hydrated_hits: hydratedItems.length,
          page_items: items.length,
          filters: {
            search: Boolean(String(options.search || "").trim()),
            ats: parseCsv(options.ats).length,
            countries: parseCsv(options.countries).length,
            regions: parseCsv(options.regions).length,
            industries: parseCsv(options.industries).length,
            remote: String(options.remote || "all"),
            hide_no_date: Boolean(options.hide_no_date)
          }
        });
        return listPostgresPostingsSql(pool, options, limit, offset, sortBy);
      }
      const [count, sourceFacets] = await Promise.all([
        countPostgresPostingsSql(pool, { ...options, sort_by: sortBy }),
        getPostgresSourceFacets(pool, { ...options, sort_by: sortBy })
      ]);
      return {
        items: items.slice(0, limit),
        count,
        count_exact: true,
        source_facets: sourceFacets,
        limit,
        offset,
        filters: {
          search: String(options.search || "").trim(),
          sort_by: sortBy,
          freshness_days: normalizeFreshnessDays(options.freshness_days),
          ats: parseCsv(options.ats).map(normalizeAtsKey),
          countries: parseCsv(options.countries).map(normalizeCountryFilterValue),
          regions: parseCsv(options.regions),
          industries: parseCsv(options.industries),
          remote: String(options.remote || "all").trim().toLowerCase() || "all",
          hide_no_date: Boolean(options.hide_no_date),
          include_ignored: Boolean(options.include_ignored)
        }
      };
    } catch (error) {
      logSearchFallback("meili_error", {
        limit,
        offset,
        error: String(error?.message || error).slice(0, 240)
      });
    }
  }

  return listPostgresPostingsSql(pool, options, limit, offset, sortBy);
}

async function getPostgresCounts(pool) {
  const [companyRow, syncCompanyRow, enabledAtsRow, postingRow, seenRow, atsRows] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM companies;"),
    pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM companies c
        INNER JOIN ats_sources s
          ON s.ats_key = c.ats_key
        WHERE s.enabled = true;
      `
    ),
    pool.query("SELECT COUNT(*)::int AS count FROM ats_sources WHERE enabled = true;"),
    pool.query("SELECT COUNT(*)::int AS count FROM postings WHERE hidden = false;"),
    pool.query("SELECT COUNT(*)::int AS count FROM postings WHERE hidden = false AND last_seen_epoch >= $1;", [
      Math.floor(Date.now() / 1000) - 24 * 60 * 60
    ]),
    pool.query("SELECT ats_key, COUNT(*)::int AS count FROM companies GROUP BY ats_key;")
  ]);
  const company_count_by_ats = {};
  for (const row of atsRows.rows) company_count_by_ats[row.ats_key || "Unknown"] = Number(row.count || 0);
  return {
    company_count: Number(companyRow.rows[0]?.count || 0),
    sync_enabled_company_count: Number(syncCompanyRow.rows[0]?.count || 0),
    configured_enabled_ats_count: Number(enabledAtsRow.rows[0]?.count || 0),
    posting_count: Number(postingRow.rows[0]?.count || 0),
    postings_seen_24h_count: Number(seenRow.rows[0]?.count || 0),
    company_count_by_ats
  };
}

async function getPostgresFilterOptions(pool, atsItems = [], options = {}) {
  const filter = buildFilterSql(options, 1);
  const values = filter.values;
  const [sourceRows, countryRows, regionRows, industryRows] = await Promise.all([
    pool.query(
      `
        SELECT
          COALESCE(NULLIF(btrim(p.ats_key), ''), 'unknown') AS ats_key,
          COALESCE(MAX(a.display_name), COALESCE(NULLIF(btrim(p.ats_key), ''), 'unknown')) AS display_name,
          COALESCE(bool_or(a.enabled), true) AS enabled,
          COUNT(*)::int AS count
        FROM postings p
        LEFT JOIN posting_application_state s
          ON s.canonical_url = p.canonical_url
        LEFT JOIN ats_sources a
          ON a.ats_key = p.ats_key
        WHERE ${filter.where.join(" AND ")}
        GROUP BY COALESCE(NULLIF(btrim(p.ats_key), ''), 'unknown')
        ORDER BY count DESC, display_name ASC
        LIMIT 100;
      `,
      values
    ),
    pool.query(
      `
        SELECT p.country AS value, p.country AS label, p.region, COUNT(*)::int AS count
        FROM postings p
        LEFT JOIN posting_application_state s
          ON s.canonical_url = p.canonical_url
        WHERE ${filter.where.join(" AND ")}
          AND p.country <> ''
        GROUP BY p.country, p.region
        ORDER BY count DESC, p.country ASC
        LIMIT 250;
      `,
      values
    ),
    pool.query(
      `
        SELECT p.region AS value, p.region AS label, COUNT(*)::int AS count
        FROM postings p
        LEFT JOIN posting_application_state s
          ON s.canonical_url = p.canonical_url
        WHERE ${filter.where.join(" AND ")}
          AND p.region <> ''
        GROUP BY p.region
        ORDER BY count DESC, p.region ASC
        LIMIT 80;
      `,
      values
    ),
    pool.query(
      `
        SELECT p.industry AS value, p.industry AS label, COUNT(*)::int AS count
        FROM postings p
        LEFT JOIN posting_application_state s
          ON s.canonical_url = p.canonical_url
        WHERE ${filter.where.join(" AND ")}
          AND p.industry <> ''
        GROUP BY p.industry
        ORDER BY count DESC, p.industry ASC
        LIMIT 300;
      `,
      values
    )
  ]);
  const labels = new Map(atsItems.map((item) => [String(item.value), String(item.label)]));
  return {
    ats: sourceRows.rows.map((row) => ({
      value: row.ats_key,
      label: row.display_name || labels.get(row.ats_key) || row.ats_key,
      enabled: Boolean(row.enabled),
      count: Number(row.count || 0)
    })),
    sort_options: getPublicPostingSortOptions(),
    industries: industryRows.rows,
    regions: regionRows.rows,
    countries: countryRows.rows,
    states: [],
    counties: []
  };
}

function normalizePostgresSuggestionFilter(filter = {}, atsItems = []) {
  const source = filter && typeof filter === "object" ? filter : {};
  const atsOptions = new Set((atsItems || []).map((item) => normalizeAtsKey(item?.value || item?.label)).filter(Boolean));
  const patch = {};
  const remote = String(source.remote || "").trim().toLowerCase();
  if (["remote", "hybrid", "non_remote"].includes(remote)) {
    patch.remote = remote;
  }
  const freshnessDays = Number(source.freshness_days || source.freshnessDays || 0);
  if ([3, 7, 30].includes(freshnessDays)) {
    patch.freshness_days = freshnessDays;
  }
  const ats = normalizeAtsKey(source.ats || source.source || "");
  if (ats && (atsOptions.size === 0 || atsOptions.has(ats))) {
    patch.ats = ats;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function normalizedSuggestionContainsTerm(text, term) {
  const normalizedText = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  if (!normalizedText || !normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalizedText)) return true;
  return normalizedTerm.length >= 4 && normalizedText.includes(normalizedTerm);
}

async function getPostgresSuggestions(pool, search, limit = 8, atsItems = []) {
  const query = String(search || "").trim();
  const resolvedLimit = Math.max(1, Math.min(20, Number(limit || 8)));
  const suggestions = [];
  const seen = new Set();
  const add = (type, value, count = 1, extras = {}) => {
    const suggestionValue = String(value || extras.label || "").trim();
    const label = String(extras.label || value || "").trim();
    const suggestionType = String(type || "search").trim().toLowerCase() || "search";
    const intentType = String(extras.intent_type || "").trim().toLowerCase();
    const key = `${suggestionType}:${normalizeText(suggestionValue)}:${intentType}`;
    if (!suggestionValue || !label || seen.has(key)) return;
    seen.add(key);
    const suggestion = { type: suggestionType, value: suggestionValue, label, count: Number(count || 1) };
    const filter = normalizePostgresSuggestionFilter(extras.filter, atsItems);
    if (intentType) suggestion.intent_type = intentType;
    if (filter) suggestion.filter = filter;
    suggestions.push(suggestion);
  };
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length >= 2) {
    if (normalizedSuggestionContainsTerm(normalizedQuery, "remote") || normalizedSuggestionContainsTerm(normalizedQuery, "wfh") || normalizedQuery.includes("work from home")) {
      add("intent", "remote", 1, { label: "Remote", intent_type: "remote", filter: { remote: "remote" } });
    }
    if (normalizedSuggestionContainsTerm(normalizedQuery, "hybrid")) {
      add("intent", "hybrid", 1, { label: "Hybrid", intent_type: "hybrid", filter: { remote: "hybrid" } });
    }
    if (normalizedSuggestionContainsTerm(normalizedQuery, "onsite") || normalizedQuery.includes("on site") || normalizedQuery.includes("in office")) {
      add("intent", "onsite", 1, { label: "On-site", intent_type: "onsite", filter: { remote: "non_remote" } });
    }
    if (/(^|\s)(last|past|within)\s+3\s+(days?|d)(\s|$)/.test(normalizedQuery) || /(^|\s)3\s+(days?|d)(\s|$)/.test(normalizedQuery) || /(^|\s)3d(\s|$)/.test(normalizedQuery)) {
      add("intent", "3", 1, { label: "Last 3 days", intent_type: "freshness", filter: { freshness_days: 3 } });
    }
    for (const item of atsItems || []) {
      const value = normalizeAtsKey(item?.value || item?.label || "");
      const label = String(item?.label || item?.value || "").trim();
      if (!value || !label) continue;
      if (normalizedSuggestionContainsTerm(normalizedQuery, value) || normalizedSuggestionContainsTerm(normalizedQuery, label)) {
        add("source", value, Number(item?.count || 1), { label, intent_type: "source", filter: { ats: value } });
      }
    }
  }
  for (const alias of ["remote jobs", "turkish jobs", "t\u00fcrkiye", "turkiye", "turkey"]) {
    if (!query || normalizeText(alias).includes(normalizeText(query))) add("shortcut", alias);
  }
  if (query && suggestions.length < resolvedLimit) {
    const pattern = `%${query}%`;
    const rows = await pool.query(
      `
        SELECT 'title' AS type, position_name AS value, COUNT(*)::int AS count FROM postings
        WHERE hidden = false AND lower(unaccent(position_name)) LIKE lower(unaccent($1)) GROUP BY position_name
        UNION ALL
        SELECT 'company' AS type, company_name AS value, COUNT(*)::int AS count FROM postings
        WHERE hidden = false AND lower(unaccent(company_name)) LIKE lower(unaccent($1)) GROUP BY company_name
        UNION ALL
        SELECT 'location' AS type, location_text AS value, COUNT(*)::int AS count FROM postings
        WHERE hidden = false AND location_text IS NOT NULL AND lower(unaccent(location_text)) LIKE lower(unaccent($1)) GROUP BY location_text
        ORDER BY count DESC
        LIMIT $2;
      `,
      [pattern, Math.max(resolvedLimit, 20)]
    );
    for (const row of rows.rows) {
      add(row.type, row.value, row.count);
      if (suggestions.length >= resolvedLimit) break;
    }
  }
  return suggestions.slice(0, resolvedLimit);
}

async function getPostgresParserAttentionByAts(pool, limit = 20) {
  const rows = await pool.query(
    `
      SELECT
        ats_key,
        COUNT(*)::int AS error_count,
        MAX(created_at) AS latest_error_at,
        (
          SELECT e2.error_message
          FROM ingestion_run_errors e2
          WHERE e2.ats_key = ingestion_run_errors.ats_key
            AND e2.error_type LIKE 'parser_%'
          ORDER BY e2.id DESC
          LIMIT 1
        ) AS latest_error,
        (
          SELECT jsonb_agg(jsonb_build_object('reason', reason_counts.error_message, 'count', reason_counts.error_count) ORDER BY reason_counts.error_count DESC, reason_counts.error_message ASC)
          FROM (
            SELECT e3.error_message, COUNT(*)::int AS error_count
            FROM ingestion_run_errors e3
            WHERE e3.ats_key = ingestion_run_errors.ats_key
              AND e3.created_at >= now() - interval '24 hours'
              AND e3.error_type LIKE 'parser_%'
            GROUP BY e3.error_message
            ORDER BY error_count DESC, e3.error_message ASC
            LIMIT 5
          ) reason_counts
        ) AS reasons
      FROM ingestion_run_errors
      WHERE created_at >= now() - interval '24 hours'
        AND error_type LIKE 'parser_%'
      GROUP BY ats_key
      ORDER BY error_count DESC, latest_error_at DESC
      LIMIT $1;
    `,
    [Math.max(1, Math.min(100, Number(limit || 20)))]
  );

  return rows.rows.map((row) => ({
    ats_key: String(row?.ats_key || ""),
    error_count: Number(row?.error_count || 0),
    latest_error_at: row?.latest_error_at ? new Date(row.latest_error_at).toISOString() : "",
    latest_error: String(row?.latest_error || ""),
    reasons: Array.isArray(row?.reasons)
      ? row.reasons.map((reason) => ({
          reason: String(reason?.reason || ""),
          count: Number(reason?.count || 0)
        }))
      : []
  }));
}

async function getPostgresAtsAdmin(pool) {
  const rows = await pool.query(
    `
      SELECT
        s.ats_key,
        s.display_name,
        s.enabled,
        s.protection_status,
        s.disabled_reason,
        s.disabled_at,
        s.default_ttl_seconds,
        s.rate_limit_ms,
        MAX(st.last_success_epoch)::bigint AS last_success_epoch,
        MAX(st.last_failure_epoch)::bigint AS last_failure_epoch,
        COUNT(DISTINCT c.id)::int AS company_count
      FROM ats_sources s
      LEFT JOIN companies c
        ON c.ats_key = s.ats_key
      LEFT JOIN company_sync_state st
        ON st.ats_key = s.ats_key
      GROUP BY s.ats_key, s.display_name, s.enabled, s.protection_status, s.disabled_reason, s.disabled_at, s.default_ttl_seconds, s.rate_limit_ms
      ORDER BY s.display_name ASC;
    `
  );
  return rows.rows.map((row) => ({
    ats_key: String(row?.ats_key || ""),
    display_name: String(row?.display_name || ""),
    enabled: Boolean(row?.enabled),
    protection_status: String(row?.protection_status || "normal"),
    disabled_reason: String(row?.disabled_reason || ""),
    disabled_at: row?.disabled_at ? new Date(row.disabled_at).toISOString() : "",
    default_ttl_seconds: Number(row?.default_ttl_seconds || 0),
    rate_limit_ms: Number(row?.rate_limit_ms || 0),
    last_success_epoch: Number(row?.last_success_epoch || 0),
    last_failure_epoch: Number(row?.last_failure_epoch || 0),
    company_count: Number(row?.company_count || 0)
  }));
}

function formatFieldQualityRow(row) {
  const total = Number(row?.total_postings || 0);
  const pct = (value) => total > 0 ? Number(((Number(value || 0) / total) * 100).toFixed(2)) : 0;
  const missingCountry = Number(row?.missing_country_count || 0);
  const missingRegion = Number(row?.missing_region_count || 0);
  const missingCity = Number(row?.missing_city_count || 0);
  const missingRemoteType = Number(row?.missing_remote_type_count || 0);
  const missingPostedAt = Number(row?.missing_posted_at_count || 0);
  const missingDepartment = Number(row?.missing_department_count || 0);
  const missingEmploymentType = Number(row?.missing_employment_type_count || 0);
  const missingDescriptionPlain = Number(row?.missing_description_plain_count || 0);
  return {
    ats_key: String(row?.ats_key || ""),
    total_postings: total,
    missing_country_count: missingCountry,
    missing_country_pct: pct(missingCountry),
    missing_region_count: missingRegion,
    missing_region_pct: pct(missingRegion),
    missing_city_count: missingCity,
    missing_city_pct: pct(missingCity),
    missing_region_or_city_count: Number(row?.missing_region_or_city_count || 0),
    missing_region_or_city_pct: pct(row?.missing_region_or_city_count),
    missing_remote_type_count: missingRemoteType,
    missing_remote_type_pct: pct(missingRemoteType),
    missing_posted_at_count: missingPostedAt,
    missing_posted_at_pct: pct(missingPostedAt),
    missing_department_count: missingDepartment,
    missing_department_pct: pct(missingDepartment),
    missing_employment_type_count: missingEmploymentType,
    missing_employment_type_pct: pct(missingEmploymentType),
    missing_description_plain_count: missingDescriptionPlain,
    missing_description_plain_pct: pct(missingDescriptionPlain),
    parser_attention_count_24h: Number(row?.parser_attention_count_24h || 0),
    impact_score: Number(row?.impact_score || 0)
  };
}

async function getPostgresAtsFieldQualityByAts(pool, atsKeys = []) {
  const keys = Array.isArray(atsKeys)
    ? atsKeys.map((key) => normalizeAtsKey(key)).filter(Boolean)
    : [];
  const params = [];
  const atsClause = keys.length > 0 ? "AND p.ats_key = ANY($1::text[])" : "";
  if (keys.length > 0) params.push(keys);
  const rows = await pool.query(
    `
      WITH parser_attention AS (
        SELECT ats_key, COUNT(*)::int AS parser_attention_count_24h
        FROM ingestion_run_errors
        WHERE created_at >= now() - interval '24 hours'
          AND error_type LIKE 'parser_%'
        GROUP BY ats_key
      )
      SELECT
        p.ats_key,
        COUNT(*)::int AS total_postings,
        COUNT(*) FILTER (WHERE btrim(coalesce(p.country, '')) = '')::int AS missing_country_count,
        COUNT(*) FILTER (WHERE btrim(coalesce(p.region, '')) = '')::int AS missing_region_count,
        COUNT(*) FILTER (WHERE btrim(coalesce(p.city, '')) = '')::int AS missing_city_count,
        COUNT(*) FILTER (
          WHERE btrim(coalesce(p.region, '')) = ''
             OR btrim(coalesce(p.city, '')) = ''
        )::int AS missing_region_or_city_count,
        COUNT(*) FILTER (
          WHERE btrim(coalesce(p.remote_type, '')) = ''
             OR p.remote_type = 'unknown'
        )::int AS missing_remote_type_count,
        COUNT(*) FILTER (
          WHERE p.posted_at_epoch IS NULL
             OR p.posted_at_epoch <= 0
        )::int AS missing_posted_at_count,
        COUNT(*) FILTER (WHERE btrim(coalesce(p.department, '')) = '')::int AS missing_department_count,
        COUNT(*) FILTER (WHERE btrim(coalesce(p.employment_type, '')) = '')::int AS missing_employment_type_count,
        COUNT(*) FILTER (WHERE btrim(coalesce(p.description_plain, '')) = '')::int AS missing_description_plain_count,
        COALESCE(MAX(pa.parser_attention_count_24h), 0)::int AS parser_attention_count_24h,
        (
          COUNT(*) FILTER (WHERE btrim(coalesce(p.country, '')) = '') +
          COUNT(*) FILTER (WHERE btrim(coalesce(p.region, '')) = '') +
          COUNT(*) FILTER (WHERE btrim(coalesce(p.city, '')) = '') +
          COUNT(*) FILTER (
            WHERE btrim(coalesce(p.remote_type, '')) = ''
               OR p.remote_type = 'unknown'
          ) +
          COUNT(*) FILTER (
            WHERE p.posted_at_epoch IS NULL
               OR p.posted_at_epoch <= 0
          ) +
          COUNT(*) FILTER (WHERE btrim(coalesce(p.department, '')) = '') +
          COUNT(*) FILTER (WHERE btrim(coalesce(p.employment_type, '')) = '') +
          COUNT(*) FILTER (WHERE btrim(coalesce(p.description_plain, '')) = '') +
          COALESCE(MAX(pa.parser_attention_count_24h), 0)
        )::bigint AS impact_score
      FROM postings p
      LEFT JOIN parser_attention pa
        ON pa.ats_key = p.ats_key
      WHERE p.hidden = false
        ${atsClause}
      GROUP BY p.ats_key
      ORDER BY impact_score DESC, total_postings DESC;
    `,
    params
  );
  return rows.rows.map(formatFieldQualityRow);
}

async function getPostgresParserAdmin(pool, atsKey) {
  const normalizedAtsKey = normalizeAtsKey(atsKey);
  const source = await pool.query(
    `
      SELECT
        s.ats_key,
        s.display_name,
        s.enabled,
        s.default_ttl_seconds,
        s.rate_limit_ms,
        MAX(st.last_success_epoch)::bigint AS last_success_epoch,
        MAX(st.last_failure_epoch)::bigint AS last_failure_epoch
      FROM ats_sources s
      LEFT JOIN company_sync_state st
        ON st.ats_key = s.ats_key
      WHERE s.ats_key = $1
      GROUP BY s.ats_key, s.display_name, s.enabled, s.default_ttl_seconds, s.rate_limit_ms;
    `,
    [normalizedAtsKey]
  );
  if (!source.rows[0]) return null;
  const metadata = getAdapterMetadata(normalizedAtsKey, source.rows[0].display_name);

  const errorRows = await pool.query(
    `
      SELECT run_id, company_url, company_name, error_type, error_message, http_status, created_at
      FROM ingestion_run_errors
      WHERE ats_key = $1
      ORDER BY id DESC
      LIMIT 25;
    `,
    [normalizedAtsKey]
  );
  const fieldQuality = await getPostgresAtsFieldQualityByAts(pool, [normalizedAtsKey]);

  return {
    ats_key: String(source.rows[0].ats_key || ""),
    display_name: String(source.rows[0].display_name || ""),
    enabled: Boolean(source.rows[0].enabled),
    default_ttl_seconds: Number(source.rows[0].default_ttl_seconds || 0),
    rate_limit_ms: Number(source.rows[0].rate_limit_ms || 0),
    last_success_epoch: Number(source.rows[0].last_success_epoch || 0),
    last_failure_epoch: Number(source.rows[0].last_failure_epoch || 0),
    parser_version: "postgres-adapter-v1",
    fixture_status: metadata.fixtureStatus,
    parser_fixture_status: metadata.parserFixtureStatus,
    confidence: metadata.confidence,
    tier: metadata.tier,
    parse_strategy: metadata.parseStrategy,
    enabled_by_default: metadata.enabledByDefault,
    field_quality: fieldQuality[0] || null,
    recent_errors: errorRows.rows.map((row) => ({
      run_id: Number(row?.run_id || 0),
      company_url: String(row?.company_url || ""),
      company_name: String(row?.company_name || ""),
      error_type: String(row?.error_type || "unknown"),
      error_message: String(row?.error_message || ""),
      http_status: row?.http_status == null ? null : Number(row.http_status),
      created_at: row?.created_at ? new Date(row.created_at).toISOString() : ""
    }))
  };
}

async function listPostgresIngestionRuns(pool, limit = 25) {
  const rows = await pool.query(
    `
      SELECT
        id,
        started_at_epoch,
        finished_at_epoch,
        status,
        total_targets,
        success_count,
        failure_count,
        cache_hit_count,
        cache_write_count,
        posting_upsert_count,
        rejected_count,
        duplicate_count,
        db_busy_count,
        current_ats,
        current_company_url,
        current_company_name,
        http_status_counts,
        active_ats,
        last_error
      FROM ingestion_runs
      ORDER BY id DESC
      LIMIT $1;
    `,
    [Math.max(1, Math.min(100, Number(limit || 25)))]
  );
  return rows.rows.map((row) => ({
    id: Number(row?.id || 0),
    started_at_epoch: Number(row?.started_at_epoch || 0),
    finished_at_epoch: Number(row?.finished_at_epoch || 0),
    status: String(row?.status || ""),
    total_targets: Number(row?.total_targets || 0),
    success_count: Number(row?.success_count || 0),
    failure_count: Number(row?.failure_count || 0),
    cache_hit_count: Number(row?.cache_hit_count || 0),
    cache_write_count: Number(row?.cache_write_count || 0),
    posting_upsert_count: Number(row?.posting_upsert_count || 0),
    rejected_count: Number(row?.rejected_count || 0),
    duplicate_count: Number(row?.duplicate_count || 0),
    db_busy_count: Number(row?.db_busy_count || 0),
    current_ats: String(row?.current_ats || ""),
    current_company_url: String(row?.current_company_url || ""),
    current_company_name: String(row?.current_company_name || ""),
    http_status_counts: row?.http_status_counts && typeof row.http_status_counts === "object" ? row.http_status_counts : {},
    active_ats: Array.isArray(row?.active_ats) ? row.active_ats : [],
    last_error: String(row?.last_error || "")
  }));
}

async function listPostgresIngestionErrors(pool, limit = 50) {
  const rows = await pool.query(
    `
      SELECT
        id,
        run_id,
        ats_key,
        company_url,
        company_name,
        error_type,
        error_message,
        http_status,
        created_at
      FROM ingestion_run_errors
      ORDER BY id DESC
      LIMIT $1;
    `,
    [Math.max(1, Math.min(250, Number(limit || 50)))]
  );
  return rows.rows.map((row) => ({
    id: Number(row?.id || 0),
    run_id: Number(row?.run_id || 0),
    ats_key: String(row?.ats_key || ""),
    company_url: String(row?.company_url || ""),
    company_name: String(row?.company_name || ""),
    error_type: String(row?.error_type || "unknown"),
    error_message: String(row?.error_message || ""),
    http_status: row?.http_status == null ? null : Number(row.http_status),
    created_at: row?.created_at ? new Date(row.created_at).toISOString() : ""
  }));
}

async function listPostgresIngestionSources(pool, limit = 100) {
  const rows = await pool.query(
    `
      SELECT
        s.ats_key,
        s.display_name,
        s.enabled,
        s.default_ttl_seconds,
        s.rate_limit_ms,
        COUNT(DISTINCT c.id)::int AS company_count,
        COUNT(DISTINCT c.id) FILTER (WHERE COALESCE(st.next_sync_epoch, 0) <= $1)::int AS due_company_count,
        MAX(st.last_success_epoch)::bigint AS last_success_epoch,
        MAX(st.last_failure_epoch)::bigint AS last_failure_epoch,
        SUM(COALESCE(st.consecutive_failures, 0))::bigint AS consecutive_failure_total
      FROM ats_sources s
      LEFT JOIN companies c
        ON c.ats_key = s.ats_key
      LEFT JOIN company_sync_state st
        ON st.ats_key = c.ats_key
        AND st.company_url = c.url_string
      GROUP BY s.ats_key, s.display_name, s.enabled, s.default_ttl_seconds, s.rate_limit_ms
      ORDER BY due_company_count DESC, company_count DESC, s.display_name ASC
      LIMIT $2;
    `,
    [Math.floor(Date.now() / 1000), Math.max(1, Math.min(250, Number(limit || 100)))]
  );
  return rows.rows.map((row) => ({
    ats_key: String(row?.ats_key || ""),
    display_name: String(row?.display_name || ""),
    enabled: Boolean(row?.enabled),
    default_ttl_seconds: Number(row?.default_ttl_seconds || 0),
    rate_limit_ms: Number(row?.rate_limit_ms || 0),
    company_count: Number(row?.company_count || 0),
    due_company_count: Number(row?.due_company_count || 0),
    last_success_epoch: Number(row?.last_success_epoch || 0),
    last_failure_epoch: Number(row?.last_failure_epoch || 0),
    consecutive_failure_total: Number(row?.consecutive_failure_total || 0)
  }));
}

async function getPostgresPostingDiagnostics(pool, options = {}) {
  const canonicalUrl = String(options.canonicalUrl || options.url || "").trim();
  if (!canonicalUrl) return null;
  const result = await pool.query(
    `
      SELECT
        p.canonical_url,
        p.company_name,
        p.position_name,
        p.location_text,
        p.city,
        p.country,
        p.region,
        p.remote_type,
        p.ats_key,
        p.source_job_id,
        p.posting_date,
        p.posted_at_epoch,
        p.first_seen_epoch,
        p.last_seen_epoch,
        p.hidden,
        p.parser_version,
        p.confidence,
        p.quality_score,
        p.quality_flags,
        p.rejection_reason,
        pc.source_company_url,
        pc.raw_payload_hash,
        pc.validation_status,
        pc.validation_error,
        pc.updated_at AS cache_updated_at
      FROM postings p
      LEFT JOIN posting_cache pc
        ON pc.canonical_url = p.canonical_url
      WHERE p.canonical_url = $1
      LIMIT 1;
    `,
    [canonicalUrl]
  );
  const row = result.rows[0];
  if (!row) return null;
  let duplicateOf = "";
  if (String(row.source_job_id || "").trim()) {
    const duplicate = await pool.query(
      `
        SELECT canonical_url
        FROM postings
        WHERE ats_key = $1
          AND source_job_id = $2
          AND canonical_url <> $3
        ORDER BY last_seen_epoch DESC
        LIMIT 1;
      `,
      [row.ats_key, row.source_job_id, row.canonical_url]
    );
    duplicateOf = String(duplicate.rows[0]?.canonical_url || "");
  }
  const metadata = buildQualityMetadata(
    {
      ...row,
      canonical_url: row.canonical_url,
      job_posting_url: row.canonical_url,
      company_name: row.company_name,
      position_name: row.position_name,
      location: row.location_text,
      raw_payload_hash: row.raw_payload_hash,
      validation_status: row.validation_status,
      validation_error: row.validation_error
    },
    { duplicateOf }
  );
  return {
    canonical_url: String(row.canonical_url || ""),
    title: String(row.position_name || ""),
    company: String(row.company_name || ""),
    diagnostics: metadata
  };
}

async function getPostgresQualitySummary(pool, limit = 100) {
  const [audit, visibility] = await Promise.all([
    getPostgresQualityAudit(pool, { limit }),
    getPostgresCacheVisibilitySummary(pool, limit)
  ]);
  return {
    ...makeQualitySummary(audit.by_source, audit.summary),
    by_parser: audit.by_parser,
    visibility
  };
}

async function getPostgresCacheVisibilitySummary(pool, limit = 100) {
  const cappedLimit = Math.max(1, Math.min(1000, Number(limit || 100)));
  const [statusResult, reasonResult, sourceResult, parserResult, parserReasonResult] = await Promise.all([
    pool.query(`
      SELECT COALESCE(NULLIF(btrim(validation_status), ''), 'unknown') AS status, COUNT(*)::bigint AS count
      FROM posting_cache
      GROUP BY status
      ORDER BY count DESC, status ASC;
    `),
    pool.query(`
      SELECT
        COALESCE(NULLIF(btrim(validation_error), ''), COALESCE(NULLIF(btrim(rejection_reason), ''), 'unknown')) AS reason,
        COUNT(*)::bigint AS count
      FROM posting_cache
      WHERE validation_status = 'quarantined'
      GROUP BY reason
      ORDER BY count DESC, reason ASC
      LIMIT $1;
    `, [cappedLimit]),
    pool.query(`
      SELECT
        COALESCE(NULLIF(btrim(ats_key), ''), 'unknown') AS source_ats,
        COUNT(*) FILTER (WHERE validation_status = 'valid')::bigint AS accepted_count,
        COUNT(*) FILTER (WHERE validation_status = 'quarantined')::bigint AS quarantined_count,
        COUNT(*) FILTER (WHERE COALESCE(validation_status, '') NOT IN ('valid', 'quarantined'))::bigint AS rejected_count
      FROM posting_cache
      GROUP BY source_ats
      ORDER BY quarantined_count DESC, rejected_count DESC, source_ats ASC
      LIMIT $1;
    `, [cappedLimit]),
    pool.query(`
      SELECT
        COALESCE(NULLIF(btrim(ats_key), ''), 'unknown') AS source_ats,
        COALESCE(NULLIF(btrim(parser_version), ''), 'unknown') AS parser_version,
        COUNT(*) FILTER (WHERE validation_status = 'valid')::bigint AS accepted_count,
        COUNT(*) FILTER (WHERE validation_status = 'quarantined')::bigint AS quarantined_count,
        COUNT(*) FILTER (WHERE COALESCE(validation_status, '') NOT IN ('valid', 'quarantined'))::bigint AS rejected_count
      FROM posting_cache
      GROUP BY source_ats, parser_version
      ORDER BY quarantined_count DESC, rejected_count DESC, source_ats ASC, parser_version ASC
      LIMIT $1;
    `, [cappedLimit]),
    pool.query(`
      SELECT
        COALESCE(NULLIF(btrim(ats_key), ''), 'unknown') AS source_ats,
        COALESCE(NULLIF(btrim(parser_version), ''), 'unknown') AS parser_version,
        COALESCE(NULLIF(btrim(validation_error), ''), COALESCE(NULLIF(btrim(rejection_reason), ''), 'unknown')) AS reason,
        COUNT(*)::bigint AS count
      FROM posting_cache
      WHERE validation_status = 'quarantined'
      GROUP BY source_ats, parser_version, reason
      ORDER BY count DESC, source_ats ASC, parser_version ASC
      LIMIT $1;
    `, [cappedLimit])
  ]);
  const byStatus = {};
  for (const row of statusResult.rows) {
    byStatus[String(row.status || "unknown")] = Number(row.count || 0);
  }
  return {
    accepted_count: Number(byStatus.valid || 0),
    quarantined_count: Number(byStatus.quarantined || 0),
    rejected_count: Object.entries(byStatus)
      .filter(([status]) => status !== "valid" && status !== "quarantined")
      .reduce((sum, [, count]) => sum + Number(count || 0), 0),
    by_status: byStatus,
    quarantine_by_reason: reasonResult.rows.map((row) => ({
      reason: String(row.reason || "unknown"),
      count: Number(row.count || 0)
    })),
    by_source: sourceResult.rows.map((row) => ({
      source_ats: String(row.source_ats || "unknown"),
      accepted_count: Number(row.accepted_count || 0),
      quarantined_count: Number(row.quarantined_count || 0),
      rejected_count: Number(row.rejected_count || 0)
    })),
    by_parser: parserResult.rows.map((row) => ({
      source_ats: String(row.source_ats || "unknown"),
      parser_version: String(row.parser_version || "unknown"),
      accepted_count: Number(row.accepted_count || 0),
      quarantined_count: Number(row.quarantined_count || 0),
      rejected_count: Number(row.rejected_count || 0)
    })),
    quarantine_reasons_by_parser: parserReasonResult.rows.map((row) => ({
      source_ats: String(row.source_ats || "unknown"),
      parser_version: String(row.parser_version || "unknown"),
      reason: String(row.reason || "unknown"),
      count: Number(row.count || 0)
    }))
  };
}

async function listPostgresRejections(pool, limit = 50) {
  const cappedLimit = Math.max(1, Math.min(250, Number(limit || 50)));
  const result = await pool.query(
    `
      SELECT
        canonical_url,
        ats_key,
        company_name,
        position_name,
        source_company_url,
        validation_status,
        validation_error,
        rejection_reason,
        quality_flags,
        updated_at
      FROM posting_cache
      WHERE validation_status <> 'valid'
         OR btrim(coalesce(rejection_reason, '')) <> ''
      ORDER BY updated_at DESC
      LIMIT $1;
    `,
    [cappedLimit]
  );
  return result.rows.map((row) => ({
    type: "posting_cache",
    canonical_url: String(row?.canonical_url || ""),
    ats_key: String(row?.ats_key || ""),
    company_name: String(row?.company_name || ""),
    position_name: String(row?.position_name || ""),
    source_url: String(row?.source_company_url || ""),
    rejection_reason: String(row?.rejection_reason || row?.validation_error || ""),
    quality_flags: parseQualityFlags(row?.quality_flags),
    updated_at: row?.updated_at ? new Date(row.updated_at).toISOString() : ""
  }));
}

async function getPostgresParserStats(pool, limit = 100) {
  const [audit, attention, visibility] = await Promise.all([
    getPostgresQualityAudit(pool, { limit }),
    getPostgresParserAttentionByAts(pool, limit),
    getPostgresCacheVisibilitySummary(pool, limit)
  ]);
  const attentionByAts = new Map(attention.map((item) => [String(item.ats_key || ""), item]));
  const visibilityByParser = new Map((visibility.by_parser || []).map((item) => [
    `${item.source_ats}\u0000${item.parser_version}`,
    item
  ]));
  const reasonsByParser = new Map();
  for (const item of visibility.quarantine_reasons_by_parser || []) {
    const key = `${item.source_ats}\u0000${item.parser_version}`;
    const existing = reasonsByParser.get(key) || {};
    existing[item.reason] = Number(item.count || 0);
    reasonsByParser.set(key, existing);
  }
  const rowsByKey = new Map(audit.by_parser.map((item) => [`${item.source_ats}\u0000${item.parser_version}`, item]));
  for (const item of visibility.by_parser || []) {
    const key = `${item.source_ats}\u0000${item.parser_version}`;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        source_ats: item.source_ats,
        ats_key: item.source_ats,
        parser_key: item.parser_version,
        parser_version: item.parser_version,
        total_visible_rows: 0,
        total_postings: 0,
        avg_quality_score: 0,
        low_quality_count: 0,
        quality_flag_counts: {},
        flag_counts: {}
      });
    }
  }
  return Array.from(rowsByKey.values()).map((item) => {
    const attentionItem = attentionByAts.get(item.source_ats || item.ats_key) || {};
    const visibilityItem = visibilityByParser.get(`${item.source_ats}\u0000${item.parser_version}`) || {};
    return {
      ...item,
      flag_counts: item.quality_flag_counts || {},
      accepted_count: Number(visibilityItem.accepted_count || 0),
      quarantined_count: Number(visibilityItem.quarantined_count || 0),
      rejected_count: Number(visibilityItem.rejected_count || item.rejection_count || 0),
      quarantine_reasons: reasonsByParser.get(`${item.source_ats}\u0000${item.parser_version}`) || {},
      parser_attention_count_24h: Number(attentionItem.error_count || 0),
      latest_parser_error: String(attentionItem.last_error || "")
    };
  });
}

async function getPostgresSourceQualityDashboard(pool, limit = 100) {
  const cappedLimit = Math.max(1, Math.min(250, Number(limit || 100)));
  const result = await pool.query(
    `
      WITH cache AS (
        SELECT
          ats_key,
          COUNT(*) FILTER (WHERE validation_status = 'valid')::bigint AS accepted_rows,
          COUNT(*) FILTER (WHERE validation_status = 'quarantined')::bigint AS quarantined_rows,
          COUNT(*) FILTER (WHERE COALESCE(validation_status, '') NOT IN ('valid', 'quarantined'))::bigint AS rejected_rows
        FROM posting_cache
        GROUP BY ats_key
      ),
      visible AS (
        SELECT
          ats_key,
          COUNT(*)::bigint AS visible_rows,
          COUNT(*) FILTER (WHERE btrim(coalesce(country, '')) = '')::bigint AS missing_country_count,
          COUNT(*) FILTER (WHERE btrim(coalesce(city, '')) = '')::bigint AS missing_city_count,
          COUNT(*) FILTER (
            WHERE btrim(coalesce(country, '')) = ''
               OR btrim(coalesce(region, '')) = ''
               OR btrim(coalesce(city, '')) = ''
          )::bigint AS missing_any_geo_count,
          COUNT(*) FILTER (
            WHERE btrim(coalesce(country, '')) = ''
              AND btrim(coalesce(region, '')) = ''
              AND btrim(coalesce(city, '')) = ''
              AND lower(btrim(coalesce(remote_type, ''))) IN ('', 'unknown')
          )::bigint AS missing_all_geo_unknown_remote_count,
          COUNT(*) FILTER (WHERE lower(btrim(coalesce(remote_type, ''))) IN ('', 'unknown'))::bigint AS unknown_remote_count
        FROM postings
        WHERE hidden = false
        GROUP BY ats_key
      ),
      errors AS (
        SELECT
          ats_key,
          COUNT(*) FILTER (WHERE error_type LIKE 'parser_%')::bigint AS parser_failure_events,
          COUNT(*) FILTER (WHERE http_status >= 400 OR error_type = 'fetch')::bigint AS http_failure_events
        FROM ingestion_run_errors
        WHERE created_at >= now() - interval '24 hours'
        GROUP BY ats_key
      ),
      drift AS (
        SELECT
          ats_key,
          COUNT(*)::bigint AS drift_events_24h,
          MAX(created_at) AS latest_drift_at
        FROM parser_drift_events
        WHERE created_at >= now() - interval '24 hours'
        GROUP BY ats_key
      )
      SELECT
        s.ats_key,
        s.display_name,
        s.enabled,
        s.protection_status,
        s.disabled_reason,
        s.disabled_at,
        COALESCE(cache.accepted_rows, 0)::bigint AS accepted_rows,
        COALESCE(cache.quarantined_rows, 0)::bigint AS quarantined_rows,
        COALESCE(cache.rejected_rows, 0)::bigint AS rejected_rows,
        COALESCE(visible.visible_rows, 0)::bigint AS visible_rows,
        COALESCE(visible.missing_country_count, 0)::bigint AS missing_country_count,
        COALESCE(visible.missing_city_count, 0)::bigint AS missing_city_count,
        COALESCE(visible.missing_any_geo_count, 0)::bigint AS missing_any_geo_count,
        COALESCE(visible.missing_all_geo_unknown_remote_count, 0)::bigint AS missing_all_geo_unknown_remote_count,
        COALESCE(visible.unknown_remote_count, 0)::bigint AS unknown_remote_count,
        COALESCE(errors.parser_failure_events, 0)::bigint AS parser_failure_events,
        COALESCE(errors.http_failure_events, 0)::bigint AS http_failure_events,
        COALESCE(drift.drift_events_24h, 0)::bigint AS drift_events_24h,
        drift.latest_drift_at
      FROM ats_sources s
      LEFT JOIN cache ON cache.ats_key = s.ats_key
      LEFT JOIN visible ON visible.ats_key = s.ats_key
      LEFT JOIN errors ON errors.ats_key = s.ats_key
      LEFT JOIN drift ON drift.ats_key = s.ats_key
      ORDER BY
        COALESCE(cache.quarantined_rows, 0) DESC,
        COALESCE(visible.missing_country_count, 0) DESC,
        s.ats_key ASC
      LIMIT $1;
    `,
    [cappedLimit]
  );
  return result.rows.map((row) => {
    const metadata = getAdapterMetadata(row.ats_key, row.display_name);
    const metrics = summarizeSourceMetrics(row);
    const protection = classifySourceProtection(row, { metadata });
    return {
      ats_key: String(row.ats_key || ""),
      display_name: String(row.display_name || row.ats_key || ""),
      source_family: protection.source_family,
      adapter_tier: metadata.tier,
      enabled: Boolean(row.enabled),
      protection_status: String(row.protection_status || "normal"),
      source_quality_state: protection.source_quality_state,
      disabled_reason: String(row.disabled_reason || ""),
      disabled_at: row.disabled_at ? new Date(row.disabled_at).toISOString() : "",
      ...metrics,
      drift_events_24h: Number(row.drift_events_24h || 0),
      latest_drift_at: row.latest_drift_at ? new Date(row.latest_drift_at).toISOString() : "",
      recommended_action: protection.action,
      recommended_reason: protection.reason,
      family_thresholds: protection.family_thresholds
    };
  });
}

async function applyPostgresSourceQualityProtection(pool, options = {}) {
  const onlyAts = new Set((options.atsKeys || []).map((item) => String(item || "").trim()).filter(Boolean));
  const rows = await getPostgresSourceQualityDashboard(pool, 250);
  const actions = [];
  for (const row of rows) {
    if (onlyAts.size > 0 && !onlyAts.has(row.ats_key)) continue;
    const classification = classifySourceProtection(row, { thresholds: options.thresholds });
    if (!["disable", "quarantine_only"].includes(classification.action)) continue;
    if (classification.action === "disable" && String(row.protection_status || "") === "auto_disabled" && !row.enabled) continue;
    if (classification.action === "quarantine_only" && String(row.protection_status || "") === "quarantine_only") continue;
    const nextStatus = classification.action === "disable" ? "auto_disabled" : "quarantine_only";
    const nextEnabled = classification.action === "disable" ? false : true;
    await pool.query(
      `
        UPDATE ats_sources
        SET enabled = $4,
            protection_status = $5,
            disabled_reason = $2,
            disabled_at = CASE WHEN $5 = 'auto_disabled' THEN now() ELSE disabled_at END,
            quality_policy = $3::jsonb,
            updated_at = now()
        WHERE ats_key = $1;
      `,
      [
        row.ats_key,
        classification.reason,
        JSON.stringify({
          metrics: classification.metrics,
          thresholds: classification.thresholds,
          source_quality_state: classification.source_quality_state,
          source_family: classification.source_family
        }),
        nextEnabled,
        nextStatus
      ]
    );
    await pool.query(
      `
        INSERT INTO source_quality_events (ats_key, event_type, severity, reason, action, metrics)
        VALUES ($1, $4, $5, $2, $6, $3::jsonb);
      `,
      [
        row.ats_key,
        classification.reason,
        JSON.stringify(classification.metrics),
        classification.action === "disable" ? "source_auto_disabled" : "source_quarantine_only",
        classification.action === "disable" ? "error" : "warning",
        classification.action
      ]
    );
    actions.push({
      ats_key: row.ats_key,
      action: classification.action === "disable" ? "disabled" : "quarantine_only",
      reason: classification.reason,
      metrics: classification.metrics
    });
  }
  return { ok: true, actions };
}

async function getPostgresQuarantineSummary(pool, limit = 100) {
  const cappedLimit = Math.max(1, Math.min(250, Number(limit || 100)));
  const [bySource, byReason, byParser] = await Promise.all([
    pool.query(
      `
        SELECT
          ats_key,
          COUNT(*)::bigint AS count
        FROM posting_cache
        WHERE validation_status = 'quarantined'
        GROUP BY ats_key
        ORDER BY count DESC, ats_key ASC
        LIMIT $1;
      `,
      [cappedLimit]
    ),
    pool.query(
      `
        SELECT
          COALESCE(NULLIF(btrim(validation_error), ''), COALESCE(NULLIF(btrim(rejection_reason), ''), 'unknown')) AS reason,
          COUNT(*)::bigint AS count
        FROM posting_cache
        WHERE validation_status = 'quarantined'
        GROUP BY reason
        ORDER BY count DESC, reason ASC
        LIMIT $1;
      `,
      [cappedLimit]
    ),
    pool.query(
      `
        SELECT
          ats_key,
          parser_version,
          COUNT(*)::bigint AS count
        FROM posting_cache
        WHERE validation_status = 'quarantined'
        GROUP BY ats_key, parser_version
        ORDER BY count DESC, ats_key ASC, parser_version ASC
        LIMIT $1;
      `,
      [cappedLimit]
    )
  ]);
  return {
    by_source: bySource.rows.map((row) => ({
      ats_key: String(row.ats_key || ""),
      count: Number(row.count || 0)
    })),
    by_reason: byReason.rows.map((row) => ({
      reason: String(row.reason || "unknown"),
      count: Number(row.count || 0)
    })),
    by_parser: byParser.rows.map((row) => ({
      ats_key: String(row.ats_key || ""),
      parser_version: String(row.parser_version || "unknown"),
      count: Number(row.count || 0)
    }))
  };
}

async function getPostgresSourceRunStatus(pool, limit = 10) {
  const cappedLimit = Math.max(1, Math.min(50, Number(limit || 10)));
  const [active, latest] = await Promise.all([
    pool.query(
      `
        SELECT
          id, ats_key, mode, status, requested_limit, max_updates,
          fetch_count, parse_count, accepted_count, quarantined_count, rejected_count,
          public_write_count, quarantine_write_count, average_latency_ms,
          stop_reason, error_message, started_at, updated_at
        FROM ats_source_runs
        WHERE status = 'running'
        ORDER BY started_at DESC
        LIMIT $1;
      `,
      [cappedLimit]
    ),
    pool.query(
      `
        SELECT
          id, ats_key, mode, status, requested_limit, max_updates,
          fetch_count, parse_count, accepted_count, quarantined_count, rejected_count,
          public_write_count, quarantine_write_count, http_status_counts,
          parser_failure_reasons, average_latency_ms, stop_reason, error_message,
          started_at, finished_at
        FROM ats_source_runs
        ORDER BY id DESC
        LIMIT $1;
      `,
      [cappedLimit]
    )
  ]);
  const normalize = (row) => ({
    id: Number(row.id || 0),
    ats_key: String(row.ats_key || ""),
    mode: String(row.mode || ""),
    status: String(row.status || ""),
    requested_limit: Number(row.requested_limit || 0),
    max_updates: Number(row.max_updates || 0),
    fetch_count: Number(row.fetch_count || 0),
    parse_count: Number(row.parse_count || 0),
    accepted_count: Number(row.accepted_count || 0),
    quarantined_count: Number(row.quarantined_count || 0),
    rejected_count: Number(row.rejected_count || 0),
    public_write_count: Number(row.public_write_count || 0),
    quarantine_write_count: Number(row.quarantine_write_count || 0),
    http_status_counts: row.http_status_counts && typeof row.http_status_counts === "object" ? row.http_status_counts : {},
    parser_failure_reasons: row.parser_failure_reasons && typeof row.parser_failure_reasons === "object" ? row.parser_failure_reasons : {},
    average_latency_ms: Number(row.average_latency_ms || 0),
    stop_reason: String(row.stop_reason || ""),
    error_message: String(row.error_message || ""),
    started_at: row.started_at ? new Date(row.started_at).toISOString() : "",
    finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : "",
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  });
  return {
    active_count: active.rows.length,
    active: active.rows.map(normalize),
    latest: latest.rows.map(normalize)
  };
}

async function listPostgresParserDriftEvents(pool, limit = 100) {
  const cappedLimit = Math.max(1, Math.min(250, Number(limit || 100)));
  const result = await pool.query(
    `
      SELECT
        id,
        ats_key,
        parser_version,
        company_url,
        company_name,
        shape_hash,
        baseline_hash,
        similarity,
        reason,
        created_at
      FROM parser_drift_events
      ORDER BY id DESC
      LIMIT $1;
    `,
    [cappedLimit]
  );
  return result.rows.map((row) => ({
    id: Number(row.id || 0),
    ats_key: String(row.ats_key || ""),
    parser_version: String(row.parser_version || "unknown"),
    company_url: String(row.company_url || ""),
    company_name: String(row.company_name || ""),
    shape_hash: String(row.shape_hash || ""),
    baseline_hash: String(row.baseline_hash || ""),
    similarity: Number(row.similarity || 0),
    reason: String(row.reason || ""),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : ""
  }));
}

async function checkAndRecordPostgresPayloadDrift(pool, target, raw, parserVersion, options = {}) {
  const { analyzePayloadShape, detectParserDrift } = require("../ingestion/sourceQualityPolicy");
  const atsKey = String(target?.atsKey || "").trim();
  const version = String(parserVersion || "unknown");
  const observed = analyzePayloadShape(raw);
  const existing = await pool.query(
    `
      SELECT shape_hash, shape_paths, observed_count
      FROM source_payload_shapes
      WHERE ats_key = $1 AND parser_version = $2;
    `,
    [atsKey, version]
  );
  const baseline = existing.rows[0] || null;
  if (!baseline) {
    await pool.query(
      `
        INSERT INTO source_payload_shapes (ats_key, parser_version, shape_hash, shape_paths, observed_count)
        VALUES ($1, $2, $3, $4::jsonb, 1)
        ON CONFLICT (ats_key, parser_version) DO NOTHING;
      `,
      [atsKey, version, observed.shape_hash, JSON.stringify(observed.shape_paths)]
    );
    return { drift: false, bootstrapped: true, observed };
  }
  const drift = detectParserDrift(
    {
      shape_hash: String(baseline.shape_hash || ""),
      shape_paths: Array.isArray(baseline.shape_paths) ? baseline.shape_paths : []
    },
    observed,
    options
  );
  if (drift.drift) {
    await pool.query(
      `
        INSERT INTO parser_drift_events (
          ats_key, parser_version, company_url, company_name, shape_hash,
          baseline_hash, similarity, reason, shape_paths
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb);
      `,
      [
        atsKey,
        version,
        String(target?.companyUrl || ""),
        String(target?.company?.company_name || ""),
        observed.shape_hash,
        String(baseline.shape_hash || ""),
        Number(drift.similarity || 0),
        drift.reason,
        JSON.stringify(observed.shape_paths)
      ]
    );
    return { ...drift, observed, baseline };
  }
  await pool.query(
    `
      UPDATE source_payload_shapes
      SET observed_count = observed_count + 1,
          last_seen_at = now()
      WHERE ats_key = $1 AND parser_version = $2;
    `,
    [atsKey, version]
  );
  return { ...drift, observed, baseline };
}

async function getSyncControl(pool) {
  const result = await pool.query("SELECT * FROM sync_control WHERE id = 1;");
  return result.rows[0] || { status: "idle" };
}

async function requestSyncStart(pool) {
  const now = Math.floor(Date.now() / 1000);
  await pool.query(
    `
      UPDATE sync_control
      SET status = CASE WHEN status IN ('running', 'stopping') THEN status ELSE 'requested' END,
          requested_at_epoch = CASE WHEN status IN ('running', 'stopping') THEN requested_at_epoch ELSE $1::bigint END,
          cancel_requested_at_epoch = CASE WHEN status IN ('running', 'stopping') THEN cancel_requested_at_epoch ELSE NULL::bigint END,
          message = CASE WHEN status = 'stopping' THEN message ELSE '' END,
          updated_at = now()
      WHERE id = 1;
    `,
    [now]
  );
  return getSyncControl(pool);
}

async function requestSyncStop(pool) {
  const now = Math.floor(Date.now() / 1000);
  await pool.query(
    `
      UPDATE sync_control
      SET status = CASE WHEN status IN ('running', 'requested', 'stopping') THEN 'stopping' ELSE 'idle' END,
          cancel_requested_at_epoch = CASE WHEN status IN ('running', 'requested', 'stopping') THEN $1::bigint ELSE NULL::bigint END,
          message = CASE WHEN status IN ('running', 'requested', 'stopping') THEN 'Stop requested by user' ELSE 'No sync run to stop' END,
          updated_at = now()
      WHERE id = 1;
    `,
    [now]
  );
  return getSyncControl(pool);
}

async function getPostgresSyncStatus(pool) {
  const [control, counts, latestRun, latestFailedRun, due, parserErrors] = await Promise.all([
    getSyncControl(pool),
    getPostgresCounts(pool),
    pool.query("SELECT * FROM ingestion_runs ORDER BY id DESC LIMIT 1;"),
    pool.query(
      `
        SELECT *
        FROM ingestion_runs
        WHERE failure_count > 0 OR status IN ('failed', 'completed_with_errors', 'interrupted')
        ORDER BY id DESC
        LIMIT 1;
      `
    ),
    pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM companies c
        INNER JOIN ats_sources s
          ON s.ats_key = c.ats_key
        LEFT JOIN company_sync_state st
          ON st.ats_key = c.ats_key
          AND st.company_url = c.url_string
        WHERE s.enabled = true
          AND COALESCE(st.next_sync_epoch, 0) <= $1;
      `,
      [Math.floor(Date.now() / 1000)]
    ),
    pool.query("SELECT COUNT(*)::int AS count FROM ingestion_run_errors WHERE created_at >= now() - interval '24 hours' AND error_type LIKE 'parser_%';")
  ]);
  const run = latestRun.rows[0] || {};
  const failedRun = latestFailedRun.rows[0] || {};
  const status = String(control.status || "idle");
  const queued = status === "requested";
  const running = status === "running" || status === "stopping";
  const latestStatus =
    queued
      ? "queued"
      : status === "stopping"
        ? "stopping"
        : String(run.status || status);
  return {
    running,
    queued,
    status,
    stopping: status === "stopping",
    cancel_requested: Boolean(control.cancel_requested_at_epoch),
    legacy_api_sync: false,
    last_sync_at: run.finished_at_epoch ? new Date(Number(run.finished_at_epoch) * 1000).toISOString() : null,
    last_failed_sync_at: failedRun.finished_at_epoch ? new Date(Number(failedRun.finished_at_epoch) * 1000).toISOString() : null,
    last_sync_summary: {
      total_companies: Number(run.total_targets || 0),
      failed_companies: Number(run.failure_count || 0),
      total_postings_stored: Number(run.posting_upsert_count || 0),
      cache_writes: Number(run.cache_write_count || 0),
      cache_skips: Number(run.cache_hit_count || 0),
      rejected_postings: Number(run.rejected_count || 0),
      duplicate_postings: Number(run.duplicate_count || 0),
      db_busy_events: Number(run.db_busy_count || 0)
    },
    db_backend: "postgres",
    search_backend: getMeiliConfig().enabled ? "meili" : "postgres",
    queue_backend: process.env.OPENJOBSLOTS_QUEUE_BACKEND || "postgres-sync-control",
    queue_depth: Number(due.rows[0]?.count || 0),
    sync_enabled_company_count: counts.sync_enabled_company_count,
    configured_enabled_ats_count: counts.configured_enabled_ats_count,
    excluded_ats_count: 0,
    active_ats: Array.isArray(run.active_ats) ? run.active_ats : [],
    ingestion_worker: {
      latest_run_id: Number(run.id || 0),
      latest_status: latestStatus,
      started_at_epoch: Number(run.started_at_epoch || 0),
      finished_at_epoch: Number(run.finished_at_epoch || 0),
      last_run_duration_seconds:
        run?.finished_at_epoch && run?.started_at_epoch
          ? Math.max(0, Number(run.finished_at_epoch) - Number(run.started_at_epoch))
          : 0,
      total_targets: Number(run.total_targets || 0),
      success_count: Number(run.success_count || 0),
      failure_count: Number(run.failure_count || 0),
      cache_hit_count: Number(run.cache_hit_count || 0),
      cache_write_count: Number(run.cache_write_count || 0),
      posting_upsert_count: Number(run.posting_upsert_count || 0),
      rejected_count: Number(run.rejected_count || 0),
      duplicate_count: Number(run.duplicate_count || 0),
      db_busy_count: Number(run.db_busy_count || 0),
      queue_due_count: Number(due.rows[0]?.count || 0),
      parser_error_count_24h: Number(parserErrors.rows[0]?.count || 0),
      current_ats: String(run.current_ats || ""),
      current_company_url: String(run.current_company_url || ""),
      current_company_name: String(run.current_company_name || ""),
      http_status_counts: run.http_status_counts && typeof run.http_status_counts === "object" ? run.http_status_counts : {},
      active_ats: Array.isArray(run.active_ats) ? run.active_ats : [],
      last_error: String(run.last_error || "")
    },
    ...counts
  };
}

async function upsertPostgresPostings(pool, postings, options = {}) {
  const nowEpoch = Number(options.nowEpoch || Math.floor(Date.now() / 1000));
  const normalizedForSearchIndex = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const posting of Array.isArray(postings) ? postings : []) {
      const canonicalUrl = String(posting?.canonical_url || posting?.job_posting_url || "").trim();
      const companyName = String(posting?.company_name || posting?.company || "").trim();
      const title = String(posting?.position_name || posting?.title || "").trim();
      if (!canonicalUrl || !companyName || !title) continue;
      const location = String(posting?.location || posting?.location_text || "").trim();
      const country = String(posting?.country || inferCountry(location)).trim();
      const region = String(posting?.region || inferRegion(country)).trim();
      const remoteType = normalizeRemoteTypeFromEvidence(
        [
          posting?.remote_type,
          posting?.workplaceType,
          posting?.workplace_type,
          posting?.remote,
          posting?.is_remote,
          posting?.isRemote,
          location,
          title
        ].map((value) => (value === true ? "remote" : String(value || "").trim())).filter(Boolean).join(" "),
        location
      );
      const atsKey = normalizeAtsKey(posting?.ats_key || posting?.ATS_name);
      const normalizedPosting = {
        ...posting,
        canonical_url: canonicalUrl,
        company_name: companyName,
        position_name: title,
        apply_url: String(posting?.apply_url || canonicalUrl),
        location_text: location,
        city: String(posting?.city || ""),
        country,
        region,
        remote_type: remoteType,
        department: String(posting?.department || ""),
        employment_type: String(posting?.employment_type || ""),
        description_plain: String(posting?.description_plain || ""),
        description_html: String(posting?.description_html || ""),
        ats_key: atsKey,
        last_seen_epoch: nowEpoch,
        posted_at_epoch: posting?.posted_at_epoch || posting?.posting_date_epoch || null,
        hidden: false
      };
      if (!validatePosting(normalizedPosting).ok) continue;
      const gate = evaluatePublicPosting(
        {
          ...normalizedPosting,
          parser_version: String(posting?.parser_version || options.parserVersion || "legacy-adapter-v1"),
          parser_confidence: Number(posting?.confidence || posting?.parser_confidence || 0.5)
        },
        { parserVersion: String(posting?.parser_version || options.parserVersion || "legacy-adapter-v1") }
      );
      if (gate.status !== "accepted") {
        const quarantineQuality = buildStoredQualityFields(
          {
            ...normalizedPosting,
            validation_status: gate.status,
            validation_error: gate.reason,
            parser_version: String(posting?.parser_version || options.parserVersion || "legacy-adapter-v1"),
            confidence: Number(gate.confidence || posting?.confidence || posting?.parser_confidence || 0.5),
            raw_payload_hash: String(posting?.raw_hash || posting?.raw_payload_hash || "")
          },
          { nowEpoch }
        );
        const hidden = await client.query(
          `
            UPDATE postings
            SET hidden = true,
                parser_version = $2,
                confidence = $3,
                quality_score = $4,
                quality_flags = $5::jsonb,
                rejection_reason = $6,
                updated_at = now()
            WHERE canonical_url = $1;
          `,
          [
            canonicalUrl,
            String(posting?.parser_version || options.parserVersion || "legacy-adapter-v1"),
            Number(gate.confidence || posting?.confidence || posting?.parser_confidence || 0.5),
            quarantineQuality.quality_score,
            quarantineQuality.quality_flags,
            gate.reason
          ]
        );
        if (Number(hidden.rowCount || 0) > 0) {
          await client.query(
            `
              INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at)
              VALUES ($1, 'delete', $2::jsonb, now());
            `,
            [
              canonicalUrl,
              JSON.stringify({
                reason: "quarantined",
                canonical_url: canonicalUrl,
                reason_codes: gate.reason_codes || []
              })
            ]
          );
        }
        continue;
      }
      const quality = buildStoredQualityFields(
        {
          ...normalizedPosting,
          parser_version: String(posting?.parser_version || options.parserVersion || "legacy-adapter-v1"),
          confidence: Number(gate.confidence || posting?.confidence || posting?.parser_confidence || 0.5),
          raw_payload_hash: String(posting?.raw_hash || posting?.raw_payload_hash || "")
        },
        { nowEpoch }
      );
      normalizedForSearchIndex.push(normalizedPosting);
      await client.query(
        `
          INSERT INTO postings (
            canonical_url, company_name, position_name, apply_url, location_text, city, country, region,
            remote_type, industry, department, employment_type, description_plain, description_html,
            ats_key, source_job_id, posting_date, posted_at_epoch, first_seen_epoch, last_seen_epoch,
            hidden, parser_version, confidence, quality_score, quality_flags, rejection_reason, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,false,$21,$22,$23,$24::jsonb,$25,now())
          ON CONFLICT(canonical_url) DO UPDATE SET
            company_name = EXCLUDED.company_name,
            position_name = EXCLUDED.position_name,
            apply_url = EXCLUDED.apply_url,
            location_text = COALESCE(EXCLUDED.location_text, postings.location_text),
            city = COALESCE(NULLIF(EXCLUDED.city, ''), postings.city),
            country = COALESCE(NULLIF(EXCLUDED.country, ''), postings.country),
            region = COALESCE(NULLIF(EXCLUDED.region, ''), postings.region),
            remote_type = CASE
              WHEN EXCLUDED.remote_type = 'unknown' AND postings.remote_type <> 'unknown' THEN postings.remote_type
              ELSE EXCLUDED.remote_type
            END,
            industry = EXCLUDED.industry,
            department = COALESCE(NULLIF(EXCLUDED.department, ''), postings.department),
            employment_type = COALESCE(NULLIF(EXCLUDED.employment_type, ''), postings.employment_type),
            description_plain = COALESCE(NULLIF(EXCLUDED.description_plain, ''), postings.description_plain),
            description_html = COALESCE(NULLIF(EXCLUDED.description_html, ''), postings.description_html),
            ats_key = EXCLUDED.ats_key,
            source_job_id = COALESCE(NULLIF(EXCLUDED.source_job_id, ''), postings.source_job_id),
            posting_date = COALESCE(EXCLUDED.posting_date, postings.posting_date),
            posted_at_epoch = COALESCE(EXCLUDED.posted_at_epoch, postings.posted_at_epoch),
            first_seen_epoch = COALESCE(postings.first_seen_epoch, EXCLUDED.first_seen_epoch),
            last_seen_epoch = EXCLUDED.last_seen_epoch,
            hidden = false,
            parser_version = EXCLUDED.parser_version,
            confidence = EXCLUDED.confidence,
            quality_score = EXCLUDED.quality_score,
            quality_flags = EXCLUDED.quality_flags,
            rejection_reason = EXCLUDED.rejection_reason,
            updated_at = now();
        `,
        [
          canonicalUrl,
          companyName,
          title,
          String(posting?.apply_url || canonicalUrl),
          location || null,
          String(posting?.city || ""),
          country,
          region,
          remoteType,
          String(posting?.industry || ""),
          String(posting?.department || ""),
          String(posting?.employment_type || ""),
          String(posting?.description_plain || ""),
          String(posting?.description_html || ""),
          atsKey,
          String(posting?.source_job_id || ""),
          posting?.posting_date || null,
          posting?.posted_at_epoch || posting?.posting_date_epoch || null,
          nowEpoch,
          nowEpoch,
          String(posting?.parser_version || options.parserVersion || "legacy-adapter-v1"),
          Number(gate.confidence || posting?.confidence || posting?.parser_confidence || 0.5),
          quality.quality_score,
          quality.quality_flags,
          quality.rejection_reason
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await upsertMeiliPostings(normalizedForSearchIndex, getMeiliConfig());
}

async function prunePostgresRetention(pool, options = {}) {
  const config = options.config || getRetentionConfig();
  const cutoffs = getRetentionCutoffs(options.referenceEpoch, config);
  const batchSize = Math.max(1, Math.min(10000, Number(options.batchSize || 5000)));
  const client = await pool.connect();
  const stats = {
    hidden_postings: 0,
    deleted_hidden_postings: 0,
    deleted_cache_rows: 0,
    deleted_error_rows: 0,
    deleted_run_rows: 0,
    deleted_outbox_rows: 0,
    outbox_delete_rows: 0
  };

  try {
    await client.query("BEGIN");
    const stale = await client.query(
      `
        SELECT canonical_url
        FROM postings
        WHERE hidden = false
          AND last_seen_epoch < $1
        ORDER BY last_seen_epoch ASC
        LIMIT $2;
      `,
      [cutoffs.staleVisibleEpoch, batchSize]
    );
    const staleUrls = stale.rows.map((row) => String(row.canonical_url || "")).filter(Boolean);
    if (staleUrls.length > 0) {
      const hidden = await client.query(
        `
          UPDATE postings
          SET hidden = true,
              updated_at = now()
          WHERE canonical_url = ANY($1::text[]);
        `,
        [staleUrls]
      );
      stats.hidden_postings = Number(hidden.rowCount || 0);
      for (const canonicalUrl of staleUrls) {
        await client.query(
          `
            INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at)
            VALUES ($1, 'delete', $2::jsonb, now());
          `,
          [canonicalUrl, JSON.stringify({ reason: "retention", canonical_url: canonicalUrl })]
        );
        stats.outbox_delete_rows += 1;
      }
    }

    const deletedHidden = await client.query(
      `
        WITH doomed AS (
          SELECT canonical_url
          FROM postings
          WHERE hidden = true
            AND last_seen_epoch < $1
          ORDER BY last_seen_epoch ASC
          LIMIT $2
        )
        DELETE FROM postings
        WHERE canonical_url IN (SELECT canonical_url FROM doomed);
      `,
      [cutoffs.hiddenArchiveEpoch, batchSize]
    );
    stats.deleted_hidden_postings = Number(deletedHidden.rowCount || 0);

    const deletedCache = await client.query(
      `
        WITH doomed AS (
          SELECT canonical_url
          FROM posting_cache
          WHERE last_seen_epoch < $1
          ORDER BY last_seen_epoch ASC
          LIMIT $2
        )
        DELETE FROM posting_cache
        WHERE canonical_url IN (SELECT canonical_url FROM doomed);
      `,
      [cutoffs.cacheArchiveEpoch, batchSize]
    );
    stats.deleted_cache_rows = Number(deletedCache.rowCount || 0);

    const deletedErrors = await client.query(
      `
        WITH doomed AS (
          SELECT id
          FROM ingestion_run_errors
          WHERE created_at < to_timestamp($1)
          ORDER BY id ASC
          LIMIT $2
        )
        DELETE FROM ingestion_run_errors
        WHERE id IN (SELECT id FROM doomed);
      `,
      [cutoffs.errorArchiveEpoch, batchSize]
    );
    stats.deleted_error_rows = Number(deletedErrors.rowCount || 0);

    const deletedRuns = await client.query(
      `
        WITH doomed AS (
          SELECT id
          FROM ingestion_runs
          WHERE finished_at_epoch IS NOT NULL
            AND finished_at_epoch < $1
          ORDER BY id ASC
          LIMIT $2
        )
        DELETE FROM ingestion_runs
        WHERE id IN (SELECT id FROM doomed);
      `,
      [cutoffs.runArchiveEpoch, batchSize]
    );
    stats.deleted_run_rows = Number(deletedRuns.rowCount || 0);

    const deletedOutbox = await client.query(
      `
        WITH doomed AS (
          SELECT id
          FROM search_index_outbox
          WHERE processed_at IS NOT NULL
            AND processed_at < to_timestamp($1)
          ORDER BY id ASC
          LIMIT $2
        )
        DELETE FROM search_index_outbox
        WHERE id IN (SELECT id FROM doomed);
      `,
      [cutoffs.outboxProcessedEpoch, batchSize]
    );
    stats.deleted_outbox_rows = Number(deletedOutbox.rowCount || 0);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { ok: true, config, cutoffs, stats };
}

async function processPostgresSearchIndexOutbox(pool, options = {}) {
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 250)));
  const result = await pool.query(
    `
      SELECT id, canonical_url, operation, payload
      FROM search_index_outbox
      WHERE processed_at IS NULL
        AND available_at <= now()
      ORDER BY id ASC
      LIMIT $1;
    `,
    [limit]
  );
  const rows = result.rows || [];
  if (rows.length === 0) return { ok: true, processed: 0 };

  const deleteUrls = rows
    .filter((row) => String(row.operation || "") === "delete")
    .map((row) => String(row.canonical_url || ""))
    .filter(Boolean);
  const upsertPayloads = rows
    .filter((row) => String(row.operation || "") === "upsert")
    .map((row) => row.payload)
    .filter(Boolean);

  if (deleteUrls.length > 0) {
    await deleteMeiliPostingsByCanonicalUrls(deleteUrls, getMeiliConfig());
  }
  if (upsertPayloads.length > 0) {
    await upsertMeiliPostings(upsertPayloads, getMeiliConfig());
  }

  await pool.query(
    `
      UPDATE search_index_outbox
      SET processed_at = now()
      WHERE id = ANY($1::bigint[]);
    `,
    [rows.map((row) => Number(row.id)).filter(Boolean)]
  );
  return { ok: true, processed: rows.length, deleted: deleteUrls.length, upserted: upsertPayloads.length };
}

module.exports = {
  buildSearchRankSql,
  applyPostgresSourceQualityProtection,
  checkAndRecordPostgresPayloadDrift,
  getRetentionConfig,
  getRetentionCutoffs,
  getPostgresAtsAdmin,
  getPostgresAtsFieldQualityByAts,
  getPostgresCounts,
  getPostgresFilterOptions,
  getPostgresParserStats,
  getPostgresParserAdmin,
  getPostgresParserAttentionByAts,
  getPostgresPostingDiagnostics,
  getPostgresQualitySummary,
  getPostgresQuarantineSummary,
  getPostgresSourceRunStatus,
  getPostgresSuggestions,
  getPostgresSourceQualityDashboard,
  getPostgresSyncStatus,
  hydratePostgresPostings,
  inferCountry,
  inferRegion,
  inferRemoteType,
  listPostgresIngestionRuns,
  listPostgresIngestionErrors,
  listPostgresIngestionSources,
  listPostgresParserDriftEvents,
  listPostgresRejections,
  listPostgresPostings,
  normalizeAtsKey,
  processPostgresSearchIndexOutbox,
  prunePostgresRetention,
  requestSyncStart,
  requestSyncStop,
  upsertPostgresPostings
};
