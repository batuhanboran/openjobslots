const assert = require("node:assert/strict");
const {
  buildCorpusCases,
  buildSeedPostings,
  CORPUS_CASE_TARGET
} = require("./search-corpus-fixtures");

const COUNTRY_ALIASES = new Map([
  ["us", "United States"],
  ["usa", "United States"],
  ["u.s.", "United States"],
  ["u.s.a.", "United States"],
  ["united states", "United States"],
  ["united states of america", "United States"],
  ["can", "Canada"],
  ["canada", "Canada"],
  ["turkey", "Turkey"],
  ["turkiye", "Turkey"],
  ["t\u00fcrkiye", "Turkey"],
  ["turkish", "Turkey"],
  ["uk", "United Kingdom"],
  ["u.k.", "United Kingdom"],
  ["great britain", "United Kingdom"],
  ["united kingdom", "United Kingdom"],
  ["de", "Germany"],
  ["deutschland", "Germany"],
  ["germany", "Germany"],
  ["france", "France"],
  ["india", "India"],
  ["singapore", "Singapore"],
  ["japan", "Japan"]
]);

const REGION_ALIASES = new Map([
  ["amer", "North America"],
  ["americas", "North America"],
  ["north america", "North America"],
  ["na", "North America"],
  ["emea", "EMEA"],
  ["europe", "EMEA"],
  ["europe middle east africa", "EMEA"],
  ["apac", "APAC"],
  ["asia pacific", "APAC"],
  ["asia", "APAC"]
]);

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
  us: ["united states", "usa", "u.s.", "u.s.a."],
  usa: ["united states", "us", "u.s.", "u.s.a."],
  "u.s.": ["united states", "us", "usa"],
  canada: ["can"],
  can: ["canada"],
  turkish: ["turkey", "turkiye", "t\u00fcrkiye", "istanbul"],
  turkiye: ["turkey", "t\u00fcrkiye", "turkish", "istanbul"],
  "t\u00fcrkiye": ["turkey", "turkiye", "turkish", "istanbul"],
  turkey: ["turkiye", "t\u00fcrkiye", "turkish", "istanbul"],
  turksih: ["turkey", "turkiye", "t\u00fcrkiye", "turkish"],
  uk: ["united kingdom", "u.k.", "great britain", "london"],
  "u.k.": ["united kingdom", "uk", "great britain", "london"],
  "great britain": ["united kingdom", "uk", "u.k.", "london"],
  deutschland: ["germany", "dusseldorf", "d\u00fcsseldorf"],
  germany: ["deutschland", "dusseldorf", "d\u00fcsseldorf"],
  dusseldorf: ["d\u00fcsseldorf", "germany", "deutschland"],
  "d\u00fcsseldorf": ["dusseldorf", "germany", "deutschland"],
  remote: ["work from home", "wfh", "anywhere"],
  wfh: ["remote", "work from home", "anywhere"],
  anywhere: ["remote", "work from home", "wfh"],
  hybrid: ["hybrid"],
  onsite: ["onsite", "on-site", "on site"],
  "on-site": ["onsite", "on site"],
  "north america": ["na", "amer", "americas"],
  na: ["north america", "amer", "americas"],
  amer: ["north america", "americas"],
  americas: ["north america", "amer"],
  emea: ["europe", "europe middle east africa"],
  europe: ["emea", "europe middle east africa"],
  "europe middle east africa": ["emea", "europe"],
  apac: ["asia pacific", "asia"],
  asia: ["apac", "asia pacific"],
  "asia pacific": ["apac", "asia"]
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLookup(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSearch(value) {
  return String(value || "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/["']/g, " ");
}

function phraseCandidates(search) {
  const candidates = [];
  const pattern = /["']([^"']+)["']/g;
  let match = pattern.exec(String(search || ""));
  while (match) {
    const phrase = String(match[1] || "").trim();
    if (phrase) candidates.push(phrase);
    match = pattern.exec(String(search || ""));
  }
  return candidates;
}

function splitSearchTokens(search) {
  const phraseTokens = phraseCandidates(search).flatMap((phrase) => phrase.split(/\s+/));
  const rawTokens = cleanSearch(search).split(/\s+/);
  return [...phraseTokens, ...rawTokens]
    .map((token) => token.trim())
    .filter(Boolean);
}

function expandSearchTokens(search) {
  const rawTokens = splitSearchTokens(search);
  const meaningfulTokens = rawTokens.filter((token) => !SEARCH_STOP_WORDS.has(normalizeText(token)));
  const tokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;
  const groups = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const normalized = normalizeLookup(token);
    const normalizedPlain = normalizeText(token);
    let consumedPhrase = false;
    for (let length = Math.min(4, tokens.length - index); length >= 2; length -= 1) {
      const lookupPhrase = tokens.slice(index, index + length).map(normalizeLookup).join(" ");
      const plainPhrase = tokens.slice(index, index + length).map(normalizeText).join(" ");
      const phrase = SEARCH_TOKEN_ALIASES[lookupPhrase] ? lookupPhrase : plainPhrase;
      if (SEARCH_TOKEN_ALIASES[phrase]) {
        groups.push(uniqueTerms([phrase, ...SEARCH_TOKEN_ALIASES[phrase]]));
        index += length - 1;
        consumedPhrase = true;
        break;
      }
    }
    if (consumedPhrase) {
      continue;
    }
    const aliases = SEARCH_TOKEN_ALIASES[normalized] || SEARCH_TOKEN_ALIASES[normalizedPlain] || [];
    groups.push(uniqueTerms([token, normalized, normalizedPlain, ...aliases]));
  }

  return groups;
}

function uniqueTerms(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function normalizeCountry(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return COUNTRY_ALIASES.get(normalizeLookup(raw)) || COUNTRY_ALIASES.get(normalizeText(raw)) || raw;
}

function normalizeRegion(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return REGION_ALIASES.get(normalizeLookup(raw)) || REGION_ALIASES.get(normalizeText(raw)) || raw;
}

function parseCsv(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function searchableText(posting) {
  return normalizeText([
    posting.company_name,
    posting.position_name,
    posting.location_text,
    posting.country,
    posting.region,
    posting.remote_type
  ].join(" "));
}

function termMatches(haystack, term) {
  const normalized = normalizeText(term);
  if (!normalized) return false;
  if (normalized.length <= 2) {
    return new Set(haystack.split(/\s+/).filter(Boolean)).has(normalized);
  }
  return haystack.includes(normalized);
}

function matchesSearch(posting, search) {
  const groups = expandSearchTokens(search);
  if (groups.length === 0) return true;
  const haystack = searchableText(posting);
  return groups.every((aliases) => aliases.some((alias) => termMatches(haystack, alias)));
}

function matchesStructuredFilters(posting, options) {
  const countryFilters = parseCsv(options.countries).map(normalizeCountry);
  const regionFilters = parseCsv(options.regions).map(normalizeRegion);
  const remote = String(options.remote || "all").trim().toLowerCase();

  if (countryFilters.length > 0 && !countryFilters.includes(posting.country)) return false;
  if (regionFilters.length > 0 && !regionFilters.includes(posting.region)) return false;
  if (remote === "remote" || remote === "hybrid" || remote === "onsite") return posting.remote_type === remote;
  if (remote === "non_remote") return posting.remote_type !== "remote" && posting.remote_type !== "hybrid";
  return true;
}

function runSearch(postings, options = {}) {
  const limit = Math.max(1, Math.min(2000, Number(options.limit || 500)));
  const offset = Math.max(0, Number(options.offset || 0));
  const includeApplied = Boolean(options.include_applied);
  const includeIgnored = Boolean(options.include_ignored);
  const hideNoDate = Boolean(options.hide_no_date);
  const matches = postings
    .filter((posting) => !posting.hidden)
    .filter((posting) => includeApplied || !posting.applied)
    .filter((posting) => includeIgnored || !posting.ignored)
    .filter((posting) => !hideNoDate || String(posting.posting_date || "").trim())
    .filter((posting) => matchesStructuredFilters(posting, options))
    .filter((posting) => matchesSearch(posting, options.search))
    .sort((a, b) => b.last_seen_epoch - a.last_seen_epoch || a.canonical_url.localeCompare(b.canonical_url));

  return {
    items: matches.slice(offset, offset + limit),
    count: matches.length,
    limit,
    offset,
    has_more: offset + limit < matches.length,
    next_offset: offset + limit < matches.length ? offset + limit : null
  };
}

function assertEvery(caseId, items, intent = {}) {
  for (const item of items) {
    if (intent.title) assert.equal(item.position_name, intent.title, `${caseId}: expected title intent`);
    if (intent.country) assert.equal(item.country, intent.country, `${caseId}: expected country intent`);
    if (intent.region) assert.equal(item.region, intent.region, `${caseId}: expected region intent`);
    if (intent.remote) assert.equal(item.remote_type, intent.remote, `${caseId}: expected remote intent`);
  }
}

function assertCase(postings, corpusCase) {
  const options = { ...(corpusCase.options || {}), search: corpusCase.search };
  const result = runSearch(postings, options);
  const expected = corpusCase.expect || {};
  const ids = result.items.map((item) => item.id);

  if (typeof expected.count === "number") {
    assert.equal(result.count, expected.count, `${corpusCase.id}: expected total count`);
  }
  if (typeof expected.pageLength === "number") {
    assert.equal(result.items.length, expected.pageLength, `${corpusCase.id}: expected page length`);
  }
  if (typeof expected.hasMore === "boolean") {
    assert.equal(result.has_more, expected.hasMore, `${corpusCase.id}: expected has_more`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, "nextOffset")) {
    assert.equal(result.next_offset, expected.nextOffset, `${corpusCase.id}: expected next_offset`);
  }
  if (expected.first) {
    assert.equal(ids[0], expected.first, `${corpusCase.id}: expected first result`);
  }
  for (const id of expected.includes || []) {
    assert.ok(ids.includes(id), `${corpusCase.id}: expected ${id} to be included`);
  }
  for (const id of expected.excludes || []) {
    assert.ok(!ids.includes(id), `${corpusCase.id}: expected ${id} to be excluded`);
  }
  assertEvery(corpusCase.id, result.items, expected.every);
}

function assertProgressiveLoading(postings, options = {}) {
  const pageSize = Number(options.limit || 25);
  let offset = 0;
  let expectedCount = null;
  let previousNextOffset = null;
  const loadedIds = [];
  const seenIds = new Set();

  for (let page = 0; page < 100; page += 1) {
    const result = runSearch(postings, { ...options, limit: pageSize, offset });
    if (expectedCount === null) expectedCount = result.count;
    assert.equal(result.count, expectedCount, "progressive loading: count changed between pages");
    assert.ok(result.items.length <= pageSize, "progressive loading: page exceeded requested limit");
    assert.equal(result.offset, offset, "progressive loading: offset echo mismatch");

    for (const item of result.items) {
      assert.ok(!seenIds.has(item.id), `progressive loading: duplicate item ${item.id}`);
      seenIds.add(item.id);
      loadedIds.push(item.id);
    }

    if (!result.has_more) {
      assert.equal(result.next_offset, null, "progressive loading: final page should not advertise next_offset");
      assert.equal(loadedIds.length, expectedCount, "progressive loading: loaded result count mismatch");
      return loadedIds;
    }

    assert.equal(result.next_offset, offset + pageSize, "progressive loading: next_offset should advance by limit");
    assert.notEqual(result.next_offset, previousNextOffset, "progressive loading: next_offset did not advance");
    previousNextOffset = result.next_offset;
    offset = result.next_offset;
  }

  assert.fail("progressive loading: pagination did not terminate");
}

function countByKind(cases) {
  const counts = new Map();
  for (const corpusCase of cases) counts.set(corpusCase.kind, (counts.get(corpusCase.kind) || 0) + 1);
  return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
}

function main() {
  const postings = buildSeedPostings();
  const cases = buildCorpusCases();
  assert.equal(postings.length, 435, "expected deterministic synthetic posting count");
  assert.equal(cases.length, CORPUS_CASE_TARGET, "expected deterministic 1000-query search corpus");

  for (const corpusCase of cases) assertCase(postings, corpusCase);

  assertProgressiveLoading(postings, { search: "Engineer", limit: 25 });
  assertProgressiveLoading(postings, {
    search: "Software Engineer United States",
    countries: ["US"],
    remote: "remote",
    limit: 1
  });

  const summary = countByKind(cases)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
  console.log(`search corpus passed: ${cases.length} cases, ${postings.length} synthetic postings (${summary})`);
}

if (require.main === module) {
  main();
}

module.exports = {
  expandSearchTokens,
  runSearch
};
