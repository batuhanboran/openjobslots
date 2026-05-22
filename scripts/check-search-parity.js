const { createPostgresPool, getPostgresConfig } = require("../server/backends/postgres");
const { listPostgresPostings } = require("../server/backends/postgresStore");
const {
  normalizeCountryFromLocation,
  normalizeRemoteTypeFromEvidence
} = require("../server/ingestion/posting");
const {
  getCountryFilterTerms,
  normalizeText
} = require("../server/search/config");
const { getMeiliConfig, searchMeiliPostings } = require("../server/search/meili");

const DEFAULT_CASES = Object.freeze([
  { name: "empty/default", search: "" },
  { name: "turkiye", search: "t\u00fcrkiye" },
  { name: "turkyie typo", search: "turkyie" },
  { name: "turkish jobs", search: "turkish jobs" },
  { name: "turksih jobs typo", search: "turksih jobs" },
  { name: "remote", search: "remote", remote: "remote" },
  { name: "software", search: "software" },
  { name: "engineer", search: "engineer" },
  { name: "sales", search: "sales" },
  { name: "istanbul", search: "istanbul", countries: ["Turkey"] },
  { name: "germany", search: "germany", countries: ["Germany"] },
  { name: "united states", search: "united states", countries: ["United States"] }
]);

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberOption(value, fallback, min, max) {
  const parsed = Number(value);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function parseParityArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    apiBaseUrl: String(env.OPENJOBSLOTS_PARITY_API_BASE_URL || "").trim(),
    limit: parseNumberOption(env.OPENJOBSLOTS_PARITY_LIMIT || 10, 10, 1, 100),
    offset: parseNumberOption(env.OPENJOBSLOTS_PARITY_OFFSET || 0, 0, 0, 10000),
    cases: DEFAULT_CASES.map((item) => ({ ...item })),
    failOnMismatch: String(env.OPENJOBSLOTS_PARITY_FAIL_ON_MISMATCH || "").trim() === "1"
  };

  for (const arg of argv) {
    if (arg === "--fail-on-mismatch") options.failOnMismatch = true;
    if (arg.startsWith("--api-base-url=")) {
      options.apiBaseUrl = String(arg.slice("--api-base-url=".length) || "").trim().replace(/\/+$/, "");
    }
    if (arg.startsWith("--limit=")) {
      options.limit = parseNumberOption(arg.slice("--limit=".length), options.limit, 1, 100);
    }
    if (arg.startsWith("--offset=")) {
      options.offset = parseNumberOption(arg.slice("--offset=".length), options.offset, 0, 10000);
    }
    if (arg.startsWith("--case=")) {
      options.cases = parseList(arg.slice("--case=".length)).map((search) => ({ name: search || "empty", search }));
    }
  }

  return options;
}

function canonicalUrlFromItem(item) {
  return String(item?.canonical_url || item?.job_posting_url || "").trim();
}

function titleFromItem(item) {
  return String(item?.title || item?.position_name || "").trim();
}

function companyFromItem(item) {
  return String(item?.company || item?.company_name || "").trim();
}

function countryFromItem(item) {
  const explicit = String(item?.country || "").trim();
  if (explicit) return explicit;
  return normalizeCountryFromLocation(item?.location || item?.location_text || "");
}

function containsNormalizedTerm(value, term) {
  const haystack = ` ${normalizeText(value).replace(/\s+/g, " ")} `;
  const needle = normalizeText(term).replace(/\s+/g, " ").trim();
  return Boolean(needle) && haystack.includes(` ${needle} `);
}

function itemHasCountryFilterEvidence(item, expectedCountry) {
  const explicit = String(item?.country || "").trim();
  if (explicit) return explicit === expectedCountry;
  const evidence = [
    item?.location,
    item?.location_text,
    item?.position_name,
    item?.title
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  return getCountryFilterTerms(expectedCountry).some((term) => containsNormalizedTerm(evidence, term));
}

function remoteTypeFromItem(item) {
  const explicit = String(item?.remote_type || "").trim();
  if (explicit && explicit !== "unknown") return explicit;
  const evidence = [
    item?.remote_type,
    item?.location,
    item?.location_text,
    item?.position_name,
    item?.title
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  return normalizeRemoteTypeFromEvidence(evidence, evidence);
}

function requiredFieldIssues(items, source) {
  const issues = [];
  for (const item of Array.isArray(items) ? items : []) {
    const canonicalUrl = canonicalUrlFromItem(item);
    if (!/^https?:\/\//i.test(canonicalUrl)) {
      issues.push({ source, canonical_url: canonicalUrl, field: "canonical_url" });
    }
    if (!titleFromItem(item)) issues.push({ source, canonical_url: canonicalUrl, field: "title" });
    if (!companyFromItem(item)) issues.push({ source, canonical_url: canonicalUrl, field: "company" });
  }
  return issues;
}

function isSortedByLastSeen(items) {
  let previous = Number.MAX_SAFE_INTEGER;
  for (const item of Array.isArray(items) ? items : []) {
    const current = Number(item?.last_seen_epoch || 0);
    if (current > previous) return false;
    previous = current;
  }
  return true;
}

function shouldAssertLastSeenOrder(sortBy) {
  const normalized = String(sortBy || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized === "last_seen" || normalized === "recent" || normalized === "fresh_source";
}

function checkFilterViolations(caseSpec, items, source) {
  const violations = [];
  const countries = new Set((caseSpec.countries || []).map((item) => String(item || "").trim()).filter(Boolean));
  for (const item of Array.isArray(items) ? items : []) {
    const canonicalUrl = canonicalUrlFromItem(item);
    if (countries.size > 0 && ![...countries].some((country) => itemHasCountryFilterEvidence(item, country))) {
      violations.push({
        source,
        canonical_url: canonicalUrl,
        field: "country",
        expected: [...countries],
        actual: countryFromItem(item)
      });
    }
    if (caseSpec.remote === "remote" && remoteTypeFromItem(item) !== "remote") {
      violations.push({
        source,
        canonical_url: canonicalUrl,
        field: "remote_type",
        expected: "remote",
        actual: remoteTypeFromItem(item)
      });
    }
    if (caseSpec.remote === "hybrid" && remoteTypeFromItem(item) !== "hybrid") {
      violations.push({
        source,
        canonical_url: canonicalUrl,
        field: "remote_type",
        expected: "hybrid",
        actual: remoteTypeFromItem(item)
      });
    }
  }
  return violations;
}

function topUrls(items, limit) {
  return (Array.isArray(items) ? items : []).slice(0, limit).map(canonicalUrlFromItem);
}

function compareTopUrls(left, right, sampleLimit = 10) {
  const max = Math.max(left.length, right.length);
  const mismatches = [];
  for (let index = 0; index < max; index += 1) {
    if (left[index] !== right[index]) {
      mismatches.push({ index, left: left[index] || null, right: right[index] || null });
    }
    if (mismatches.length >= sampleLimit) break;
  }
  return mismatches;
}

function buildPostingsUrl(apiBaseUrl, caseSpec, limit, offset) {
  const url = new URL(`${apiBaseUrl}/postings`);
  url.searchParams.set("search", String(caseSpec.search || ""));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (caseSpec.remote) url.searchParams.set("remote", caseSpec.remote);
  if (Array.isArray(caseSpec.countries) && caseSpec.countries.length > 0) {
    url.searchParams.set("countries", caseSpec.countries.join(","));
  }
  if (Array.isArray(caseSpec.regions) && caseSpec.regions.length > 0) {
    url.searchParams.set("regions", caseSpec.regions.join(","));
  }
  return url;
}

async function fetchApiCase(apiBaseUrl, caseSpec, limit, offset) {
  if (!apiBaseUrl) return null;
  const response = await fetch(buildPostingsUrl(apiBaseUrl, caseSpec, limit, offset));
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API parity request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function runWithSearchBackend(searchBackend, fn) {
  const previous = process.env.OPENJOBSLOTS_SEARCH_BACKEND;
  process.env.OPENJOBSLOTS_SEARCH_BACKEND = searchBackend;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.OPENJOBSLOTS_SEARCH_BACKEND;
    } else {
      process.env.OPENJOBSLOTS_SEARCH_BACKEND = previous;
    }
  }
}

async function runParityCase(pool, caseSpec, options) {
  const requestOptions = {
    search: caseSpec.search,
    limit: options.limit,
    offset: options.offset,
    remote: caseSpec.remote || "all",
    countries: caseSpec.countries || [],
    regions: caseSpec.regions || [],
    include_applied: false,
    include_ignored: false
  };

  const apiResult = await fetchApiCase(options.apiBaseUrl, caseSpec, options.limit, options.offset);
  const activeResult = await listPostgresPostings(pool, requestOptions);
  const postgresResult = await runWithSearchBackend("postgres", () => listPostgresPostings(pool, requestOptions));
  const meiliResult = await searchMeiliPostings({ ...requestOptions, limit: options.limit, offset: options.offset }, getMeiliConfig());

  const apiItems = Array.isArray(apiResult?.items) ? apiResult.items : null;
  const activeItems = activeResult.items || [];
  const postgresItems = postgresResult.items || [];
  const meiliItems = meiliResult.hits || [];
  const activeUrls = topUrls(activeItems, options.limit);
  const postgresUrls = topUrls(postgresItems, options.limit);
  const meiliUrls = topUrls(meiliItems, options.limit);
  const apiUrls = apiItems ? topUrls(apiItems, options.limit) : null;

  const requiredIssues = [
    ...requiredFieldIssues(activeItems, "active"),
    ...requiredFieldIssues(postgresItems, "postgres"),
    ...requiredFieldIssues(meiliItems, "meili"),
    ...(apiItems ? requiredFieldIssues(apiItems, "api") : [])
  ];
  const filterViolations = [
    ...checkFilterViolations(caseSpec, activeItems, "active"),
    ...checkFilterViolations(caseSpec, postgresItems, "postgres"),
    ...checkFilterViolations(caseSpec, meiliItems, "meili"),
    ...(apiItems ? checkFilterViolations(caseSpec, apiItems, "api") : [])
  ];
  const topUrlMismatches = {
    active_vs_postgres: compareTopUrls(activeUrls, postgresUrls),
    active_vs_meili: compareTopUrls(activeUrls, meiliUrls),
    api_vs_active: apiUrls ? compareTopUrls(apiUrls, activeUrls) : []
  };
  const countDelta = {
    active_minus_postgres: Number(activeResult.count || 0) - Number(postgresResult.count || 0),
    active_minus_meili: Number(activeResult.count || 0) - Number(meiliResult.estimatedTotalHits || 0),
    api_minus_active: apiResult ? Number(apiResult.count || 0) - Number(activeResult.count || 0) : 0
  };
  const sortBy = String(activeResult?.filters?.sort_by || requestOptions.sort_by || "relevance").trim().toLowerCase();
  const assertLastSeenOrder = shouldAssertLastSeenOrder(sortBy);
  const sorted = {
    sort_by: sortBy,
    assert_last_seen_desc: assertLastSeenOrder,
    active_last_seen_desc: assertLastSeenOrder ? isSortedByLastSeen(activeItems) : null,
    postgres_last_seen_desc: assertLastSeenOrder ? isSortedByLastSeen(postgresItems) : null,
    meili_last_seen_desc: assertLastSeenOrder ? isSortedByLastSeen(meiliItems) : null,
    api_last_seen_desc: assertLastSeenOrder && apiItems ? isSortedByLastSeen(apiItems) : null
  };
  const sortedOk =
    !assertLastSeenOrder ||
    (
      sorted.active_last_seen_desc &&
      sorted.postgres_last_seen_desc &&
      sorted.meili_last_seen_desc &&
      (sorted.api_last_seen_desc === null || sorted.api_last_seen_desc)
    );
  const ok =
    requiredIssues.length === 0 &&
    filterViolations.length === 0 &&
    topUrlMismatches.api_vs_active.length === 0 &&
    sortedOk;

  return {
    name: caseSpec.name,
    search: caseSpec.search,
    filters: {
      countries: caseSpec.countries || [],
      regions: caseSpec.regions || [],
      remote: caseSpec.remote || "all"
    },
    ok,
    counts: {
      api: apiResult ? Number(apiResult.count || 0) : null,
      active: Number(activeResult.count || 0),
      postgres: Number(postgresResult.count || 0),
      meili: Number(meiliResult.estimatedTotalHits || 0),
      count_delta: countDelta
    },
    top_urls: {
      api: apiUrls,
      active: activeUrls,
      postgres: postgresUrls,
      meili: meiliUrls
    },
    top_url_mismatches: topUrlMismatches,
    required_field_issues: requiredIssues.slice(0, 25),
    filter_violations: filterViolations.slice(0, 25),
    sorted
  };
}

async function runSearchParity(pool, options = parseParityArgs()) {
  const dbConfig = getPostgresConfig();
  const meiliConfig = getMeiliConfig();
  const cases = [];
  for (const caseSpec of options.cases) {
    cases.push(await runParityCase(pool, caseSpec, options));
  }
  const failingCases = cases.filter((item) => !item.ok);
  return {
    ok: failingCases.length === 0,
    db_backend: dbConfig.enabled ? "postgres" : "sqlite",
    search_backend: meiliConfig.enabled ? "meili" : "postgres",
    api_base_url: options.apiBaseUrl || null,
    checked_cases: cases.length,
    failing_cases: failingCases.map((item) => item.name),
    cases
  };
}

async function main() {
  const options = parseParityArgs();
  const pool = createPostgresPool();
  try {
    const result = await runSearchParity(pool, options);
    console.log(JSON.stringify(result));
    if (options.failOnMismatch && !result.ok) process.exitCode = 1;
  } finally {
    if (pool && typeof pool.end === "function") await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CASES,
  buildPostingsUrl,
  checkFilterViolations,
  compareTopUrls,
  isSortedByLastSeen,
  parseParityArgs,
  requiredFieldIssues,
  runSearchParity,
  shouldAssertLastSeenOrder
};
