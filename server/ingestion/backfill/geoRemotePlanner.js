const fs = require("fs");
const path = require("path");
const { createPostgresPool } = require("../../backends/postgres");
const { acquireHeavyJobLock } = require("../../backends/heavyJobLock");
const { openSqliteReadOnly } = require("../dataQualityAudit");
const { parseQualityFlags, scorePostingQuality } = require("../dataQuality");
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

const WRITABLE_FIELDS = Object.freeze(["location_text", "country", "region", "city", "remote_type", "quality_flags", "quality_score"]);
const GEO_REMOTE_BACKFILL_AUDIT_SCHEMA_VERSION = "geo-remote-backfill-audit-v1";

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

function expectedQualityStateAfter(row, changes) {
  const flags = expectedQualityFlagsAfter(row, changes);
  const next = { ...row };
  for (const change of changes) next[change.field] = change.after;
  next.quality_flags = flags;
  return {
    flags,
    score: scorePostingQuality(flags, { ...next, quality_score: undefined })
  };
}

function parseStoredQualityScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
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

  const expectedQuality = expectedQualityStateAfter(row, changes);
  const expectedFlags = expectedQuality.flags;
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
  const currentQualityScore = parseStoredQualityScore(row.quality_score);
  if (expectedQuality.score !== currentQualityScore) {
    changes.push({
      field: "quality_score",
      before: String(currentQualityScore),
      after: String(expectedQuality.score),
      rule: "derive-quality-score-from-quality-flags",
      confidence: 1
    });
    if (categories.size === 0) categories.add("fixable_quality_flags_only");
  }

  if (categories.size === 0) categories.add("no_evidence");

  return {
    row_identifier: clean(row.row_id || row.id || row.canonical_url || row.job_posting_url),
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
      quality_flags: currentFlags,
      quality_score: currentQualityScore
    },
    after: {
      location_text: changes.find((item) => item.field === "location_text")?.after || clean(row.location_text),
      country: changes.find((item) => item.field === "country")?.after || clean(row.country),
      region: changes.find((item) => item.field === "region")?.after || clean(row.region),
      city: changes.find((item) => item.field === "city")?.after || clean(row.city),
      remote_type: changes.find((item) => item.field === "remote_type")?.after || clean(row.remote_type || "unknown"),
      quality_flags: expectedFlags,
      quality_score: expectedQuality.score
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
    noProductionWrite: false,
    apply: false,
    confirmProduction: false,
    backupConfirmed: false,
    maxUpdates: 0,
    batchSize: 100,
    continueOnError: false,
    resumeRunId: "",
    rollbackRunId: "",
    operator: clean(process.env.USERNAME || process.env.USER || "codex")
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--no-production-write") options.noProductionWrite = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg === "--backup-confirmed") options.backupConfirmed = true;
    else if (arg === "--continue-on-error") options.continueOnError = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--source=")) options.source = clean(arg.slice("--source=".length)).toLowerCase();
    else if (arg.startsWith("--sample=")) options.sample = Number(arg.slice("--sample=".length));
    else if (arg.startsWith("--output=")) options.output = clean(arg.slice("--output=".length));
    else if (arg.startsWith("--max-updates=")) options.maxUpdates = Number(arg.slice("--max-updates=".length));
    else if (arg.startsWith("--batch-size=")) options.batchSize = Number(arg.slice("--batch-size=".length));
    else if (arg.startsWith("--resume-run-id=")) options.resumeRunId = clean(arg.slice("--resume-run-id=".length));
    else if (arg.startsWith("--run-id=")) options.rollbackRunId = clean(arg.slice("--run-id=".length));
    else if (arg.startsWith("--operator=")) options.operator = clean(arg.slice("--operator=".length));
  }
  options.limit = Math.max(1, Math.min(100000, Number(options.limit || 100)));
  options.sample = Math.max(1, Math.min(100, Number(options.sample || 10)));
  options.maxUpdates = Math.max(0, Math.min(100000, Number(options.maxUpdates || 0)));
  options.batchSize = Math.max(1, Math.min(5000, Number(options.batchSize || 100)));
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
        p.canonical_url AS row_id,
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
        p.quality_score,
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
          rowid AS row_id,
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
          coalesce(quality_score, 0) AS quality_score,
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
          rowid AS row_id,
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
          0 AS quality_score,
          '{}' AS raw_metadata
        FROM Postings
        WHERE coalesce(hidden, 0) = 0
        LIMIT ?;
      `,
      [options.limit]
    );
  }
}

function serializeAuditValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value);
  return String(value ?? "");
}

function parseAuditValue(value, field) {
  if (field === "quality_flags") {
    return JSON.stringify(parseQualityFlags(value));
  }
  if (field === "quality_score") return String(parseStoredQualityScore(value));
  return clean(value);
}

function isApplyAuthorized(options = {}) {
  return Boolean(options.apply && options.confirmProduction && options.backupConfirmed && Number(options.maxUpdates || 0) > 0);
}

function getSafetyGate(options = {}) {
  return {
    apply_requested: Boolean(options.apply),
    authorized: isApplyAuthorized(options),
    required_flags: ["--apply", "--confirm-production", "--backup-confirmed", "--max-updates=N"],
    present: {
      apply: Boolean(options.apply),
      confirm_production: Boolean(options.confirmProduction),
      backup_confirmed: Boolean(options.backupConfirmed),
      max_updates: Number(options.maxUpdates || 0)
    }
  };
}

function canApplyPlan(plan) {
  if (!plan || !Array.isArray(plan.changes) || plan.changes.length === 0) return false;
  if (plan.classifications.includes("unsafe_ambiguous")) return false;
  if (plan.classifications.includes("no_evidence")) return false;
  if (plan.classifications.includes("needs_detail_refetch")) return false;
  for (const change of plan.changes) {
    if (!WRITABLE_FIELDS.includes(change.field)) return false;
    if (change.field === "remote_type" && !["remote", "hybrid", "onsite"].includes(clean(change.after))) return false;
    if (change.field === "remote_type" && ["remote", "hybrid", "onsite"].includes(norm(change.before))) return false;
    if (["location_text", "country", "region", "city"].includes(change.field) && !isBlank(change.before)) return false;
    if (change.field === "city" && !clean(change.after)) return false;
  }
  return true;
}

function createRunId(prefix = "geo-remote") {
  const random = Math.random().toString(16).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function openSqliteWritable(dbPath) {
  const sqlite3 = require("sqlite3");
  const resolved = path.resolve(dbPath || "jobs.db");
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(resolved, (error) => {
      if (error) reject(error);
      else {
        resolve({
          all(sql, params = []) {
            return new Promise((innerResolve, innerReject) => {
              db.all(sql, params, (queryError, rows) => {
                if (queryError) innerReject(queryError);
                else innerResolve(rows || []);
              });
            });
          },
          run(sql, params = []) {
            return new Promise((innerResolve, innerReject) => {
              db.run(sql, params, function onRun(runError) {
                if (runError) innerReject(runError);
                else innerResolve({ changes: this.changes || 0, lastID: this.lastID || 0 });
              });
            });
          },
          exec(sql) {
            return new Promise((innerResolve, innerReject) => {
              db.exec(sql, (execError) => {
                if (execError) innerReject(execError);
                else innerResolve();
              });
            });
          },
          close() {
            return new Promise((innerResolve, innerReject) => {
              db.close((closeError) => {
                if (closeError) innerReject(closeError);
                else innerResolve();
              });
            });
          }
        });
      }
    });
  });
}

async function ensureSqliteBackfillAuditSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS data_quality_backfill_runs (
      run_id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      started_at_epoch INTEGER NOT NULL,
      completed_at_epoch INTEGER,
      operator TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      db_backend TEXT NOT NULL,
      source_filter TEXT NOT NULL DEFAULT '',
      limit_count INTEGER NOT NULL DEFAULT 0,
      max_updates INTEGER NOT NULL DEFAULT 0,
      batch_size INTEGER NOT NULL DEFAULT 0,
      checkpoint_url TEXT NOT NULL DEFAULT '',
      dry_run_summary TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      rollback_of_run_id TEXT NOT NULL DEFAULT '',
      rollback_metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS data_quality_backfill_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      changed_at_epoch INTEGER NOT NULL,
      row_identifier TEXT NOT NULL DEFAULT '',
      source_ats TEXT NOT NULL DEFAULT '',
      canonical_url TEXT NOT NULL DEFAULT '',
      parser_version TEXT NOT NULL DEFAULT '',
      field_name TEXT NOT NULL,
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      rule_name TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      source_evidence_summary TEXT NOT NULL DEFAULT '',
      reversible_metadata TEXT NOT NULL DEFAULT '{}',
      applied INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(run_id) REFERENCES data_quality_backfill_runs(run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_data_quality_backfill_changes_run
      ON data_quality_backfill_changes(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_data_quality_backfill_changes_url
      ON data_quality_backfill_changes(canonical_url, field_name);
  `);
}

async function ensurePostgresBackfillAuditSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS data_quality_backfill_runs (
      run_id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      started_at_epoch BIGINT NOT NULL,
      completed_at_epoch BIGINT,
      operator TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      db_backend TEXT NOT NULL,
      source_filter TEXT NOT NULL DEFAULT '',
      limit_count INTEGER NOT NULL DEFAULT 0,
      max_updates INTEGER NOT NULL DEFAULT 0,
      batch_size INTEGER NOT NULL DEFAULT 0,
      checkpoint_url TEXT NOT NULL DEFAULT '',
      dry_run_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT NOT NULL DEFAULT '',
      rollback_of_run_id TEXT NOT NULL DEFAULT '',
      rollback_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS data_quality_backfill_changes (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES data_quality_backfill_runs(run_id),
      changed_at_epoch BIGINT NOT NULL,
      row_identifier TEXT NOT NULL DEFAULT '',
      source_ats TEXT NOT NULL DEFAULT '',
      canonical_url TEXT NOT NULL DEFAULT '',
      parser_version TEXT NOT NULL DEFAULT '',
      field_name TEXT NOT NULL,
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      rule_name TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      source_evidence_summary TEXT NOT NULL DEFAULT '',
      reversible_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      applied BOOLEAN NOT NULL DEFAULT true
    );

    CREATE INDEX IF NOT EXISTS idx_data_quality_backfill_changes_run
      ON data_quality_backfill_changes(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_data_quality_backfill_changes_url
      ON data_quality_backfill_changes(canonical_url, field_name);
  `);
}

async function insertSqliteRun(db, run, summary) {
  await db.run(
    `
      INSERT INTO data_quality_backfill_runs (
        run_id, schema_version, started_at_epoch, operator, mode, status, db_backend,
        source_filter, limit_count, max_updates, batch_size, dry_run_summary,
        rollback_of_run_id, rollback_metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        status = excluded.status,
        checkpoint_url = data_quality_backfill_runs.checkpoint_url
    `,
    [
      run.runId,
      GEO_REMOTE_BACKFILL_AUDIT_SCHEMA_VERSION,
      run.startedAtEpoch,
      run.operator,
      run.mode,
      run.status,
      run.dbBackend,
      run.sourceFilter,
      run.limit,
      run.maxUpdates,
      run.batchSize,
      JSON.stringify(summary || {}),
      run.rollbackOfRunId || "",
      JSON.stringify(run.rollbackMetadata || {})
    ]
  );
}

async function insertPostgresRun(pool, run, summary) {
  await pool.query(
    `
      INSERT INTO data_quality_backfill_runs (
        run_id, schema_version, started_at_epoch, operator, mode, status, db_backend,
        source_filter, limit_count, max_updates, batch_size, dry_run_summary,
        rollback_of_run_id, rollback_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb)
      ON CONFLICT(run_id) DO UPDATE SET
        status = excluded.status,
        max_updates = excluded.max_updates,
        batch_size = excluded.batch_size
    `,
    [
      run.runId,
      GEO_REMOTE_BACKFILL_AUDIT_SCHEMA_VERSION,
      run.startedAtEpoch,
      run.operator,
      run.mode,
      run.status,
      run.dbBackend,
      run.sourceFilter,
      run.limit,
      run.maxUpdates,
      run.batchSize,
      JSON.stringify(summary || {}),
      run.rollbackOfRunId || "",
      JSON.stringify(run.rollbackMetadata || {})
    ]
  );
}

async function updateSqliteRun(db, runId, fields = {}) {
  await db.run(
    `
      UPDATE data_quality_backfill_runs
      SET status = coalesce(?, status),
          completed_at_epoch = coalesce(?, completed_at_epoch),
          checkpoint_url = coalesce(?, checkpoint_url),
          error = coalesce(?, error),
          rollback_metadata = coalesce(?, rollback_metadata)
      WHERE run_id = ?
    `,
    [
      fields.status ?? null,
      fields.completedAtEpoch ?? null,
      fields.checkpointUrl ?? null,
      fields.error ?? null,
      fields.rollbackMetadata ? JSON.stringify(fields.rollbackMetadata) : null,
      runId
    ]
  );
}

async function updatePostgresRun(pool, runId, fields = {}) {
  await pool.query(
    `
      UPDATE data_quality_backfill_runs
      SET status = coalesce($1, status),
          completed_at_epoch = coalesce($2, completed_at_epoch),
          checkpoint_url = coalesce($3, checkpoint_url),
          error = coalesce($4, error),
          rollback_metadata = coalesce($5::jsonb, rollback_metadata)
      WHERE run_id = $6
    `,
    [
      fields.status ?? null,
      fields.completedAtEpoch ?? null,
      fields.checkpointUrl ?? null,
      fields.error ?? null,
      fields.rollbackMetadata ? JSON.stringify(fields.rollbackMetadata) : null,
      runId
    ]
  );
}

async function getSqliteAppliedChangeKeys(db, runId) {
  if (!runId) return new Set();
  const rows = await db.all(
    "SELECT canonical_url, field_name FROM data_quality_backfill_changes WHERE run_id = ? AND applied = 1;",
    [runId]
  );
  return new Set(rows.map((row) => `${row.canonical_url}\u0000${row.field_name}`));
}

async function getPostgresAppliedChangeKeys(pool, runId) {
  if (!runId) return new Set();
  const result = await pool.query(
    "SELECT canonical_url, field_name FROM data_quality_backfill_changes WHERE run_id = $1 AND applied = true;",
    [runId]
  );
  return new Set((result.rows || []).map((row) => `${row.canonical_url}\u0000${row.field_name}`));
}

function sourceEvidenceSummary(plan, change) {
  const evidence = plan.evidence || {};
  if (["location_text", "country", "region", "city"].includes(change.field)) {
    return [evidence.geo_rule, evidence.geo_source].filter(Boolean).join(": ").slice(0, 500);
  }
  if (change.field === "remote_type") {
    return [evidence.remote_rule, evidence.remote_source].filter(Boolean).join(": ").slice(0, 500);
  }
  return [evidence.geo_rule, evidence.remote_rule].filter(Boolean).join("; ").slice(0, 500);
}

async function insertSqliteChange(db, runId, plan, change) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  await db.run(
    `
      INSERT INTO data_quality_backfill_changes (
        run_id, changed_at_epoch, row_identifier, source_ats, canonical_url, parser_version,
        field_name, old_value, new_value, rule_name, confidence, source_evidence_summary,
        reversible_metadata, applied
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `,
    [
      runId,
      nowEpoch,
      plan.row_identifier,
      plan.source_ats,
      plan.canonical_url,
      plan.parser_version,
      change.field,
      serializeAuditValue(change.before),
      serializeAuditValue(change.after),
      change.rule,
      Number(change.confidence || 0),
      sourceEvidenceSummary(plan, change),
      JSON.stringify({ before: change.before, after: change.after, classifications: plan.classifications })
    ]
  );
}

async function insertPostgresChange(pool, runId, plan, change) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  await pool.query(
    `
      INSERT INTO data_quality_backfill_changes (
        run_id, changed_at_epoch, row_identifier, source_ats, canonical_url, parser_version,
        field_name, old_value, new_value, rule_name, confidence, source_evidence_summary,
        reversible_metadata, applied
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, true)
    `,
    [
      runId,
      nowEpoch,
      plan.row_identifier,
      plan.source_ats,
      plan.canonical_url,
      plan.parser_version,
      change.field,
      serializeAuditValue(change.before),
      serializeAuditValue(change.after),
      change.rule,
      Number(change.confidence || 0),
      sourceEvidenceSummary(plan, change),
      JSON.stringify({ before: change.before, after: change.after, classifications: plan.classifications })
    ]
  );
}

function sqliteStoredValue(field, value) {
  if (field === "quality_flags") return JSON.stringify(parseQualityFlags(value));
  if (field === "quality_score") return parseStoredQualityScore(value);
  return clean(value);
}

async function applySqliteFieldChange(db, canonicalUrl, field, value) {
  if (!WRITABLE_FIELDS.includes(field)) throw new Error(`unsupported backfill field ${field}`);
  const storedValue = sqliteStoredValue(field, value);
  await db.run(`UPDATE Postings SET ${field} = ? WHERE job_posting_url = ?;`, [storedValue, canonicalUrl]);
}

async function applyPostgresFieldChange(pool, canonicalUrl, field, value) {
  if (!WRITABLE_FIELDS.includes(field)) throw new Error(`unsupported backfill field ${field}`);
  if (field === "quality_flags") {
    await pool.query("UPDATE postings SET quality_flags = $1::jsonb, updated_at = now() WHERE canonical_url = $2;", [JSON.stringify(parseQualityFlags(value)), canonicalUrl]);
    await pool.query("UPDATE posting_cache SET quality_flags = $1::jsonb, updated_at = now() WHERE canonical_url = $2;", [JSON.stringify(parseQualityFlags(value)), canonicalUrl]);
    return;
  }
  if (field === "quality_score") {
    await pool.query("UPDATE postings SET quality_score = $1, updated_at = now() WHERE canonical_url = $2;", [parseStoredQualityScore(value), canonicalUrl]);
    await pool.query("UPDATE posting_cache SET quality_score = $1, updated_at = now() WHERE canonical_url = $2;", [parseStoredQualityScore(value), canonicalUrl]);
    return;
  }
  await pool.query(`UPDATE postings SET ${field} = $1, updated_at = now() WHERE canonical_url = $2;`, [clean(value), canonicalUrl]);
  if (["location_text", "country", "region", "city", "remote_type"].includes(field)) {
    await pool.query(`UPDATE posting_cache SET ${field} = $1, updated_at = now() WHERE canonical_url = $2;`, [clean(value), canonicalUrl]);
  }
}

async function applySqlitePlans(db, plans, options, summary) {
  const runId = options.resumeRunId || createRunId();
  const startedAtEpoch = Math.floor(Date.now() / 1000);
  await ensureSqliteBackfillAuditSchema(db);
  await insertSqliteRun(
    db,
    {
      runId,
      startedAtEpoch,
      operator: options.operator,
      mode: options.resumeRunId ? "resume-apply" : "apply",
      status: "running",
      dbBackend: "sqlite",
      sourceFilter: options.source || "",
      limit: options.limit,
      maxUpdates: options.maxUpdates,
      batchSize: options.batchSize
    },
    summary
  );
  const appliedKeys = await getSqliteAppliedChangeKeys(db, runId);
  let appliedRows = 0;
  let appliedChanges = 0;
  const errors = [];
  const selected = plans.filter(canApplyPlan).slice(0, options.maxUpdates);
  for (let index = 0; index < selected.length; index += options.batchSize) {
    const batch = selected.slice(index, index + options.batchSize);
    try {
      await db.exec("BEGIN IMMEDIATE;");
      for (const plan of batch) {
        let rowChanged = false;
        for (const change of plan.changes) {
          const key = `${plan.canonical_url}\u0000${change.field}`;
          if (appliedKeys.has(key)) continue;
          await insertSqliteChange(db, runId, plan, change);
          await applySqliteFieldChange(db, plan.canonical_url, change.field, change.after);
          appliedKeys.add(key);
          appliedChanges += 1;
          rowChanged = true;
        }
        if (rowChanged) {
          appliedRows += 1;
          await updateSqliteRun(db, runId, { checkpointUrl: plan.canonical_url });

          // Re-evaluate validation status for SQLite
          const nextRows = await db.all("SELECT * FROM Postings WHERE job_posting_url = ?;", [plan.canonical_url]);
          const nextRow = nextRows[0] || null;
          if (nextRow) {
            const mappedRow = {
              ...nextRow,
              position_name: nextRow.position_name || nextRow.title,
              canonical_url: nextRow.job_posting_url || nextRow.canonical_url,
              hidden: Boolean(nextRow.hidden)
            };
            const { evaluatePublicPosting, validationFromGate } = require("../publicPostingGate");
            const gate = evaluatePublicPosting(mappedRow, { parserVersion: mappedRow.parser_version });
            const validation = validationFromGate(gate);
            
            try {
              await db.run(
                "UPDATE posting_cache SET validation_status = ?, validation_error = ?, updated_at = datetime('now') WHERE canonical_url = ?;",
                [validation.status, validation.error || "", plan.canonical_url]
              );
            } catch (e) {}

            const nextHidden = validation.status !== "valid" ? 1 : 0;
            await db.run(
              "UPDATE Postings SET hidden = ? WHERE job_posting_url = ?;",
              [nextHidden, plan.canonical_url]
            );
          }
        }
      }
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;").catch(() => {});
      errors.push(error?.message || String(error));
      if (!options.continueOnError) throw error;
    }
  }
  await updateSqliteRun(db, runId, {
    status: errors.length > 0 ? "completed_with_errors" : "completed",
    completedAtEpoch: Math.floor(Date.now() / 1000),
    error: errors.join("; ").slice(0, 1000)
  });
  return { run_id: runId, applied_rows: appliedRows, applied_changes: appliedChanges, errors };
}

async function applyPostgresPlans(pool, plans, options, summary) {
  const runId = options.resumeRunId || createRunId();
  const startedAtEpoch = Math.floor(Date.now() / 1000);
  await ensurePostgresBackfillAuditSchema(pool);
  await insertPostgresRun(
    pool,
    {
      runId,
      startedAtEpoch,
      operator: options.operator,
      mode: options.resumeRunId ? "resume-apply" : "apply",
      status: "running",
      dbBackend: "postgres",
      sourceFilter: options.source || "",
      limit: options.limit,
      maxUpdates: options.maxUpdates,
      batchSize: options.batchSize
    },
    summary
  );
  const appliedKeys = await getPostgresAppliedChangeKeys(pool, runId);
  let appliedRows = 0;
  let appliedChanges = 0;
  const errors = [];
  const selected = plans.filter(canApplyPlan).slice(0, options.maxUpdates);
  for (let index = 0; index < selected.length; index += options.batchSize) {
    const batch = selected.slice(index, index + options.batchSize);
    const client = await pool.connect();
    try {
      await client.query("BEGIN;");
      for (const plan of batch) {
        let rowChanged = false;
        for (const change of plan.changes) {
          const key = `${plan.canonical_url}\u0000${change.field}`;
          if (appliedKeys.has(key)) continue;
          await insertPostgresChange(client, runId, plan, change);
          await applyPostgresFieldChange(client, plan.canonical_url, change.field, change.after);
          appliedKeys.add(key);
          appliedChanges += 1;
          rowChanged = true;
        }
        if (rowChanged) {
          appliedRows += 1;
          await updatePostgresRun(client, runId, { checkpointUrl: plan.canonical_url });

          // Re-evaluate validation status for this row
          const nextRowResult = await client.query("SELECT * FROM postings WHERE canonical_url = $1;", [plan.canonical_url]);
          if (nextRowResult.rows.length > 0) {
            const nextRow = nextRowResult.rows[0];
            const { evaluatePublicPosting, validationFromGate } = require("../publicPostingGate");
            const gate = evaluatePublicPosting(nextRow, { parserVersion: nextRow.parser_version });
            const validation = validationFromGate(gate);
            
            await client.query(
              "UPDATE posting_cache SET validation_status = $1, validation_error = $2, updated_at = now() WHERE canonical_url = $3;",
              [validation.status, validation.error || "", plan.canonical_url]
            );

            const nextHidden = validation.status !== "valid";
            await client.query(
              "UPDATE postings SET hidden = $1, rejection_reason = $2, updated_at = now() WHERE canonical_url = $3;",
              [nextHidden, validation.error || "", plan.canonical_url]
            );
            
            // Insert search_index_outbox job
            if (validation.status === "valid") {
              const { toSearchPayload } = require("../detailRefetch/detailRefetchPlanner");
              await client.query(
                "INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at) VALUES ($1, 'upsert', $2::jsonb, now());",
                [plan.canonical_url, JSON.stringify(toSearchPayload(nextRow))]
              );
            } else {
              await client.query(
                "INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at) VALUES ($1, 'delete', $2::jsonb, now());",
                [
                  plan.canonical_url,
                  JSON.stringify({
                    reason: validation.status,
                    canonical_url: plan.canonical_url,
                    reason_codes: gate.reason_codes || []
                  })
                ]
              );
            }
          }
        }
      }
      await client.query("COMMIT;");
    } catch (error) {
      await client.query("ROLLBACK;").catch(() => {});
      errors.push(error?.message || String(error));
      if (!options.continueOnError) throw error;
    } finally {
      client.release();
    }
  }
  await updatePostgresRun(pool, runId, {
    status: errors.length > 0 ? "completed_with_errors" : "completed",
    completedAtEpoch: Math.floor(Date.now() / 1000),
    error: errors.join("; ").slice(0, 1000)
  });
  return { run_id: runId, applied_rows: appliedRows, applied_changes: appliedChanges, errors };
}

async function runBackfill(options = parseArgs(process.argv.slice(2)), env = process.env) {
  const dbBackend = clean(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").toLowerCase();
  let rows = [];
  let applyResult = null;
  const safetyGate = getSafetyGate(options);
  if (dbBackend === "postgres") {
    const pool = createPostgresPool({ enabled: true, connectionString: env.DATABASE_URL || env.POSTGRES_URL || "" });
    let heavyJobLock = null;
    try {
      heavyJobLock = await acquireHeavyJobLock(
        pool,
        safetyGate.authorized ? "geo-remote-backfill" : "geo-remote-backfill-dry-run"
      );
      rows = await queryPostgresRows(pool, options);
      const plans = rows.map(classifyBackfillCandidate);
      const summary = summarizePlan(rows, options);
      const reportBase = {
        ok: true,
        db_backend: dbBackend,
        dry_run: !safetyGate.authorized,
        apply_mode: safetyGate.authorized,
        safety_gate: safetyGate,
        source_filter: options.source || "",
        limit: options.limit,
        ...summary
      };
      if (safetyGate.authorized) {
        applyResult = await applyPostgresPlans(pool, plans, options, summary);
      }
      if (heavyJobLock) await heavyJobLock.release("succeeded");
      heavyJobLock = null;
      return { ...reportBase, ...(applyResult || {}) };
    } catch (error) {
      if (heavyJobLock) await heavyJobLock.release("failed");
      heavyJobLock = null;
      throw error;
    } finally {
      await pool.end();
    }
  }

  const dbPath = env.DB_PATH || path.resolve(__dirname, "..", "..", "..", "jobs.db");
  const db = safetyGate.authorized ? await openSqliteWritable(dbPath) : await openSqliteReadOnly(dbPath);
  try {
    rows = await querySqliteRows(db, options);
    const plans = rows.map(classifyBackfillCandidate);
    const summary = summarizePlan(rows, options);
    const reportBase = {
      ok: true,
      db_backend: dbBackend,
      dry_run: !safetyGate.authorized,
      apply_mode: safetyGate.authorized,
      safety_gate: safetyGate,
      source_filter: options.source || "",
      limit: options.limit,
      ...summary
    };
    if (safetyGate.authorized) {
      applyResult = await applySqlitePlans(db, plans, options, summary);
    }
    return { ...reportBase, ...(applyResult || {}) };
  } finally {
    await db.close();
  }
}

async function runDryRun(options = parseArgs(process.argv.slice(2)), env = process.env) {
  const dbBackend = clean(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").toLowerCase();
  let rows = [];
  if (dbBackend === "postgres") {
    const pool = createPostgresPool({ enabled: true, connectionString: env.DATABASE_URL || env.POSTGRES_URL || "" });
    let heavyJobLock = null;
    try {
      heavyJobLock = await acquireHeavyJobLock(pool, "geo-remote-backfill-dry-run");
      rows = await queryPostgresRows(pool, options);
      if (heavyJobLock) await heavyJobLock.release("succeeded");
      heavyJobLock = null;
    } catch (error) {
      if (heavyJobLock) await heavyJobLock.release("failed");
      heavyJobLock = null;
      throw error;
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

async function getSqliteRollbackChanges(db, runId) {
  return await db.all(
    `
      SELECT *
      FROM data_quality_backfill_changes
      WHERE run_id = ? AND applied = 1
      ORDER BY id DESC;
    `,
    [runId]
  );
}

async function getPostgresRollbackChanges(pool, runId) {
  const result = await pool.query(
    `
      SELECT *
      FROM data_quality_backfill_changes
      WHERE run_id = $1 AND applied = true
      ORDER BY id DESC;
    `,
    [runId]
  );
  return result.rows || [];
}

async function rollbackSqliteRun(db, options) {
  await ensureSqliteBackfillAuditSchema(db);
  const runId = options.rollbackRunId;
  if (!runId) throw new Error("rollback requires --run-id=<run_id>");
  const changes = await getSqliteRollbackChanges(db, runId);
  const rollbackRunId = createRunId("geo-remote-rollback");
  await insertSqliteRun(
    db,
    {
      runId: rollbackRunId,
      startedAtEpoch: Math.floor(Date.now() / 1000),
      operator: options.operator,
      mode: "rollback",
      status: "running",
      dbBackend: "sqlite",
      sourceFilter: "",
      limit: 0,
      maxUpdates: changes.length,
      batchSize: options.batchSize,
      rollbackOfRunId: runId,
      rollbackMetadata: { change_count: changes.length }
    },
    {}
  );
  let restoredChanges = 0;
  const errors = [];
  for (let index = 0; index < changes.length; index += options.batchSize) {
    const batch = changes.slice(index, index + options.batchSize);
    try {
      await db.exec("BEGIN IMMEDIATE;");
      for (const change of batch) {
        const restoredValue = parseAuditValue(change.old_value, change.field_name);
        await applySqliteFieldChange(db, change.canonical_url, change.field_name, restoredValue);
        restoredChanges += 1;
      }
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;").catch(() => {});
      errors.push(error?.message || String(error));
      if (!options.continueOnError) throw error;
    }
  }
  await updateSqliteRun(db, runId, {
    status: errors.length > 0 ? "rollback_completed_with_errors" : "rolled_back",
    rollbackMetadata: { rollback_run_id: rollbackRunId, restored_changes: restoredChanges, errors }
  });
  await updateSqliteRun(db, rollbackRunId, {
    status: errors.length > 0 ? "completed_with_errors" : "completed",
    completedAtEpoch: Math.floor(Date.now() / 1000),
    error: errors.join("; ").slice(0, 1000)
  });
  return { rollback_run_id: rollbackRunId, rolled_back_run_id: runId, restored_changes: restoredChanges, errors };
}

async function rollbackPostgresRun(pool, options) {
  await ensurePostgresBackfillAuditSchema(pool);
  const runId = options.rollbackRunId;
  if (!runId) throw new Error("rollback requires --run-id=<run_id>");
  const changes = await getPostgresRollbackChanges(pool, runId);
  const rollbackRunId = createRunId("geo-remote-rollback");
  await insertPostgresRun(
    pool,
    {
      runId: rollbackRunId,
      startedAtEpoch: Math.floor(Date.now() / 1000),
      operator: options.operator,
      mode: "rollback",
      status: "running",
      dbBackend: "postgres",
      sourceFilter: "",
      limit: 0,
      maxUpdates: changes.length,
      batchSize: options.batchSize,
      rollbackOfRunId: runId,
      rollbackMetadata: { change_count: changes.length }
    },
    {}
  );
  let restoredChanges = 0;
  const errors = [];
  for (let index = 0; index < changes.length; index += options.batchSize) {
    const batch = changes.slice(index, index + options.batchSize);
    const client = await pool.connect();
    try {
      await client.query("BEGIN;");
      for (const change of batch) {
        const restoredValue = parseAuditValue(change.old_value, change.field_name);
        await applyPostgresFieldChange(client, change.canonical_url, change.field_name, restoredValue);
        restoredChanges += 1;
      }
      await client.query("COMMIT;");
    } catch (error) {
      await client.query("ROLLBACK;").catch(() => {});
      errors.push(error?.message || String(error));
      if (!options.continueOnError) throw error;
    } finally {
      client.release();
    }
  }
  await updatePostgresRun(pool, runId, {
    status: errors.length > 0 ? "rollback_completed_with_errors" : "rolled_back",
    rollbackMetadata: { rollback_run_id: rollbackRunId, restored_changes: restoredChanges, errors }
  });
  await updatePostgresRun(pool, rollbackRunId, {
    status: errors.length > 0 ? "completed_with_errors" : "completed",
    completedAtEpoch: Math.floor(Date.now() / 1000),
    error: errors.join("; ").slice(0, 1000)
  });
  return { rollback_run_id: rollbackRunId, rolled_back_run_id: runId, restored_changes: restoredChanges, errors };
}

async function runRollback(options = parseArgs(process.argv.slice(2)), env = process.env) {
  const dbBackend = clean(env.OPENJOBSLOTS_DB_BACKEND || "sqlite").toLowerCase();
  if (dbBackend === "postgres") {
    const pool = createPostgresPool({ enabled: true, connectionString: env.DATABASE_URL || env.POSTGRES_URL || "" });
    try {
      const result = await rollbackPostgresRun(pool, options);
      return { ok: true, db_backend: dbBackend, ...result };
    } finally {
      await pool.end();
    }
  }
  const dbPath = env.DB_PATH || path.resolve(__dirname, "..", "..", "..", "jobs.db");
  const db = await openSqliteWritable(dbPath);
  try {
    const result = await rollbackSqliteRun(db, options);
    return { ok: true, db_backend: dbBackend, ...result };
  } finally {
    await db.close();
  }
}

module.exports = {
  canApplyPlan,
  classifyBackfillCandidate,
  getSafetyGate,
  isApplyAuthorized,
  parseArgs,
  parseDelimitedLocation,
  parseGeoEvidence,
  parseRemoteEvidence,
  runBackfill,
  runDryRun,
  runRollback,
  summarizePlan
};
