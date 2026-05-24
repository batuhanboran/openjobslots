const { expandSearchTokens } = require("./config");

const STATE_CODE_TO_NAME = {
  AL: "alabama",
  AK: "alaska",
  AZ: "arizona",
  AR: "arkansas",
  CA: "california",
  CO: "colorado",
  CT: "connecticut",
  DE: "delaware",
  FL: "florida",
  GA: "georgia",
  HI: "hawaii",
  ID: "idaho",
  IL: "illinois",
  IN: "indiana",
  IA: "iowa",
  KS: "kansas",
  KY: "kentucky",
  LA: "louisiana",
  ME: "maine",
  MD: "maryland",
  MA: "massachusetts",
  MI: "michigan",
  MN: "minnesota",
  MS: "mississippi",
  MO: "missouri",
  MT: "montana",
  NE: "nebraska",
  NV: "nevada",
  NH: "new hampshire",
  NJ: "new jersey",
  NM: "new mexico",
  NY: "new york",
  NC: "north carolina",
  ND: "north dakota",
  OH: "ohio",
  OK: "oklahoma",
  OR: "oregon",
  PA: "pennsylvania",
  RI: "rhode island",
  SC: "south carolina",
  SD: "south dakota",
  TN: "tennessee",
  TX: "texas",
  UT: "utah",
  VT: "vermont",
  VA: "virginia",
  WA: "washington",
  WV: "west virginia",
  WI: "wisconsin",
  WY: "wyoming",
  DC: "district of columbia"
};

const LOCATION_REGION_OPTIONS = Object.freeze([
  { value: "AMER", label: "AMER (Americas)" },
  { value: "EMEA", label: "EMEA (Europe, Middle East, Africa)" },
  { value: "APAC", label: "APAC (Asia-Pacific)" }
]);
const LOCATION_REGION_VALUES = new Set(LOCATION_REGION_OPTIONS.map((option) => option.value));
const LOCATION_NON_COUNTRY_TERMS = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on site",
  "worldwide",
  "global",
  "international",
  "amer",
  "americas",
  "north america",
  "south america",
  "latin america",
  "latam",
  "emea",
  "europe",
  "middle east",
  "africa",
  "apac",
  "asia",
  "asia pacific"
]);
const REGION_HINTS_BY_VALUE = Object.freeze({
  AMER: [
    "amer",
    "americas",
    "north america",
    "south america",
    "latin america",
    "latam",
    "caribbean"
  ],
  EMEA: ["emea", "europe", "middle east", "africa"],
  APAC: ["apac", "asia pacific", "asia", "oceania"]
});
const COUNTRY_DEFINITIONS = Object.freeze([
  {
    code: "US",
    label: "United States",
    region: "AMER",
    aliases: ["us", "usa", "u.s.", "u.s.a.", "united states of america"]
  },
  { code: "CA", label: "Canada", region: "AMER", aliases: ["can"] },
  { code: "MX", label: "Mexico", region: "AMER", aliases: ["mex"] },
  { code: "BR", label: "Brazil", region: "AMER", aliases: ["brasil"] },
  { code: "AR", label: "Argentina", region: "AMER", aliases: [] },
  { code: "CL", label: "Chile", region: "AMER", aliases: [] },
  { code: "CO", label: "Colombia", region: "AMER", aliases: [] },
  { code: "PE", label: "Peru", region: "AMER", aliases: [] },
  { code: "UY", label: "Uruguay", region: "AMER", aliases: [] },
  { code: "PY", label: "Paraguay", region: "AMER", aliases: [] },
  { code: "BO", label: "Bolivia", region: "AMER", aliases: [] },
  { code: "EC", label: "Ecuador", region: "AMER", aliases: [] },
  { code: "VE", label: "Venezuela", region: "AMER", aliases: [] },
  { code: "CR", label: "Costa Rica", region: "AMER", aliases: [] },
  { code: "PA", label: "Panama", region: "AMER", aliases: [] },
  { code: "GT", label: "Guatemala", region: "AMER", aliases: [] },
  { code: "SV", label: "El Salvador", region: "AMER", aliases: [] },
  { code: "HN", label: "Honduras", region: "AMER", aliases: [] },
  { code: "NI", label: "Nicaragua", region: "AMER", aliases: [] },
  { code: "DO", label: "Dominican Republic", region: "AMER", aliases: [] },
  { code: "PR", label: "Puerto Rico", region: "AMER", aliases: [] },
  { code: "JM", label: "Jamaica", region: "AMER", aliases: [] },
  { code: "TT", label: "Trinidad and Tobago", region: "AMER", aliases: ["trinidad"] },
  { code: "BS", label: "Bahamas", region: "AMER", aliases: [] },
  { code: "BB", label: "Barbados", region: "AMER", aliases: [] },
  { code: "GB", label: "United Kingdom", region: "EMEA", aliases: ["uk", "u.k.", "great britain", "britain", "england", "scotland", "wales", "northern ireland"] },
  { code: "IE", label: "Ireland", region: "EMEA", aliases: ["republic of ireland"] },
  { code: "FR", label: "France", region: "EMEA", aliases: [] },
  { code: "DE", label: "Germany", region: "EMEA", aliases: ["deutschland"] },
  { code: "ES", label: "Spain", region: "EMEA", aliases: [] },
  { code: "PT", label: "Portugal", region: "EMEA", aliases: [] },
  { code: "IT", label: "Italy", region: "EMEA", aliases: [] },
  { code: "NL", label: "Netherlands", region: "EMEA", aliases: ["holland"] },
  { code: "BE", label: "Belgium", region: "EMEA", aliases: [] },
  { code: "LU", label: "Luxembourg", region: "EMEA", aliases: [] },
  { code: "CH", label: "Switzerland", region: "EMEA", aliases: [] },
  { code: "AT", label: "Austria", region: "EMEA", aliases: [] },
  { code: "SE", label: "Sweden", region: "EMEA", aliases: [] },
  { code: "NO", label: "Norway", region: "EMEA", aliases: [] },
  { code: "DK", label: "Denmark", region: "EMEA", aliases: [] },
  { code: "FI", label: "Finland", region: "EMEA", aliases: [] },
  { code: "IS", label: "Iceland", region: "EMEA", aliases: [] },
  { code: "PL", label: "Poland", region: "EMEA", aliases: [] },
  { code: "CZ", label: "Czechia", region: "EMEA", aliases: ["czech republic"] },
  { code: "SK", label: "Slovakia", region: "EMEA", aliases: [] },
  { code: "HU", label: "Hungary", region: "EMEA", aliases: [] },
  { code: "RO", label: "Romania", region: "EMEA", aliases: [] },
  { code: "BG", label: "Bulgaria", region: "EMEA", aliases: [] },
  { code: "HR", label: "Croatia", region: "EMEA", aliases: [] },
  { code: "SI", label: "Slovenia", region: "EMEA", aliases: [] },
  { code: "RS", label: "Serbia", region: "EMEA", aliases: [] },
  { code: "BA", label: "Bosnia and Herzegovina", region: "EMEA", aliases: ["bosnia"] },
  { code: "ME", label: "Montenegro", region: "EMEA", aliases: [] },
  { code: "AL", label: "Albania", region: "EMEA", aliases: [] },
  { code: "MK", label: "North Macedonia", region: "EMEA", aliases: ["macedonia"] },
  { code: "GR", label: "Greece", region: "EMEA", aliases: [] },
  { code: "CY", label: "Cyprus", region: "EMEA", aliases: [] },
  { code: "MT", label: "Malta", region: "EMEA", aliases: [] },
  { code: "EE", label: "Estonia", region: "EMEA", aliases: [] },
  { code: "LV", label: "Latvia", region: "EMEA", aliases: [] },
  { code: "LT", label: "Lithuania", region: "EMEA", aliases: [] },
  { code: "UA", label: "Ukraine", region: "EMEA", aliases: [] },
  { code: "BY", label: "Belarus", region: "EMEA", aliases: [] },
  { code: "MD", label: "Moldova", region: "EMEA", aliases: [] },
  { code: "RU", label: "Russia", region: "EMEA", aliases: ["russian federation"] },
  { code: "TR", label: "Turkey", region: "EMEA", aliases: ["turkiye", "turkish", "turkyie", "turksih"] },
  { code: "AE", label: "United Arab Emirates", region: "EMEA", aliases: ["uae", "u.a.e."] },
  { code: "SA", label: "Saudi Arabia", region: "EMEA", aliases: ["ksa"] },
  { code: "QA", label: "Qatar", region: "EMEA", aliases: [] },
  { code: "KW", label: "Kuwait", region: "EMEA", aliases: [] },
  { code: "BH", label: "Bahrain", region: "EMEA", aliases: [] },
  { code: "OM", label: "Oman", region: "EMEA", aliases: [] },
  { code: "IL", label: "Israel", region: "EMEA", aliases: [] },
  { code: "JO", label: "Jordan", region: "EMEA", aliases: [] },
  { code: "LB", label: "Lebanon", region: "EMEA", aliases: [] },
  { code: "EG", label: "Egypt", region: "EMEA", aliases: [] },
  { code: "MA", label: "Morocco", region: "EMEA", aliases: [] },
  { code: "DZ", label: "Algeria", region: "EMEA", aliases: [] },
  { code: "TN", label: "Tunisia", region: "EMEA", aliases: [] },
  { code: "ZA", label: "South Africa", region: "EMEA", aliases: [] },
  { code: "NG", label: "Nigeria", region: "EMEA", aliases: [] },
  { code: "KE", label: "Kenya", region: "EMEA", aliases: [] },
  { code: "GH", label: "Ghana", region: "EMEA", aliases: [] },
  { code: "ET", label: "Ethiopia", region: "EMEA", aliases: [] },
  { code: "UG", label: "Uganda", region: "EMEA", aliases: [] },
  { code: "TZ", label: "Tanzania", region: "EMEA", aliases: [] },
  { code: "SN", label: "Senegal", region: "EMEA", aliases: [] },
  { code: "CI", label: "Cote d Ivoire", region: "EMEA", aliases: ["cote d'ivoire", "ivory coast"] },
  { code: "CM", label: "Cameroon", region: "EMEA", aliases: [] },
  { code: "IN", label: "India", region: "APAC", aliases: [] },
  { code: "CN", label: "China", region: "APAC", aliases: ["prc", "people s republic of china"] },
  { code: "JP", label: "Japan", region: "APAC", aliases: [] },
  { code: "KR", label: "South Korea", region: "APAC", aliases: ["korea", "republic of korea", "korea south"] },
  { code: "SG", label: "Singapore", region: "APAC", aliases: [] },
  { code: "MY", label: "Malaysia", region: "APAC", aliases: [] },
  { code: "TH", label: "Thailand", region: "APAC", aliases: [] },
  { code: "VN", label: "Vietnam", region: "APAC", aliases: ["viet nam"] },
  { code: "ID", label: "Indonesia", region: "APAC", aliases: [] },
  { code: "PH", label: "Philippines", region: "APAC", aliases: [] },
  { code: "AU", label: "Australia", region: "APAC", aliases: [] },
  { code: "NZ", label: "New Zealand", region: "APAC", aliases: [] },
  { code: "HK", label: "Hong Kong", region: "APAC", aliases: ["hong kong sar"] },
  { code: "TW", label: "Taiwan", region: "APAC", aliases: [] },
  { code: "PK", label: "Pakistan", region: "APAC", aliases: [] },
  { code: "BD", label: "Bangladesh", region: "APAC", aliases: [] },
  { code: "LK", label: "Sri Lanka", region: "APAC", aliases: [] },
  { code: "NP", label: "Nepal", region: "APAC", aliases: [] },
  { code: "MM", label: "Myanmar", region: "APAC", aliases: ["burma"] },
  { code: "KH", label: "Cambodia", region: "APAC", aliases: [] },
  { code: "LA", label: "Laos", region: "APAC", aliases: ["lao pdr"] },
  { code: "BN", label: "Brunei", region: "APAC", aliases: ["brunei darussalam"] },
  { code: "MN", label: "Mongolia", region: "APAC", aliases: [] }
]);

const LOCATION_GEO_INFERENCE_CACHE_LIMIT = 30000;
const locationGeoInferenceCache = new Map();

function stripSearchDiacritics(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Ä±/g, "i")
    .replace(/Ä°/g, "I");
}

function normalizeSearchText(value) {
  return stripSearchDiacritics(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenizeSearchText(value) {
  return expandSearchTokens(value);
}

function normalizeLikeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeGeoText(value) {
  return stripSearchDiacritics(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['â€™]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const US_STATE_NAMES = new Set(Object.values(STATE_CODE_TO_NAME).map((name) => normalizeGeoText(name)));

function containsGeoPhrase(normalizedGeoTextValue, phrase) {
  const haystack = String(normalizedGeoTextValue || "").trim();
  const needle = normalizeGeoText(phrase);
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function toTitleCaseWords(value) {
  const source = normalizeGeoText(value);
  if (!source) return "";
  return source
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildCountryLookupMaps() {
  const byCode = new Map();
  const aliasToCode = new Map();
  const aliasesByCode = new Map();

  for (const item of COUNTRY_DEFINITIONS) {
    const code = String(item?.code || "")
      .trim()
      .toUpperCase();
    if (!code) continue;

    const label = String(item?.label || code).trim();
    const region = String(item?.region || "")
      .trim()
      .toUpperCase();
    const aliasValues = [label, ...(Array.isArray(item?.aliases) ? item.aliases : [])];
    const aliasSet = new Set();
    for (const aliasValue of aliasValues) {
      const normalizedAlias = normalizeGeoText(aliasValue);
      if (!normalizedAlias) continue;
      if (!aliasToCode.has(normalizedAlias)) {
        aliasToCode.set(normalizedAlias, code);
      }
      aliasSet.add(normalizedAlias);
    }

    byCode.set(code, { code, label, region });
    aliasesByCode.set(code, aliasSet);
  }

  return { byCode, aliasToCode, aliasesByCode };
}

const {
  byCode: COUNTRY_BY_CODE,
  aliasToCode: COUNTRY_ALIAS_TO_CODE,
  aliasesByCode: COUNTRY_ALIASES_BY_CODE
} = buildCountryLookupMaps();

function parseRegionFilters(values) {
  const normalized = normalizeStringArray(values)
    .map((value) => String(value || "").trim().toUpperCase())
    .filter((value) => LOCATION_REGION_VALUES.has(value));
  return Array.from(new Set(normalized));
}

function normalizeCountryLikePart(value) {
  return normalizeGeoText(value)
    .replace(/\b(country|republic|federation|state)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isLikelyCountryLikePart(value) {
  const candidate = normalizeCountryLikePart(value);
  if (!candidate) return false;
  if (candidate.length < 3 || candidate.length > 40) return false;
  if (candidate.split(" ").length > 4) return false;
  if (/\d/.test(candidate)) return false;
  if (LOCATION_NON_COUNTRY_TERMS.has(candidate)) return false;
  if (US_STATE_NAMES.has(candidate)) return false;
  if (/^[a-z]{2}$/.test(candidate)) return false;
  return true;
}

function splitLocationIntoCountryCandidateSegments(locationText) {
  return String(locationText || "")
    .split(/[,/|;]+|\s+-\s+/)
    .map((segment) => String(segment || "").trim())
    .filter(Boolean);
}

function collectCountryCandidates(locationText) {
  const segments = splitLocationIntoCountryCandidateSegments(locationText);
  if (segments.length === 0) return [];

  const candidates = [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const normalizedSegment = normalizeCountryLikePart(segments[index]);
    if (!normalizedSegment) continue;
    candidates.push(normalizedSegment);

    const words = normalizedSegment.split(" ").filter(Boolean);
    const maxWords = Math.min(words.length, 4);
    for (let size = maxWords; size >= 1; size -= 1) {
      const suffix = words.slice(words.length - size).join(" ");
      if (suffix) candidates.push(suffix);
    }
  }

  return Array.from(new Set(candidates));
}

function inferRegionFromNormalizedGeoText(normalizedGeoTextValue, countryCode = "") {
  for (const region of ["AMER", "EMEA", "APAC"]) {
    const hints = REGION_HINTS_BY_VALUE[region] || [];
    const hasHint = hints.some((hint) => containsGeoPhrase(normalizedGeoTextValue, hint));
    if (hasHint) return region;
  }

  const explicitCountryCode = String(countryCode || "").trim().toUpperCase();
  if (explicitCountryCode) {
    return String(COUNTRY_BY_CODE.get(explicitCountryCode)?.region || "").trim().toUpperCase();
  }

  return "";
}

function inferRegionFromLocationText(locationText, countryCode = "") {
  return inferRegionFromNormalizedGeoText(normalizeGeoText(locationText), countryCode);
}

function inferLocationGeoUncached(locationText) {
  const location = String(locationText || "").trim();
  const normalizedGeoLocation = normalizeGeoText(location);
  if (!location || !normalizedGeoLocation) {
    return {
      countryCode: "",
      countryValue: "",
      countryLabel: "",
      countryLikePart: "",
      region: ""
    };
  }

  const countryCandidates = collectCountryCandidates(location);
  for (const candidate of countryCandidates) {
    const countryCode = COUNTRY_ALIAS_TO_CODE.get(candidate);
    if (!countryCode) continue;
    const country = COUNTRY_BY_CODE.get(countryCode);
    const region =
      inferRegionFromNormalizedGeoText(normalizedGeoLocation, countryCode) ||
      String(country?.region || "").trim().toUpperCase();
    return {
      countryCode,
      countryValue: countryCode,
      countryLabel: String(country?.label || countryCode),
      countryLikePart: normalizeGeoText(country?.label || candidate),
      region
    };
  }

  const segments = splitLocationIntoCountryCandidateSegments(location);
  let fallbackCountryLikePart = "";
  if (segments.length >= 2) {
    for (let index = segments.length - 1; index >= 1; index -= 1) {
      const candidate = normalizeCountryLikePart(segments[index]);
      if (!isLikelyCountryLikePart(candidate)) continue;
      fallbackCountryLikePart = candidate;
      break;
    }
  }

  const region = inferRegionFromNormalizedGeoText(normalizedGeoLocation);
  return {
    countryCode: "",
    countryValue: fallbackCountryLikePart ? `RAW:${fallbackCountryLikePart}` : "",
    countryLabel: fallbackCountryLikePart ? toTitleCaseWords(fallbackCountryLikePart) : "",
    countryLikePart: fallbackCountryLikePart,
    region
  };
}

function inferLocationGeo(locationText) {
  const location = String(locationText || "").trim();
  if (!location) {
    return {
      countryCode: "",
      countryValue: "",
      countryLabel: "",
      countryLikePart: "",
      region: ""
    };
  }

  const cached = locationGeoInferenceCache.get(location);
  if (cached) return cached;

  const inferred = inferLocationGeoUncached(location);
  if (locationGeoInferenceCache.size >= LOCATION_GEO_INFERENCE_CACHE_LIMIT) {
    locationGeoInferenceCache.clear();
  }
  locationGeoInferenceCache.set(location, inferred);
  return inferred;
}

function parseCountryFilters(values) {
  const parsed = [];
  const seen = new Set();
  for (const rawValue of normalizeStringArray(values)) {
    const value = String(rawValue || "").trim();
    if (!value) continue;

    let nextFilter = null;
    if (/^raw:/i.test(value)) {
      const rawLikePart = normalizeCountryLikePart(value.slice(4));
      if (isLikelyCountryLikePart(rawLikePart)) {
        nextFilter = {
          type: "raw",
          rawLikePart,
          value: `RAW:${rawLikePart}`
        };
      }
    } else {
      const asCode = value.toUpperCase();
      if (COUNTRY_BY_CODE.has(asCode)) {
        nextFilter = {
          type: "code",
          code: asCode,
          value: asCode
        };
      } else {
        const aliasCountryCode = COUNTRY_ALIAS_TO_CODE.get(normalizeCountryLikePart(value));
        if (aliasCountryCode) {
          nextFilter = {
            type: "code",
            code: aliasCountryCode,
            value: aliasCountryCode
          };
        } else {
          const rawLikePart = normalizeCountryLikePart(value);
          if (isLikelyCountryLikePart(rawLikePart)) {
            nextFilter = {
              type: "raw",
              rawLikePart,
              value: `RAW:${rawLikePart}`
            };
          }
        }
      }
    }

    if (!nextFilter) continue;
    if (seen.has(nextFilter.value)) continue;
    seen.add(nextFilter.value);
    parsed.push(nextFilter);
  }
  return parsed;
}

function getCountryCodeForSearchToken(token) {
  const normalizedToken = normalizeCountryLikePart(token);
  if (!normalizedToken) return "";
  return COUNTRY_ALIAS_TO_CODE.get(normalizedToken) || "";
}

function classifyLocationWorkMode(locationText) {
  const normalized = normalizeLikeText(locationText);
  if (!normalized) return "non_remote";
  const hasHybrid = normalized.includes("hybrid");
  const hasRemote = normalized.includes("remote") || normalized.includes("work from home") || normalized.includes("wfh");
  if (hasHybrid) return "hybrid";
  if (hasRemote) return "remote";
  return "non_remote";
}

function searchTokenMatchesPosting(token, row) {
  const normalizedToken = normalizeSearchText(token);
  if (!normalizedToken) return true;

  const companyName = normalizeSearchText(row?.company_name);
  const positionName = normalizeSearchText(row?.position_name);
  const location = String(row?.location || "").trim();
  const normalizedLocation = normalizeSearchText(location);
  const ats = normalizeSearchText(row?.ats || row?.ATS_name);
  const remoteType = normalizeSearchText(classifyLocationWorkMode(location));

  if (
    companyName.includes(normalizedToken) ||
    positionName.includes(normalizedToken) ||
    normalizedLocation.includes(normalizedToken) ||
    ats.includes(normalizedToken) ||
    remoteType.includes(normalizedToken)
  ) {
    return true;
  }

  const countryCode = getCountryCodeForSearchToken(normalizedToken);
  if (!countryCode || !location) return false;

  const inferredGeo = inferLocationGeo(location);
  if (inferredGeo.countryCode && inferredGeo.countryCode === countryCode) {
    return true;
  }

  const aliases = COUNTRY_ALIASES_BY_CODE.get(countryCode);
  if (!(aliases instanceof Set)) return false;
  const normalizedGeoLocation = normalizeGeoText(location);
  return Array.from(aliases).some((alias) => containsGeoPhrase(normalizedGeoLocation, alias));
}

function buildPostingLocationGeoFilterOptions(locations) {
  const countriesByValue = new Map();
  const presentRegions = new Set();
  for (const location of locations || []) {
    const inferred = inferLocationGeo(location);
    if (inferred.countryValue && inferred.countryLabel) {
      const existing = countriesByValue.get(inferred.countryValue);
      if (!existing) {
        countriesByValue.set(inferred.countryValue, {
          value: inferred.countryValue,
          label: inferred.countryLabel,
          region: inferred.region || ""
        });
      } else if (!existing.region && inferred.region) {
        existing.region = inferred.region;
      }
    }
    if (inferred.region) presentRegions.add(inferred.region);
  }

  const countries = Array.from(countriesByValue.values()).sort((a, b) =>
    String(a?.label || "").localeCompare(String(b?.label || ""))
  );
  const regions = LOCATION_REGION_OPTIONS.filter(
    (option) => presentRegions.size === 0 || presentRegions.has(option.value)
  ).map((option) => ({ ...option }));

  return {
    countries,
    regions
  };
}

function normalizeCountyName(value) {
  return normalizeLikeText(value)
    .replace(/\b(county|parish|borough|census area|municipality)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCountyFilters(values) {
  const parsed = [];
  for (const rawValue of normalizeStringArray(values)) {
    const value = String(rawValue || "").trim();
    if (!value) continue;

    if (value.includes("|")) {
      const [stateRaw, countyRaw] = value.split("|");
      const stateCode = String(stateRaw || "").trim().toUpperCase();
      const countyLikePart = normalizeCountyName(countyRaw);
      if (!countyLikePart) continue;
      parsed.push({ stateCode, countyLikePart });
      continue;
    }

    const countyLikePart = normalizeCountyName(value);
    if (!countyLikePart) continue;
    parsed.push({ stateCode: "", countyLikePart });
  }
  return parsed;
}

function hasStateLikeMatch(locationText, stateCode) {
  const code = String(stateCode || "").trim().toUpperCase();
  if (!code) return false;

  const upperLocation = String(locationText || "").toUpperCase();
  const codeRegex = new RegExp(`(^|[^A-Z])${escapeRegExp(code)}([^A-Z]|$)`);
  if (codeRegex.test(upperLocation)) return true;

  const stateName = STATE_CODE_TO_NAME[code];
  if (!stateName) return false;
  return normalizeLikeText(locationText).includes(stateName);
}

function rowMatchesLocationFilters(
  locationText,
  selectedStateCodes,
  countyFilters,
  countryFilters = [],
  selectedRegions = []
) {
  const stateCodes = Array.isArray(selectedStateCodes) ? selectedStateCodes : [];
  const counties = Array.isArray(countyFilters) ? countyFilters : [];
  const countries = Array.isArray(countryFilters) ? countryFilters : [];
  const regions = Array.isArray(selectedRegions) ? selectedRegions : [];
  if (stateCodes.length === 0 && counties.length === 0 && countries.length === 0 && regions.length === 0) return true;

  const location = String(locationText || "").trim();
  if (!location) return false;
  const normalizedLocation = normalizeLikeText(location);
  const normalizedGeoLocation = normalizeGeoText(location);
  const inferredGeo = inferLocationGeo(location);

  if (stateCodes.length > 0) {
    const hasSelectedState = stateCodes.some((stateCode) => hasStateLikeMatch(location, stateCode));
    if (!hasSelectedState) return false;
  }

  if (counties.length > 0) {
    const matchesCounty = counties.some((countyFilter) => {
      const countyLikePart = String(countyFilter?.countyLikePart || "").trim();
      if (!countyLikePart) return false;

      if (countyFilter.stateCode && !hasStateLikeMatch(location, countyFilter.stateCode)) {
        return false;
      }

      return (
        normalizedLocation.includes(countyLikePart) ||
        normalizedLocation.includes(`${countyLikePart} county`) ||
        normalizedLocation.includes(`${countyLikePart} parish`) ||
        normalizedLocation.includes(`${countyLikePart} borough`) ||
        normalizedLocation.includes(`${countyLikePart} census area`)
      );
    });

    if (!matchesCounty) return false;
  }

  if (countries.length > 0) {
    const matchesCountry = countries.some((countryFilter) => {
      if (countryFilter?.type === "code") {
        const selectedCountryCode = String(countryFilter?.code || "").trim().toUpperCase();
        if (!selectedCountryCode) return false;
        if (inferredGeo.countryCode && inferredGeo.countryCode === selectedCountryCode) {
          return true;
        }

        const aliases = COUNTRY_ALIASES_BY_CODE.get(selectedCountryCode);
        if (!(aliases instanceof Set)) return false;
        return Array.from(aliases).some((alias) => containsGeoPhrase(normalizedGeoLocation, alias));
      }

      const rawLikePart = String(countryFilter?.rawLikePart || "").trim();
      if (!rawLikePart) return false;
      return containsGeoPhrase(normalizedGeoLocation, rawLikePart);
    });

    if (!matchesCountry) return false;
  }

  if (regions.length > 0) {
    const region = inferredGeo.region || inferRegionFromNormalizedGeoText(normalizedGeoLocation, inferredGeo.countryCode);
    if (!region || !regions.includes(region)) return false;
  }

  return true;
}

module.exports = {
  LOCATION_REGION_OPTIONS,
  STATE_CODE_TO_NAME,
  buildPostingLocationGeoFilterOptions,
  classifyLocationWorkMode,
  collectCountryCandidates,
  inferLocationGeo,
  inferRegionFromLocationText,
  inferRegionFromNormalizedGeoText,
  normalizeGeoText,
  normalizeSearchText,
  parseCountryFilters,
  parseCountyFilters,
  parseRegionFilters,
  rowMatchesLocationFilters,
  searchTokenMatchesPosting,
  stripSearchDiacritics,
  tokenizeSearchText
};
