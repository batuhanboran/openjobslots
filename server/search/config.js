const MEILI_POSTINGS_INDEX = "postings";

const SEARCH_STOP_WORDS_LIST = Object.freeze([
  "job",
  "jobs",
  "posting",
  "postings",
  "opening",
  "openings",
  "career",
  "careers",
  "hiring",
  "role",
  "roles",
  "position",
  "positions",
  "vacancy",
  "vacancies",
  "empleo",
  "empleos",
  "oferta",
  "ofertas",
  "trabajo",
  "trabajos",
  "puesto",
  "puestos",
  "vacante",
  "vacantes",
  "emploi",
  "emplois",
  "offre",
  "offres",
  "poste",
  "postes",
  "ouvert",
  "ouverts",
  "stelle",
  "stellen",
  "stellenangebot",
  "stellenangebote",
  "is",
  "ilan",
  "ilani",
  "ilanlar",
  "ilanlari",
  "acik",
  "pozisyon",
  "pozisyonlar",
  "pozisyonlari",
  "calisma"
]);

const SEARCH_STOP_WORDS = new Set(SEARCH_STOP_WORDS_LIST);

const SEARCHABLE_ATTRIBUTES = Object.freeze([
  "title",
  "title_normalized",
  "company",
  "company_normalized",
  "location",
  "location_normalized",
  "city",
  "state",
  "country",
  "region",
  "remote_type",
  "ats_key",
  "industry",
  "department",
  "employment_type",
  "description_plain"
]);

const FILTERABLE_ATTRIBUTES = Object.freeze([
  "ats_key",
  "country",
  "region",
  "city",
  "state",
  "remote_type",
  "industry",
  "department",
  "employment_type",
  "company",
  "hidden",
  "last_seen_epoch",
  "posted_at_epoch",
  "posting_date"
]);

const SORTABLE_ATTRIBUTES = Object.freeze(["last_seen_epoch", "posted_at_epoch"]);
const RANKING_RULES = Object.freeze(["sort", "words", "typo", "proximity", "attribute", "exactness"]);

const SEARCH_SYNONYMS = Object.freeze({
  turkey: ["turkiye", "t\u00fcrkiye", "turkish", "turkyie", "turksih"],
  turkiye: ["turkey", "t\u00fcrkiye", "turkish", "turkyie", "turksih"],
  "t\u00fcrkiye": ["turkey", "turkiye", "turkish", "turkyie", "turksih"],
  turkish: ["turkey", "turkiye", "t\u00fcrkiye", "turkyie", "turksih"],
  turkyie: ["turkey", "turkiye", "t\u00fcrkiye", "turkish"],
  turksih: ["turkey", "turkiye", "t\u00fcrkiye", "turkish"],
  remote: ["wfh", "work from home", "work from anywhere", "remote work", "home based", "telecommute", "telework", "virtual", "remoto", "remotos", "remota", "remotas", "uzaktan", "uzaktan calisma"],
  wfh: ["remote", "work from home", "work from anywhere"],
  "work from home": ["remote", "wfh"],
  "work from anywhere": ["remote", "wfh"],
  hybrid: ["hybrid remote", "part remote", "partially remote"],
  "hybrid remote": ["hybrid"],
  "united states": ["us", "usa", "u.s.", "u.s.a.", "united states of america"],
  usa: ["united states", "us", "u.s.", "u.s.a."],
  us: ["united states", "usa", "u.s.", "u.s.a."],
  "united kingdom": ["uk", "u.k.", "great britain", "britain", "england"],
  uk: ["united kingdom", "u.k.", "great britain", "britain", "england"],
  germany: ["deutschland"],
  deutschland: ["germany"]
});

const SEARCH_TOKEN_CANONICAL = Object.freeze({
  turkyie: "turkey",
  turksih: "turkish",
  "remote jobs": "remote",
  "remote job openings": "remote",
  remoto: "remote",
  remotos: "remote",
  remota: "remote",
  remotas: "remote",
  "trabajos remotos": "remote",
  "empleos remotos": "remote",
  "ofertas empleo remote": "remote",
  "offres emploi remote": "remote",
  uzaktan: "remote",
  "uzaktan calisma": "remote",
  "uzaktan calisma ilanlari": "remote",
  "ofertas empleo": "job openings",
  "offres emploi": "job openings",
  stellenangebote: "job openings",
  "is ilanlari": "job openings",
  "yazilim muhendisi": "software engineer",
  "teknik destek muhendisi": "technical support engineer",
  "work from home": "remote",
  "work from anywhere": "remote",
  wfh: "remote",
  usa: "united states",
  us: "united states",
  "u.s.": "united states",
  "u.s.a.": "united states",
  uk: "united kingdom",
  "u.k.": "united kingdom"
});

const COUNTRY_FILTER_ALIAS_ENTRIES = Object.freeze([
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
  ["britain", "United Kingdom"],
  ["england", "United Kingdom"],
  ["turkiye", "Turkey"],
  ["t\u00fcrkiye", "Turkey"],
  ["turkey", "Turkey"],
  ["turkish", "Turkey"],
  ["turkyie", "Turkey"],
  ["turksih", "Turkey"],
  ["ca", "Canada"],
  ["can", "Canada"],
  ["canada", "Canada"],
  ["de", "Germany"],
  ["deutschland", "Germany"],
  ["germany", "Germany"],
  ["fr", "France"],
  ["france", "France"],
  ["india", "India"],
  ["singapore", "Singapore"],
  ["japan", "Japan"]
]);

const COUNTRY_FILTER_ALIASES = new Map(COUNTRY_FILTER_ALIAS_ENTRIES);

const REGION_FILTER_ALIAS_ENTRIES = Object.freeze([
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
  ["asia", "APAC"],
  ["asia pacific", "APAC"]
]);

const REGION_FILTER_ALIASES = new Map(REGION_FILTER_ALIAS_ENTRIES);

const COUNTRY_LOCATION_FALLBACK_TERMS_BY_LABEL = new Map([
  ["Turkey", ["turkey", "turkiye", "t\u00fcrkiye", "turkish", "istanbul", "ankara", "izmir", "bodrum", "antalya", "bursa", "gebze", "kocaeli"]],
  ["United States", ["united states", "united states of america", "usa", "u.s.", "u.s.a.", "new york", "california", "texas", "remote us"]],
  ["United Kingdom", ["united kingdom", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "london"]],
  ["Canada", ["canada", "toronto", "vancouver"]],
  ["Germany", ["germany", "deutschland", "berlin"]],
  ["France", ["france", "paris"]],
  ["India", ["india", "bangalore", "bengaluru", "mumbai", "delhi"]],
  ["Singapore", ["singapore"]],
  ["Japan", ["japan", "tokyo"]]
]);

const REMOTE_LOCATION_FALLBACK_TERMS_BY_TYPE = Object.freeze({
  remote: ["remote", "work from home", "work from anywhere", "remote work", "wfh", "anywhere", "home based", "telecommute", "telework", "virtual"],
  hybrid: ["hybrid", "hybrid remote", "part remote", "partially remote"],
  onsite: ["onsite", "on site", "on-site", "office based", "in office"]
});

const MEILI_POSTINGS_SETTINGS = Object.freeze({
  searchableAttributes: SEARCHABLE_ATTRIBUTES,
  filterableAttributes: FILTERABLE_ATTRIBUTES,
  sortableAttributes: SORTABLE_ATTRIBUTES,
  rankingRules: RANKING_RULES,
  synonyms: SEARCH_SYNONYMS,
  stopWords: SEARCH_STOP_WORDS_LIST,
  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 4,
      twoTypos: 8
    },
    disableOnWords: SEARCH_STOP_WORDS_LIST,
    disableOnAttributes: ["ats_key"]
  }
});

function normalizeLocaleLetters(value) {
  return String(value || "")
    .replace(/[İı]/g, "i")
    .replace(/[Şş]/g, "s")
    .replace(/[Ğğ]/g, "g")
    .replace(/[Çç]/g, "c")
    .replace(/[Öö]/g, "o")
    .replace(/[Üü]/g, "u");
}

function normalizeText(value) {
  return normalizeLocaleLetters(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLookup(value) {
  return normalizeLocaleLetters(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSearchToken(value) {
  return String(value || "")
    .trim()
    .replace(/^[`"'\u201c\u201d\u2018\u2019]+|[`"'\u201c\u201d\u2018\u2019]+$/gu, "")
    .replace(/[\u201c\u201d\u2018\u2019]/gu, "")
    .trim();
}

function normalizeFilterValue(value, aliases) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = normalizeLookup(raw).replace(/\s+/g, " ");
  return aliases.get(normalized) || raw;
}

function normalizeCountryFilterValue(value) {
  return normalizeFilterValue(value, COUNTRY_FILTER_ALIASES);
}

function normalizeRegionFilterValue(value) {
  return normalizeFilterValue(value, REGION_FILTER_ALIASES);
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

function uniqueNormalizedTerms(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const term = String(value || "").trim();
    const normalized = normalizeText(term);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(term);
  }
  return result;
}

function splitSearchTokens(search) {
  const tokens = String(search || "")
    .trim()
    .split(/\s+/)
    .map(cleanSearchToken)
    .filter(Boolean);
  return tokens;
}

function phraseAliasGroup(tokens, index) {
  for (let length = Math.min(4, tokens.length - index); length >= 2; length -= 1) {
    const phrase = tokens.slice(index, index + length).map(normalizeLookup).join(" ");
    const canonical = SEARCH_TOKEN_CANONICAL[phrase] || phrase;
    if (SEARCH_SYNONYMS[phrase] || SEARCH_SYNONYMS[canonical] || SEARCH_TOKEN_CANONICAL[phrase]) {
      return {
        length,
        values: uniqueNormalizedTerms([canonical, phrase, ...(SEARCH_SYNONYMS[phrase] || []), ...(SEARCH_SYNONYMS[canonical] || [])])
      };
    }
  }
  return null;
}

function expandSearchTokens(search) {
  const rawTokens = splitSearchTokens(search);
  const meaningfulTokens = rawTokens.filter((token) => !SEARCH_STOP_WORDS.has(normalizeText(token)));
  const tokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;
  const groups = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const phraseGroup = phraseAliasGroup(tokens, index);
    if (phraseGroup) {
      groups.push(phraseGroup.values);
      index += phraseGroup.length - 1;
      continue;
    }
    const normalized = normalizeLookup(tokens[index]);
    const normalizedPlain = normalizeText(tokens[index]);
    const canonical = SEARCH_TOKEN_CANONICAL[normalized] || SEARCH_TOKEN_CANONICAL[normalizedPlain] || normalizedPlain || normalized;
    groups.push(uniqueNormalizedTerms([
      canonical,
      tokens[index],
      normalized,
      normalizedPlain,
      ...(SEARCH_SYNONYMS[normalized] || []),
      ...(SEARCH_SYNONYMS[normalizedPlain] || []),
      ...(SEARCH_SYNONYMS[canonical] || [])
    ]));
  }

  return groups.filter((group) => group.length > 0);
}

function normalizeSearchQuery(value) {
  const groups = expandSearchTokens(value);
  if (groups.length === 0) return "";
  return groups.map((group) => String(group[0] || "").trim()).filter(Boolean).join(" ");
}

function getCountryFilterTerms(countryLabel) {
  const label = normalizeCountryFilterValue(countryLabel);
  const terms = [label];
  for (const [alias, targetLabel] of COUNTRY_FILTER_ALIASES.entries()) {
    if (targetLabel === label) terms.push(alias);
  }
  terms.push(...(COUNTRY_LOCATION_FALLBACK_TERMS_BY_LABEL.get(label) || []));
  return uniqueNormalizedTerms(terms).filter((term) => normalizeText(term).replace(/[^a-z0-9]+/g, "").length > 2);
}

function getRemoteLocationFallbackTerms(remoteType) {
  return uniqueNormalizedTerms(REMOTE_LOCATION_FALLBACK_TERMS_BY_TYPE[remoteType] || []);
}

module.exports = {
  COUNTRY_FILTER_ALIASES,
  FILTERABLE_ATTRIBUTES,
  MEILI_POSTINGS_INDEX,
  MEILI_POSTINGS_SETTINGS,
  REGION_FILTER_ALIASES,
  RANKING_RULES,
  SEARCHABLE_ATTRIBUTES,
  SEARCH_STOP_WORDS,
  SEARCH_STOP_WORDS_LIST,
  SEARCH_SYNONYMS,
  SORTABLE_ATTRIBUTES,
  cleanSearchToken,
  expandSearchTokens,
  getCountryFilterTerms,
  getRemoteLocationFallbackTerms,
  normalizeAtsKey,
  normalizeCountryFilterValue,
  normalizeFilterValue,
  normalizeLookup,
  normalizeRegionFilterValue,
  normalizeSearchQuery,
  normalizeText
};
