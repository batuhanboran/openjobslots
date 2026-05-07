const {
  deleteMeiliPostingsByCanonicalUrls,
  getMeiliConfig,
  searchMeiliPostings,
  upsertMeiliPostings
} = require("../search/meili");
const { getAdapterMetadata } = require("../ingestion/adapter-metadata");

const DAY_SECONDS = 24 * 60 * 60;

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
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function inferCountry(location) {
  const normalized = normalizeText(location);
  if (/\b(turkiye|turkey|turkish|istanbul|ankara|izmir|bodrum|antalya)\b/.test(normalized)) return "Turkey";
  if (/\b(united states|usa|u\.s\.|new york|california|texas)\b/.test(normalized)) return "United States";
  if (/\b(united kingdom|uk|england|london)\b/.test(normalized)) return "United Kingdom";
  if (/\b(germany|deutschland|berlin)\b/.test(normalized)) return "Germany";
  if (/\b(france|paris)\b/.test(normalized)) return "France";
  if (/\b(canada|toronto|vancouver)\b/.test(normalized)) return "Canada";
  return "";
}

function inferRegion(country) {
  if (["Turkey", "United Kingdom", "Germany", "France"].includes(country)) return "EMEA";
  if (["United States", "Canada"].includes(country)) return "North America";
  return "";
}

function inferRemoteType(location) {
  const normalized = normalizeText(location);
  if (/\b(remote|work from home|wfh|anywhere)\b/.test(normalized)) return "remote";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/\b(on[- ]?site|office based|in office)\b/.test(normalized)) return "onsite";
  return "unknown";
}

function normalizeAtsKey(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, "");
  const aliases = {
    ashbyhq: "ashby",
    leverco: "lever",
    greenhouseio: "greenhouse",
    greenhouse: "greenhouse",
    breezyhr: "breezy",
    oraclecloud: "oracle",
    pinpointhqcom: "pinpointhq",
    recruitcrmio: "recruitcrm",
    loxoco: "loxo",
    icims: "icims",
    applicantai: "applicantai",
    adpworkforcenow: "adp_workforcenow",
    workforcenow: "adp_workforcenow"
  };
  return aliases[normalized] || normalized;
}

function parseCsv(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  const rawTokens = String(search || "")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const meaningfulTokens = rawTokens.filter((token) => !SEARCH_STOP_WORDS.has(normalizeText(token)));
  const tokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;
  return tokens.map((token) => {
    const normalized = normalizeText(token);
    const aliases = SEARCH_TOKEN_ALIASES[normalized] || [];
    const expanded = [token, normalized, ...aliases];
    return Array.from(new Set(expanded.map((item) => String(item || "").trim()).filter(Boolean)));
  });
}

function rowToPosting(row) {
  return {
    id: Number(row?.id || 0),
    company_name: String(row?.company_name || ""),
    position_name: String(row?.position_name || ""),
    job_posting_url: String(row?.canonical_url || ""),
    location: row?.location_text || null,
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

  const ats = parseCsv(options.ats).map(normalizeAtsKey);
  const countries = parseCsv(options.countries);
  const regions = parseCsv(options.regions);
  const industries = parseCsv(options.industries);
  const remote = String(options.remote || "all").trim().toLowerCase();
  addIn("p.ats_key", ats);
  addIn("p.country", countries);
  addIn("p.region", regions);
  addIn("p.industry", industries);
  if (remote === "remote" || remote === "hybrid" || remote === "onsite") add("p.remote_type = ?", remote);
  if (remote === "non_remote") where.push("p.remote_type NOT IN ('remote', 'hybrid')");
  if (options.hide_no_date) where.push("p.posting_date IS NOT NULL AND btrim(p.posting_date) <> ''");
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
  if (String(sortBy || "").trim() === "company_asc") {
    return "lower(p.company_name) ASC, lower(p.position_name) ASC, p.canonical_url ASC";
  }
  return "p.last_seen_epoch DESC, p.canonical_url";
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

async function listPostgresPostings(pool, options = {}) {
  const limit = Math.max(1, Math.min(2000, Number(options.limit || 500)));
  const offset = Math.max(0, Number(options.offset || 0));
  const meiliConfig = getMeiliConfig();
  const sortBy = String(options.sort_by || "recent").trim();
  const useMeili = meiliConfig.enabled && sortBy !== "company_asc" && offset + limit <= 2000 && (String(options.search || "").trim() || parseCsv(options.ats).length || parseCsv(options.countries).length || parseCsv(options.regions).length || parseCsv(options.industries).length || String(options.remote || "all") !== "all");

  if (useMeili) {
    try {
      const searchLimit = Math.min(2000, offset + Math.max(limit * 3, limit + 100));
      const searchResult = await searchMeiliPostings({ ...options, limit: searchLimit, offset: 0 }, meiliConfig);
      const urls = (searchResult.hits || []).map((hit) => hit.canonical_url);
      const hydratedItems = await hydratePostgresPostings(pool, urls, options);
      const items = hydratedItems.slice(offset, offset + limit);
      const estimatedTotalHits = Number(searchResult.estimatedTotalHits || 0);
      const count =
        hydratedItems.length === urls.length
          ? estimatedTotalHits
          : estimatedTotalHits <= searchLimit
            ? hydratedItems.length
            : Math.max(offset + items.length, hydratedItems.length);
      return { items, count, limit, offset };
    } catch (error) {
      console.warn("[openjobslots] Meilisearch fallback to Postgres:", String(error?.message || error));
    }
  }

  const filter = buildFilterSql(options, 1);
  const limitIndex = filter.nextIndex;
  const offsetIndex = filter.nextIndex + 1;
  const orderBy = getPostgresOrderBy(sortBy);
  const [countResult, result] = await Promise.all([
    pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM postings p
        LEFT JOIN posting_application_state s
          ON s.canonical_url = p.canonical_url
        WHERE ${filter.where.join(" AND ")};
      `,
      filter.values
    ),
    pool.query(
      `
        SELECT
          row_number() OVER (ORDER BY ${orderBy}) AS id,
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
        ORDER BY ${orderBy}
        LIMIT $${limitIndex} OFFSET $${offsetIndex};
      `,
      [...filter.values, limit, offset]
    )
  ]);
  return { items: result.rows.map(rowToPosting), count: Number(countResult.rows[0]?.count || 0), limit, offset };
}

async function getPostgresCounts(pool) {
  const [companyRow, syncCompanyRow, postingRow, seenRow, atsRows] = await Promise.all([
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
    posting_count: Number(postingRow.rows[0]?.count || 0),
    postings_seen_24h_count: Number(seenRow.rows[0]?.count || 0),
    company_count_by_ats
  };
}

async function getPostgresFilterOptions(pool, atsItems = []) {
  const [sourceRows, countryRows, regionRows, industryRows] = await Promise.all([
    pool.query("SELECT ats_key, display_name, enabled FROM ats_sources ORDER BY display_name;"),
    pool.query("SELECT country AS value, country AS label, region FROM postings WHERE hidden = false AND country <> '' GROUP BY country, region ORDER BY country;"),
    pool.query("SELECT region AS value, region AS label FROM postings WHERE hidden = false AND region <> '' GROUP BY region ORDER BY region;"),
    pool.query("SELECT industry AS value, industry AS label FROM postings WHERE hidden = false AND industry <> '' GROUP BY industry ORDER BY industry;")
  ]);
  const labels = new Map(atsItems.map((item) => [String(item.value), String(item.label)]));
  return {
    ats: sourceRows.rows.map((row) => ({
      value: row.ats_key,
      label: row.display_name || labels.get(row.ats_key) || row.ats_key,
      enabled: Boolean(row.enabled)
    })),
    sort_options: [
      { value: "recent", label: "Most Recently Seen" },
      { value: "company_asc", label: "Company (A-Z)" }
    ],
    industries: industryRows.rows,
    regions: regionRows.rows,
    countries: countryRows.rows,
    states: [],
    counties: []
  };
}

async function getPostgresSuggestions(pool, search, limit = 8) {
  const query = String(search || "").trim();
  const suggestions = [];
  const seen = new Set();
  const add = (type, label, count = 1) => {
    const value = String(label || "").trim();
    const key = `${type}:${normalizeText(value)}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    suggestions.push({ type, value, label: value, count: Number(count || 1) });
  };
  for (const alias of ["remote jobs", "turkish jobs", "t\u00fcrkiye", "turkiye", "turkey"]) {
    if (!query || normalizeText(alias).includes(normalizeText(query))) add("shortcut", alias);
  }
  if (query && suggestions.length < limit) {
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
      [pattern, Math.max(limit, 20)]
    );
    for (const row of rows.rows) {
      add(row.type, row.value, row.count);
      if (suggestions.length >= limit) break;
    }
  }
  return suggestions.slice(0, limit);
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
        ) AS latest_error
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
    latest_error: String(row?.latest_error || "")
  }));
}

async function getPostgresAtsAdmin(pool) {
  const rows = await pool.query(
    `
      SELECT
        s.ats_key,
        s.display_name,
        s.enabled,
        s.default_ttl_seconds,
        s.rate_limit_ms,
        COUNT(c.id)::int AS company_count
      FROM ats_sources s
      LEFT JOIN companies c
        ON c.ats_key = s.ats_key
      GROUP BY s.ats_key, s.display_name, s.enabled, s.default_ttl_seconds, s.rate_limit_ms
      ORDER BY s.display_name ASC;
    `
  );
  return rows.rows.map((row) => ({
    ats_key: String(row?.ats_key || ""),
    display_name: String(row?.display_name || ""),
    enabled: Boolean(row?.enabled),
    default_ttl_seconds: Number(row?.default_ttl_seconds || 0),
    rate_limit_ms: Number(row?.rate_limit_ms || 0),
    company_count: Number(row?.company_count || 0)
  }));
}

async function getPostgresParserAdmin(pool, atsKey) {
  const normalizedAtsKey = normalizeAtsKey(atsKey);
  const source = await pool.query(
    `
      SELECT ats_key, display_name, enabled, default_ttl_seconds, rate_limit_ms
      FROM ats_sources
      WHERE ats_key = $1;
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

  return {
    ats_key: String(source.rows[0].ats_key || ""),
    display_name: String(source.rows[0].display_name || ""),
    enabled: Boolean(source.rows[0].enabled),
    default_ttl_seconds: Number(source.rows[0].default_ttl_seconds || 0),
    rate_limit_ms: Number(source.rows[0].rate_limit_ms || 0),
    parser_version: "postgres-adapter-v1",
    fixture_status: metadata.fixtureStatus,
    confidence: metadata.confidence,
    tier: metadata.tier,
    parse_strategy: metadata.parseStrategy,
    enabled_by_default: metadata.enabledByDefault,
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
    active_ats: Array.isArray(row?.active_ats) ? row.active_ats : [],
    last_error: String(row?.last_error || "")
  }));
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
  const [control, counts, latestRun, due, parserErrors] = await Promise.all([
    getSyncControl(pool),
    getPostgresCounts(pool),
    pool.query("SELECT * FROM ingestion_runs ORDER BY id DESC LIMIT 1;"),
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
    last_sync_summary: {
      total_companies: Number(run.total_targets || 0),
      failed_companies: Number(run.failure_count || 0),
      total_postings_stored: Number(run.posting_upsert_count || 0)
    },
    db_backend: "postgres",
    search_backend: getMeiliConfig().enabled ? "meili" : "postgres",
    queue_backend: process.env.OPENJOBSLOTS_QUEUE_BACKEND || "postgres-sync-control",
    queue_depth: Number(due.rows[0]?.count || 0),
    sync_enabled_company_count: counts.sync_enabled_company_count,
    configured_enabled_ats_count: Array.isArray(run.active_ats) ? run.active_ats.length : 0,
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
      queue_due_count: Number(due.rows[0]?.count || 0),
      parser_error_count_24h: Number(parserErrors.rows[0]?.count || 0),
      active_ats: Array.isArray(run.active_ats) ? run.active_ats : [],
      last_error: String(run.last_error || "")
    },
    ...counts
  };
}

async function upsertPostgresPostings(pool, postings, options = {}) {
  const nowEpoch = Number(options.nowEpoch || Math.floor(Date.now() / 1000));
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
      const remoteType = String(posting?.remote_type || inferRemoteType(location)).trim() || "unknown";
      const atsKey = normalizeAtsKey(posting?.ats_key || posting?.ATS_name);
      await client.query(
        `
          INSERT INTO postings (
            canonical_url, company_name, position_name, apply_url, location_text, country, region,
            remote_type, industry, ats_key, source_job_id, posting_date, posted_at_epoch,
            first_seen_epoch, last_seen_epoch, hidden, parser_version, confidence, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,$16,$17,now())
          ON CONFLICT(canonical_url) DO UPDATE SET
            company_name = EXCLUDED.company_name,
            position_name = EXCLUDED.position_name,
            apply_url = EXCLUDED.apply_url,
            location_text = COALESCE(EXCLUDED.location_text, postings.location_text),
            country = COALESCE(NULLIF(EXCLUDED.country, ''), postings.country),
            region = COALESCE(NULLIF(EXCLUDED.region, ''), postings.region),
            remote_type = EXCLUDED.remote_type,
            industry = EXCLUDED.industry,
            ats_key = EXCLUDED.ats_key,
            source_job_id = EXCLUDED.source_job_id,
            posting_date = COALESCE(EXCLUDED.posting_date, postings.posting_date),
            posted_at_epoch = COALESCE(EXCLUDED.posted_at_epoch, postings.posted_at_epoch),
            first_seen_epoch = COALESCE(postings.first_seen_epoch, EXCLUDED.first_seen_epoch),
            last_seen_epoch = EXCLUDED.last_seen_epoch,
            hidden = false,
            parser_version = EXCLUDED.parser_version,
            confidence = EXCLUDED.confidence,
            updated_at = now();
        `,
        [
          canonicalUrl,
          companyName,
          title,
          String(posting?.apply_url || canonicalUrl),
          location || null,
          country,
          region,
          remoteType,
          String(posting?.industry || ""),
          atsKey,
          String(posting?.source_job_id || ""),
          posting?.posting_date || null,
          posting?.posted_at_epoch || posting?.posting_date_epoch || null,
          nowEpoch,
          nowEpoch,
          String(posting?.parser_version || options.parserVersion || "legacy-adapter-v1"),
          Number(posting?.confidence || 0.5)
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

  await upsertMeiliPostings(
    (Array.isArray(postings) ? postings : []).map((posting) => ({ ...posting, hidden: false })),
    getMeiliConfig()
  );
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
  getRetentionConfig,
  getRetentionCutoffs,
  getPostgresAtsAdmin,
  getPostgresCounts,
  getPostgresFilterOptions,
  getPostgresParserAdmin,
  getPostgresParserAttentionByAts,
  getPostgresSuggestions,
  getPostgresSyncStatus,
  hydratePostgresPostings,
  inferCountry,
  inferRegion,
  inferRemoteType,
  listPostgresIngestionRuns,
  listPostgresPostings,
  normalizeAtsKey,
  processPostgresSearchIndexOutbox,
  prunePostgresRetention,
  requestSyncStart,
  requestSyncStop,
  upsertPostgresPostings
};
