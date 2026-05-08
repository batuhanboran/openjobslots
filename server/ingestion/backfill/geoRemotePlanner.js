const fs = require("fs");
const path = require("path");
const { createPostgresPool } = require("../../backends/postgres");
const { openSqliteReadOnly } = require("../dataQualityAudit");
const { parseQualityFlags } = require("../dataQuality");
const {
  normalizeCountryName,
  normalizeRegionFromCountry,
  normalizePostingValue
} = require("../posting");

const FIX_CATEGORIES = [
  "fixable_country",
  "fixable_region",
  "fixable_city",
  "fixable_location_text",
  "fixable_remote_type",
  "fixable_quality_flags_only",
  "needs_detail_refetch",
  "unsafe_ambiguous",
  "no_evidence"
];

const US_STATES = Object.freeze({
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DC: "District of Columbia",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Michigan",
  MN: "Minnesota",
  MO: "Missouri",
  MS: "Mississippi",
  MT: "Montana",
  NC: "North Carolina",
  ND: "North Dakota",
  NE: "Nebraska",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NV: "Nevada",
  NY: "New York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "West Virginia",
  WY: "Wyoming"
});

const COUNTRY_ALIASES = Object.freeze({
  turkey: "Turkey",
  turkiye: "Turkey",
  türkiye: "Turkey",
  tr: "Turkey",
  tur: "Turkey",
  "united states": "United States",
  "united states of america": "United States",
  usa: "United States",
  us: "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  "united kingdom": "United Kingdom",
  uk: "United Kingdom",
  gb: "United Kingdom",
  england: "United Kingdom",
  germany: "Germany",
  deutschland: "Germany",
  india: "India",
  israel: "Israel",
  canada: "Canada",
  france: "France",
  netherlands: "Netherlands",
  spain: "Spain",
  italy: "Italy",
  ireland: "Ireland"
});

const COUNTRY_CODE_ALIASES = Object.freeze({
  TR: "Turkey",
  TUR: "Turkey",
  US: "United States",
  USA: "United States",
  GB: "United Kingdom",
  GBR: "United Kingdom",
  UK: "United Kingdom",
  DE: "Germany",
  DEU: "Germany",
  IN: "India",
  IND: "India",
  IL: "Israel",
  ISR: "Israel",
  CA: "Canada",
  CAN: "Canada",
  FR: "France",
  FRA: "France",
  NL: "Netherlands",
  ES: "Spain",
  IT: "Italy",
  IE: "Ireland"
});

const CITY_ALIASES = Object.freeze({
  istanbul: { city: "Istanbul", country: "Turkey" },
  ankara: { city: "Ankara", country: "Turkey" },
  izmir: { city: "Izmir", country: "Turkey" },
  london: { city: "London", country: "United Kingdom" },
  berlin: { city: "Berlin", country: "Germany" },
  munich: { city: "Munich", country: "Germany" },
  "new york": { city: "New York", country: "United States", region: "New York" },
  "san francisco": { city: "San Francisco", country: "United States", region: "California" },
  chicago: { city: "Chicago", country: "United States", region: "Illinois" },
  seattle: { city: "Seattle", country: "United States", region: "Washington" },
  boston: { city: "Boston", country: "United States", region: "Massachusetts" },
  austin: { city: "Austin", country: "United States", region: "Texas" },
  dallas: { city: "Dallas", country: "United States", region: "Texas" },
  bengaluru: { city: "Bengaluru", country: "India" },
  bangalore: { city: "Bengaluru", country: "India" },
  delhi: { city: "Delhi", country: "India" },
  mumbai: { city: "Mumbai", country: "India" },
  hyderabad: { city: "Hyderabad", country: "India" },
  "tel aviv": { city: "Tel Aviv", country: "Israel" }
});

const SUSPICIOUS_LOCATION_RE = /^(unknown|n\/?a|not available|not specified|tbd|various|multiple locations?|all locations?|worldwide|global|anywhere)$/i;
const MULTI_LOCATION_RE = /\b(multiple|various|all)\s+(locations?|states|sites|campuses)\b|\/|;|\bor\b/i;
const REMOTE_RE = /\b(remote|fully remote|work from home|wfh|work from anywhere|distributed|virtual|telecommute|telework)\b/i;
const HYBRID_RE = /\b(hybrid|partly remote|partially remote)\b/i;
const ONSITE_RE = /\b(on[- ]?site|onsite|in office|office based|work from office)\b/i;
const TITLE_REMOTE_RE = /(?:^|\(|\[|\s-\s)remote(?:$|\)|\]|\s-\s)/i;
const TITLE_HYBRID_RE = /(?:^|\(|\[|\s-\s)hybrid(?:$|\)|\]|\s-\s)/i;

function clean(value) {
  return String(value ?? "").trim();
}

function norm(value) {
  return normalizePostingValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isBlank(value) {
  const normalized = norm(value);
  return !normalized || ["unknown", "n/a", "na", "none", "null", "undefined", "not available", "not specified"].includes(normalized);
}

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function flattenValues(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => flattenValues(item, depth + 1));
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => {
      const lowerKey = norm(key);
      if (/(token|secret|password|key|authorization|cookie)/.test(lowerKey)) return [];
      return flattenValues(entry, depth + 1);
    });
  }
  return [];
}

function extractObjectValue(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const key of keys) {
    if (obj[key] !== null && obj[key] !== undefined && clean(obj[key])) return clean(obj[key]);
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const nested = extractObjectValue(value, keys);
      if (nested) return nested;
    }
  }
  return "";
}

function getRawMetadata(row) {
  return parseJsonMaybe(row.raw_metadata) || parseJsonMaybe(row.payload) || {};
}

function collectLocationCandidates(row) {
  const raw = getRawMetadata(row);
  const candidates = [
    row.location_text,
    row.location,
    row.source_location,
    row.workplace,
    extractObjectValue(raw, [
      "location_text",
      "location",
      "locations",
      "jobLocation",
      "jobLocations",
      "primaryLocation",
      "PrimaryLocation",
      "workLocation",
      "workplace",
      "workplaceLocation",
      "city",
      "country",
      "countryName"
    ])
  ].map(clean).filter(Boolean);
  return Array.from(new Set(candidates));
}

function collectRemoteCandidates(row) {
  const raw = getRawMetadata(row);
  const structuredRemoteEvidence = [
    extractObjectValue(raw, [
      "remote",
      "isRemote",
      "remoteAllowed",
      "workplace",
      "workplaceType",
      "workplace_type",
      "remoteType",
      "remote_type",
      "employmentMode",
      "workArrangement",
      "jobWorkplace",
      "officeRequirement"
    ]),
    extractObjectValue(raw, ["location", "locations", "jobLocation", "jobLocations", "primaryLocation", "workLocation"])
  ].filter((value) => /\b(remote|hybrid|onsite|on-site|office|telework|work from home|wfh|virtual)\b/i.test(value));
  return [
    row.remote_type,
    row.workplace,
    row.workplace_type,
    row.workplaceType,
    row.location_text,
    row.location,
    ...structuredRemoteEvidence
  ].map(clean).filter(Boolean);
}

function normalizeCountry(value) {
  const normalized = norm(value).replace(/\s+/g, " ");
  return COUNTRY_ALIASES[normalized] || normalizeCountryName(value) || "";
}

function codeToCountry(code) {
  const upper = clean(code).toUpperCase().replace(/[^A-Z]/g, "");
  return COUNTRY_CODE_ALIASES[upper] || "";
}

function titleCase(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function parseCountryCodePattern(location) {
  const trimmed = clean(location);
  const match = trimmed.match(/^([A-Z]{2,3})[-\s]([A-Z]{2,3}|Remote|Hybrid|Virtual)[-\s,]+(.+)$/i);
  if (!match) return null;
  const country = codeToCountry(match[1]);
  if (!country) return null;
  const stateOrMode = clean(match[2]);
  const tail = clean(match[3]);
  const result = { country, region: normalizeRegionFromCountry(country), city: "", rule: "country-code-location" };
  if (country === "United States" && US_STATES[stateOrMode.toUpperCase()]) {
    result.region = US_STATES[stateOrMode.toUpperCase()];
  } else if (country === "India" && stateOrMode.length === 2) {
    result.region = stateOrMode.toUpperCase();
  } else if (country === "Israel" && stateOrMode.length === 2) {
    result.region = normalizeRegionFromCountry(country);
  }
  if (!REMOTE_RE.test(tail) && !HYBRID_RE.test(tail)) result.city = titleCase(tail.split(/[,-]/)[0]);
  return result;
}

function parseDelimitedLocation(location) {
  const trimmed = clean(location);
  if (!trimmed || SUSPICIOUS_LOCATION_RE.test(trimmed)) return { evidence: null, unsafe: false, reason: "no-location-evidence" };
  if (MULTI_LOCATION_RE.test(trimmed)) return { evidence: null, unsafe: true, reason: "multi-location" };

  const codePattern = parseCountryCodePattern(trimmed);
  if (codePattern) return { evidence: codePattern, unsafe: false };

  const parts = trimmed
    .replace(/\s+-\s+/g, ", ")
    .split(",")
    .map(clean)
    .filter(Boolean);
  const lowerParts = parts.map(norm);
  const countryPart = [...parts].reverse().find((part) => {
    const normalizedPart = norm(part);
    if (normalizedPart === "in" || normalizedPart === "il") return false;
    return normalizeCountry(part);
  });
  const country = countryPart ? normalizeCountry(countryPart) : "";
  const countryEvidence = Boolean(country);
  const stateAbbrev = parts.find((part) => US_STATES[part.toUpperCase()]);

  if (parts.length === 1) {
    const only = parts[0];
    const upper = only.toUpperCase();
    if (upper === "IN" || upper === "IL") return { evidence: null, unsafe: true, reason: "ambiguous-country-or-state-code" };
    const onlyCountry = normalizeCountry(only);
    if (onlyCountry) return { evidence: { country: onlyCountry, region: normalizeRegionFromCountry(onlyCountry), city: "", rule: "country-alias" }, unsafe: false };
    const city = CITY_ALIASES[norm(only)];
    if (city) return { evidence: { country: city.country, region: city.region || normalizeRegionFromCountry(city.country), city: city.city, rule: "city-alias" }, unsafe: false };
    return { evidence: null, unsafe: false, reason: "no-deterministic-location" };
  }

  if (stateAbbrev && !countryEvidence) {
    return { evidence: null, unsafe: true, reason: "state-abbrev-without-country" };
  }

  if (stateAbbrev && country === "United States") {
    const cityPart = parts.find((part) => part !== stateAbbrev && normalizeCountry(part) !== "United States");
    return {
      evidence: {
        country,
        region: US_STATES[stateAbbrev.toUpperCase()],
        city: cityPart ? titleCase(cityPart) : "",
        rule: "us-state-with-country"
      },
      unsafe: false
    };
  }

  if (country) {
    const cityPart = parts.find((part) => normalizeCountry(part) !== country && !REMOTE_RE.test(part) && !HYBRID_RE.test(part));
    const cityAlias = cityPart ? CITY_ALIASES[norm(cityPart)] : null;
    return {
      evidence: {
        country,
        region: cityAlias?.region || normalizeRegionFromCountry(country),
        city: cityAlias?.city || (cityPart && !COUNTRY_ALIASES[norm(cityPart)] ? titleCase(cityPart) : ""),
        rule: "country-alias-with-location"
      },
      unsafe: false
    };
  }

  const cityPart = lowerParts.map((part) => CITY_ALIASES[part]).find(Boolean);
  if (cityPart) {
    return { evidence: { country: cityPart.country, region: cityPart.region || normalizeRegionFromCountry(cityPart.country), city: cityPart.city, rule: "city-alias" }, unsafe: false };
  }

  return { evidence: null, unsafe: false, reason: "no-deterministic-location" };
}

function parseGeoEvidence(row) {
  const candidates = collectLocationCandidates(row);
  for (const candidate of candidates) {
    const parsed = parseDelimitedLocation(candidate);
    if (parsed.unsafe) return { ...parsed, source: candidate };
    if (parsed.evidence) return { ...parsed, source: candidate };
  }
  return { evidence: null, unsafe: false, reason: "no-evidence" };
}

function parseRemoteEvidence(row) {
  const existing = norm(row.remote_type);
  if (["remote", "hybrid", "onsite"].includes(existing)) {
    return { value: "", rule: "already-normalized", confidence: 1 };
  }

  const candidates = collectRemoteCandidates(row);
  for (const candidate of candidates) {
    if (HYBRID_RE.test(candidate)) return { value: "hybrid", rule: "explicit-hybrid-evidence", confidence: 0.93, source: candidate };
    if (REMOTE_RE.test(candidate)) return { value: "remote", rule: "explicit-remote-evidence", confidence: 0.93, source: candidate };
    if (ONSITE_RE.test(candidate)) return { value: "onsite", rule: "explicit-onsite-evidence", confidence: 0.88, source: candidate };
  }

  const title = clean(row.position_name || row.title);
  if (TITLE_HYBRID_RE.test(title)) return { value: "hybrid", rule: "title-delimited-hybrid", confidence: 0.78, source: title };
  if (TITLE_REMOTE_RE.test(title)) return { value: "remote", rule: "title-delimited-remote", confidence: 0.78, source: title };

  return { value: "", rule: "no-strong-remote-evidence", confidence: 0 };
}

function addChange(changes, field, before, after, rule, confidence) {
  const normalizedAfter = clean(after);
  if (!normalizedAfter || clean(before) === normalizedAfter) return;
  changes.push({
    field,
    before: clean(before),
    after: normalizedAfter,
    rule,
    confidence
  });
}

function expectedQualityFlagsAfter(row, changes) {
  const next = { ...row };
  for (const change of changes) next[change.field] = change.after;
  const flags = new Set(parseQualityFlags(next.quality_flags));
  if (isBlank(next.location_text)) flags.add("missing_location_text");
  else flags.delete("missing_location_text");
  if (isBlank(next.country)) flags.add("missing_country");
  else flags.delete("missing_country");
  if (isBlank(next.region)) flags.add("missing_region");
  else flags.delete("missing_region");
  if (isBlank(next.city)) flags.add("missing_city");
  else flags.delete("missing_city");
  if (!["remote", "hybrid", "onsite"].includes(norm(next.remote_type))) flags.add("weak_remote_classification");
  else flags.delete("weak_remote_classification");
  return Array.from(flags).sort();
}

function classifyBackfillCandidate(row) {
  const changes = [];
  const categories = new Set();
  const geo = parseGeoEvidence(row);
  const locationEvidence = clean(geo.source || "");

  if (geo.evidence) {
    if (isBlank(row.location_text) && locationEvidence && !SUSPICIOUS_LOCATION_RE.test(locationEvidence)) {
      addChange(changes, "location_text", row.location_text, locationEvidence, "source-location-text", 0.8);
      categories.add("fixable_location_text");
    }
    if (isBlank(row.country) && geo.evidence.country) {
      addChange(changes, "country", row.country, geo.evidence.country, geo.evidence.rule, 0.9);
      categories.add("fixable_country");
    }
    if (isBlank(row.region) && geo.evidence.region) {
      addChange(changes, "region", row.region, geo.evidence.region, geo.evidence.rule, 0.85);
      categories.add("fixable_region");
    }
    if (isBlank(row.city) && geo.evidence.city) {
      addChange(changes, "city", row.city, geo.evidence.city, geo.evidence.rule, 0.82);
      categories.add("fixable_city");
    }
  } else if (geo.unsafe) {
    categories.add("unsafe_ambiguous");
  }

  const remote = parseRemoteEvidence(row);
  if (remote.value && isBlank(row.remote_type)) {
    addChange(changes, "remote_type", row.remote_type, remote.value, remote.rule, remote.confidence);
    categories.add("fixable_remote_type");
  }

  const atsKey = norm(row.ats_key || row.source_ats);
  const hasConcreteFieldFix = Array.from(categories).some((category) => category.startsWith("fixable_") && category !== "fixable_quality_flags_only");
  if (!hasConcreteFieldFix && !categories.has("unsafe_ambiguous") && ["icims", "applitrack"].includes(atsKey) && (isBlank(row.location_text) || isBlank(row.country) || isBlank(row.region))) {
    categories.add("needs_detail_refetch");
  }

  const expectedFlags = expectedQualityFlagsAfter(row, changes);
  const currentFlags = parseQualityFlags(row.quality_flags).sort();
  const flagsChanged = JSON.stringify(expectedFlags) !== JSON.stringify(currentFlags);
  if (flagsChanged) {
    changes.push({
      field: "quality_flags",
      before: currentFlags,
      after: expectedFlags,
      rule: "derive-quality-flags-from-stored-fields",
      confidence: 1
    });
    if (categories.size === 0) categories.add("fixable_quality_flags_only");
  }

  if (categories.size === 0) categories.add("no_evidence");

  return {
    canonical_url: clean(row.canonical_url || row.job_posting_url),
    source_ats: clean(row.ats_key || row.source_ats || "unknown"),
    parser_version: clean(row.parser_version || "unknown"),
    title: clean(row.position_name || row.title),
    company: clean(row.company_name || row.company),
    before: {
      location_text: clean(row.location_text),
      country: clean(row.country),
      region: clean(row.region),
      city: clean(row.city),
      remote_type: clean(row.remote_type || "unknown"),
      quality_flags: currentFlags
    },
    after: {
      location_text: changes.find((item) => item.field === "location_text")?.after || clean(row.location_text),
      country: changes.find((item) => item.field === "country")?.after || clean(row.country),
      region: changes.find((item) => item.field === "region")?.after || clean(row.region),
      city: changes.find((item) => item.field === "city")?.after || clean(row.city),
      remote_type: changes.find((item) => item.field === "remote_type")?.after || clean(row.remote_type || "unknown"),
      quality_flags: expectedFlags
    },
    classifications: Array.from(categories).sort(),
    primary_classification: Array.from(categories).sort()[0],
    changes,
    evidence: {
      geo_rule: geo.evidence?.rule || geo.reason || "",
      geo_source: geo.source || "",
      remote_rule: remote.rule || "",
      remote_source: remote.source || ""
    }
  };
}

function summarizePlan(rows, options = {}) {
  const sampleLimit = Math.max(1, Math.min(100, Number(options.sample || 10)));
  const summary = {
    total_scanned: rows.length,
    proposed_updates_by_field: {},
    proposed_updates_by_source: {},
    proposed_updates_by_parser_version: {},
    classification_counts: Object.fromEntries(FIX_CATEGORIES.map((category) => [category, 0])),
    rows_requiring_icims_detail_refetch: 0,
    rows_requiring_applitrack_detail_refetch: 0,
    icims_detail_refetch_rows: [],
    applitrack_detail_refetch_rows: [],
    unsafe_ambiguous_rows: 0,
    unsafe_ambiguous_samples: [],
    sample_before_after_rows: []
  };

  for (const row of rows) {
    const planned = classifyBackfillCandidate(row);
    for (const category of planned.classifications) {
      summary.classification_counts[category] = Number(summary.classification_counts[category] || 0) + 1;
    }
    for (const change of planned.changes) {
      summary.proposed_updates_by_field[change.field] = Number(summary.proposed_updates_by_field[change.field] || 0) + 1;
      summary.proposed_updates_by_source[planned.source_ats] = Number(summary.proposed_updates_by_source[planned.source_ats] || 0) + 1;
      summary.proposed_updates_by_parser_version[planned.parser_version] = Number(summary.proposed_updates_by_parser_version[planned.parser_version] || 0) + 1;
    }
    if (planned.classifications.includes("needs_detail_refetch") && norm(planned.source_ats) === "icims") {
      summary.rows_requiring_icims_detail_refetch += 1;
      if (summary.icims_detail_refetch_rows.length < sampleLimit) summary.icims_detail_refetch_rows.push(planned);
    }
    if (planned.classifications.includes("needs_detail_refetch") && norm(planned.source_ats) === "applitrack") {
      summary.rows_requiring_applitrack_detail_refetch += 1;
      if (summary.applitrack_detail_refetch_rows.length < sampleLimit) summary.applitrack_detail_refetch_rows.push(planned);
    }
    if (planned.classifications.includes("unsafe_ambiguous")) {
      summary.unsafe_ambiguous_rows += 1;
      if (summary.unsafe_ambiguous_samples.length < sampleLimit) summary.unsafe_ambiguous_samples.push(planned);
    }
    if (summary.sample_before_after_rows.length < sampleLimit && planned.changes.length > 0) {
      summary.sample_before_after_rows.push(planned);
    }
  }

  return summary;
}

function parseArgs(argv = []) {
  const options = {
    limit: 100,
    source: "",
    json: false,
    sample: 10,
    output: "",
    noProductionWrite: false
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--no-production-write") options.noProductionWrite = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--source=")) options.source = clean(arg.slice("--source=".length)).toLowerCase();
    else if (arg.startsWith("--sample=")) options.sample = Number(arg.slice("--sample=".length));
    else if (arg.startsWith("--output=")) options.output = clean(arg.slice("--output=".length));
  }
  options.limit = Math.max(1, Math.min(100000, Number(options.limit || 100)));
  options.sample = Math.max(1, Math.min(100, Number(options.sample || 10)));
  return options;
}

async function queryPostgresRows(pool, options = {}) {
  const params = [options.limit];
  const sourceClause = options.source ? "AND p.ats_key = $2" : "";
  if (options.source) params.push(options.source);
  const result = await pool.query(
    `
      SELECT
        p.canonical_url,
        p.ats_key,
        p.company_name,
        p.position_name,
        p.location_text,
        p.country,
        p.region,
        p.city,
        p.remote_type,
        p.parser_version,
        p.quality_flags,
        pc.raw_metadata
      FROM postings p
      LEFT JOIN posting_cache pc
        ON pc.canonical_url = p.canonical_url
      WHERE p.hidden = false
        ${sourceClause}
        AND (
          btrim(coalesce(p.country, '')) = ''
          OR btrim(coalesce(p.region, '')) = ''
          OR btrim(coalesce(p.city, '')) = ''
          OR btrim(coalesce(p.location_text, '')) = ''
          OR lower(btrim(coalesce(p.remote_type, ''))) IN ('', 'unknown', 'n/a', 'na')
        )
      ORDER BY p.last_seen_epoch DESC, p.canonical_url ASC
      LIMIT $1;
    `,
    params
  );
  return result.rows || [];
}

async function querySqliteRows(db, options = {}) {
  const sourceFilter = options.source ? "AND lower(coalesce(ats_key, '')) = ?" : "";
  const params = options.source ? [options.source, options.limit] : [options.limit];
  try {
    return await db.all(
      `
        SELECT
          job_posting_url AS canonical_url,
          coalesce(ats_key, '') AS ats_key,
          company_name,
          position_name,
          coalesce(location_text, location, '') AS location_text,
          coalesce(country, '') AS country,
          coalesce(region, '') AS region,
          coalesce(city, '') AS city,
          coalesce(remote_type, 'unknown') AS remote_type,
          coalesce(parser_version, 'legacy-adapter-v1') AS parser_version,
          coalesce(quality_flags, '[]') AS quality_flags,
          '{}' AS raw_metadata
        FROM Postings
        WHERE coalesce(hidden, 0) = 0
          ${sourceFilter}
        LIMIT ?;
      `,
      params
    );
  } catch {
    return await db.all(
      `
        SELECT
          job_posting_url AS canonical_url,
          '' AS ats_key,
          company_name,
          position_name,
          coalesce(location, '') AS location_text,
          '' AS country,
          '' AS region,
          '' AS city,
          'unknown' AS remote_type,
          'legacy-adapter-v1' AS parser_version,
          '[]' AS quality_flags,
          '{}' AS raw_metadata
        FROM Postings
        WHERE coalesce(hidden, 0) = 0
        LIMIT ?;
      `,
      [options.limit]
    );
  }
}

async function runDryRun(options = parseArgs(process.argv.slice(2)), env = process.env) {
  const dbBackend = clean(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").toLowerCase();
  let rows = [];
  if (dbBackend === "postgres") {
    const pool = createPostgresPool({ enabled: true, connectionString: env.DATABASE_URL || env.POSTGRES_URL || "" });
    try {
      rows = await queryPostgresRows(pool, options);
    } finally {
      await pool.end();
    }
  } else {
    const dbPath = env.DB_PATH || path.resolve(__dirname, "..", "..", "..", "jobs.db");
    const db = await openSqliteReadOnly(dbPath);
    try {
      rows = await querySqliteRows(db, options);
    } finally {
      await db.close();
    }
  }
  const report = {
    ok: true,
    dry_run: true,
    no_production_write: true,
    db_backend: dbBackend,
    source_filter: options.source || "",
    limit: options.limit,
    ...summarizePlan(rows, options)
  };
  if (options.output) {
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(path.resolve(options.output), JSON.stringify(report, null, 2));
  }
  return report;
}

module.exports = {
  classifyBackfillCandidate,
  parseArgs,
  parseDelimitedLocation,
  parseGeoEvidence,
  parseRemoteEvidence,
  runDryRun,
  summarizePlan
};
