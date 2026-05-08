function normalizePostingValue(value) {
  return String(value || "").trim();
}

function canonicalizePostingUrl(value) {
  return normalizePostingValue(value).replace(/#.*$/, "");
}

function normalizeSearchText(value) {
  return normalizePostingValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const COUNTRY_ALIAS_GROUPS = Object.freeze([
  ["Turkey", ["tr", "tur", "turkiye", "türkiye", "turkey", "turkish"]],
  ["United States", ["us", "u.s.", "u.s", "usa", "united states", "unitedstates", "united states of america", "america"]],
  ["United Kingdom", ["uk", "gb", "gbr", "great britain", "united kingdom", "england", "scotland", "wales", "northern ireland"]],
  ["Canada", ["ca", "can", "canada"]],
  ["Germany", ["de", "deu", "germany", "deutschland"]],
  ["France", ["fr", "fra", "france"]],
  ["Netherlands", ["nl", "nld", "netherlands", "holland", "nederland", "niederlande"]],
  ["Spain", ["es", "esp", "spain", "españa", "espana"]],
  ["Italy", ["it", "ita", "italy", "italia"]],
  ["Ireland", ["ie", "irl", "ireland"]],
  ["India", ["in", "ind", "india"]],
  ["Australia", ["au", "aus", "australia"]],
  ["New Zealand", ["nz", "nzl", "new zealand"]],
  ["Singapore", ["sg", "sgp", "singapore"]],
  ["Japan", ["jp", "jpn", "japan"]],
  ["South Korea", ["kr", "kor", "south korea", "korea", "republic of korea"]],
  ["China", ["cn", "chn", "china"]],
  ["Hong Kong", ["hk", "hkg", "hong kong"]],
  ["Malaysia", ["my", "mys", "malaysia"]],
  ["Indonesia", ["id", "idn", "indonesia"]],
  ["Philippines", ["ph", "phl", "philippines"]],
  ["Thailand", ["th", "tha", "thailand"]],
  ["Vietnam", ["vn", "vnm", "vietnam", "viet nam"]],
  ["Brazil", ["br", "bra", "brazil", "brasil"]],
  ["Mexico", ["mx", "mex", "mexico", "méxico"]],
  ["Argentina", ["ar", "arg", "argentina"]],
  ["Chile", ["cl", "chl", "chile"]],
  ["Colombia", ["co", "col", "colombia"]],
  ["Peru", ["pe", "per", "peru"]],
  ["Portugal", ["pt", "prt", "portugal"]],
  ["Poland", ["pl", "pol", "poland", "polska"]],
  ["Romania", ["ro", "rou", "romania"]],
  ["Czech Republic", ["cz", "cze", "czech republic", "czechia"]],
  ["Slovakia", ["sk", "svk", "slovakia"]],
  ["Hungary", ["hu", "hun", "hungary"]],
  ["Austria", ["at", "aut", "austria", "osterreich"]],
  ["Switzerland", ["ch", "che", "switzerland", "schweiz", "suisse"]],
  ["Belgium", ["be", "bel", "belgium"]],
  ["Denmark", ["dk", "dnk", "denmark"]],
  ["Sweden", ["se", "swe", "sweden"]],
  ["Norway", ["no", "nor", "norway"]],
  ["Finland", ["fi", "fin", "finland"]],
  ["Estonia", ["ee", "est", "estonia"]],
  ["Latvia", ["lv", "lva", "latvia"]],
  ["Lithuania", ["lt", "ltu", "lithuania"]],
  ["Greece", ["gr", "grc", "greece"]],
  ["Bulgaria", ["bg", "bgr", "bulgaria"]],
  ["Croatia", ["hr", "hrv", "croatia"]],
  ["Serbia", ["rs", "srb", "serbia"]],
  ["Slovenia", ["si", "svn", "slovenia"]],
  ["Ukraine", ["ua", "ukr", "ukraine"]],
  ["Israel", ["il", "isr", "israel"]],
  ["United Arab Emirates", ["ae", "are", "uae", "united arab emirates", "dubai", "abu dhabi"]],
  ["Saudi Arabia", ["sa", "sau", "saudi arabia"]],
  ["South Africa", ["za", "zaf", "south africa"]],
  ["Egypt", ["eg", "egy", "egypt"]],
  ["Pakistan", ["pk", "pak", "pakistan"]],
  ["Iran", ["ir", "irn", "iran", "iran islamic republic of", "islamic republic of iran"]],
  ["Ecuador", ["ec", "ecu", "ecuador"]],
  ["Armenia", ["am", "arm", "armenia"]],
  ["Cyprus", ["cy", "cyp", "cyprus"]],
  ["Cayman Islands", ["ky", "cym", "cayman islands", "cayman"]],
  ["Taiwan", ["tw", "twn", "taiwan"]],
  ["Qatar", ["qa", "qat", "qatar"]],
  ["Kuwait", ["kw", "kwt", "kuwait"]],
  ["Bahrain", ["bh", "bhr", "bahrain"]],
  ["Oman", ["om", "omn", "oman"]]
]);

const COUNTRY_ALIASES = Object.freeze(COUNTRY_ALIAS_GROUPS.reduce((aliases, [country, values]) => {
  for (const value of values) {
    aliases[normalizeSearchText(value)] = country;
  }
  return aliases;
}, {}));

const COUNTRY_LOCATION_TERMS = Object.freeze([
  ["Turkey", ["istanbul", "ankara", "izmir", "antalya", "bursa", "gebze", "kocaeli", "konya", "adana", "kayseri", "mugla", "bodrum"]],
  ["United States", [
    "new york", "los angeles", "san francisco", "seattle", "chicago", "boston", "austin", "dallas", "houston",
    "washington dc", "washington, dc", "district of columbia",
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
    "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
    "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska",
    "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
    "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming"
  ]],
  ["United Kingdom", ["london", "manchester", "birmingham", "edinburgh", "glasgow", "bristol", "leeds", "cambridge"]],
  ["Canada", [
    "toronto", "vancouver", "montreal", "ottawa", "calgary", "edmonton", "waterloo", "quebec",
    "alberta", "british columbia", "manitoba", "new brunswick", "newfoundland and labrador", "nova scotia",
    "ontario", "prince edward island", "saskatchewan", "northwest territories", "nunavut", "yukon"
  ]],
  ["Germany", ["berlin", "munich", "münchen", "hamburg", "frankfurt", "cologne", "stuttgart"]],
  ["France", ["paris", "lyon", "marseille", "toulouse", "lille"]],
  ["Netherlands", ["amsterdam", "rotterdam", "utrecht", "eindhoven"]],
  ["Spain", ["madrid", "barcelona", "valencia", "malaga"]],
  ["Italy", ["rome", "roma", "milan", "milano", "turin"]],
  ["Ireland", ["dublin", "cork", "galway"]],
  ["India", ["bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi", "gurgaon", "gurugram", "noida", "chennai"]],
  ["Australia", ["sydney", "melbourne", "brisbane", "perth", "adelaide"]],
  ["Singapore", ["singapore"]],
  ["Japan", ["tokyo", "osaka", "kyoto"]],
  ["Brazil", ["sao paulo", "são paulo", "rio de janeiro", "curitiba"]],
  ["Mexico", ["mexico city", "ciudad de mexico", "guadalajara", "monterrey"]],
  ["Poland", ["warsaw", "krakow", "kraków", "wroclaw", "wrocław"]],
  ["Portugal", ["lisbon", "lisboa", "porto"]],
  ["United Arab Emirates", ["dubai", "abu dhabi"]],
  ["South Korea", ["seoul", "ulsan", "busan", "incheon"]],
  ["Taiwan", ["taipei", "hsinchu", "hsin chu", "taichung", "kaohsiung", "taiwan"]],
  ["Armenia", ["yerevan"]],
  ["Cyprus", ["nicosia", "limassol"]],
  ["Cayman Islands", ["george town", "grand cayman"]],
  ["Ecuador", ["quito", "guayaquil"]],
  ["Iran", ["tehran"]]
]);

const US_STATE_ABBREVIATION_PATTERN =
  /(?:^|,\s*|\s-\s)(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?:\s|,|$)/i;
const CANADA_PROVINCE_ABBREVIATION_PATTERN =
  /(?:^|,\s*|\s-\s)(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)(?:\s|,|$)/i;

function normalizeCountryFromLocation(value) {
  const location = normalizePostingValue(value);
  const normalized = normalizeSearchText(location);
  if (!normalized) return "";
  if (US_STATE_ABBREVIATION_PATTERN.test(location)) return "United States";
  if (CANADA_PROVINCE_ABBREVIATION_PATTERN.test(location)) return "Canada";

  for (const [alias, country] of Object.entries(COUNTRY_ALIASES)) {
    if (alias.length <= 2) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(normalized)) return country;
  }

  for (const [country, terms] of COUNTRY_LOCATION_TERMS) {
    for (const term of terms) {
      const normalizedTerm = normalizeSearchText(term);
      const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(normalized)) return country;
    }
  }
  return "";
}

function normalizeCountryName(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return "";
  return COUNTRY_ALIASES[normalized] || COUNTRY_ALIASES[normalized.replace(/[^a-z0-9]+/g, "")] || "";
}

function normalizeRegionFromCountry(country) {
  const normalized = normalizeSearchText(country);
  if ([
    "turkey",
    "united kingdom",
    "germany",
    "france",
    "netherlands",
    "spain",
    "italy",
    "ireland",
    "portugal",
    "poland",
    "romania",
    "czech republic",
    "slovakia",
    "hungary",
    "austria",
    "switzerland",
    "belgium",
    "denmark",
    "sweden",
    "norway",
    "finland",
    "estonia",
    "latvia",
    "lithuania",
    "greece",
    "bulgaria",
    "croatia",
    "serbia",
    "slovenia",
    "ukraine",
    "israel",
    "iran",
    "armenia",
    "cyprus",
    "united arab emirates",
    "saudi arabia",
    "south africa",
    "egypt"
  ].includes(normalized)) {
    return "EMEA";
  }
  if (normalized === "united states" || normalized === "canada") {
    return "North America";
  }
  if ([
    "india",
    "australia",
    "new zealand",
    "singapore",
    "japan",
    "south korea",
    "china",
    "hong kong",
    "taiwan",
    "malaysia",
    "indonesia",
    "philippines",
    "thailand",
    "vietnam",
    "pakistan"
  ].includes(normalized)) {
    return "APAC";
  }
  if (["brazil", "mexico", "argentina", "chile", "colombia", "peru", "ecuador"].includes(normalized)) {
    return "LATAM";
  }
  if (normalized === "cayman islands") {
    return "North America";
  }
  return "";
}

function normalizeRemoteType(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return "unknown";
  if (normalized === "true") return "remote";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/\b(remote|fully remote|work from home|work from anywhere|wfh|anywhere|home based|home office|telecommute|telework|virtual|distributed)\b/.test(normalized)) return "remote";
  if (/\b(on[- ]?site|onsite|office based|in office|work from office)\b/.test(normalized)) return "onsite";
  return "unknown";
}

function normalizePostingDate(value) {
  const rawValue = normalizePostingValue(value);
  if (!rawValue) return { raw: null, epoch: null };
  const normalizedLower = rawValue.toLowerCase();
  const nowEpoch = Math.floor(Date.now() / 1000);
  if (normalizedLower === "posted today" || normalizedLower === "today") {
    return { raw: rawValue, epoch: nowEpoch };
  }
  if (normalizedLower === "posted yesterday" || normalizedLower === "yesterday") {
    return { raw: rawValue, epoch: nowEpoch - 24 * 60 * 60 };
  }
  const relativeHours = normalizedLower.match(/^posted\s+(\d+)\s+hour(?:s)?\s+ago$/) || normalizedLower.match(/^(\d+)\s+hour(?:s)?\s+ago$/);
  if (relativeHours?.[1]) {
    return { raw: rawValue, epoch: nowEpoch - Number(relativeHours[1]) * 60 * 60 };
  }
  const relativeDays = normalizedLower.match(/^posted\s+(\d+)\s+day(?:s)?\s+ago$/) || normalizedLower.match(/^(\d+)\s+day(?:s)?\s+ago$/);
  if (relativeDays?.[1]) {
    return { raw: rawValue, epoch: nowEpoch - Number(relativeDays[1]) * 24 * 60 * 60 };
  }
  if (/^\d{10}$/.test(rawValue)) {
    return { raw: rawValue, epoch: Number(rawValue) };
  }
  if (/^\d{13}$/.test(rawValue)) {
    return { raw: rawValue, epoch: Math.floor(Number(rawValue) / 1000) };
  }
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return { raw: rawValue, epoch: null };
  }
  return {
    raw: rawValue,
    epoch: Math.floor(parsed.getTime() / 1000)
  };
}

function stablePayloadHash(value) {
  const source = typeof value === "string" ? value : JSON.stringify(value || {});
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function firstValue(values) {
  for (const value of values) {
    if (value && typeof value === "object") continue;
    const normalized = normalizePostingValue(value);
    if (normalized) return normalized;
  }
  return "";
}

function pushUniqueText(values, candidate) {
  const normalized = normalizePostingValue(candidate);
  if (!normalized) return;
  const comparable = normalizeSearchText(normalized);
  if (!comparable) return;
  if (values.some((existing) => {
    const existingComparable = normalizeSearchText(existing);
    return existingComparable === comparable || existingComparable.includes(comparable) || comparable.includes(existingComparable);
  })) {
    return;
  }
  values.push(normalized);
}

function extractLocationText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    const values = [];
    for (const item of value) {
      pushUniqueText(values, extractLocationText(item));
    }
    return values.join(", ");
  }
  if (typeof value === "object") {
    const values = [];
    if (value.remote === true || value.isRemote === true || value.remoteAllowed === true) {
      pushUniqueText(values, "Remote");
    }
    pushUniqueText(values, value.locationName);
    pushUniqueText(values, value.name);
    pushUniqueText(values, value.text);
    pushUniqueText(values, value.label);
    pushUniqueText(values, value.displayName);
    pushUniqueText(values, value.formattedAddress);
    pushUniqueText(values, value.address);
    pushUniqueText(values, [value.city, value.region, value.state, value.province, value.country || value.countryName || value.countryCode].filter(Boolean).join(", "));
    pushUniqueText(values, extractLocationText(value.location));
    pushUniqueText(values, extractLocationText(value.locations));
    pushUniqueText(values, extractLocationText(value.jobLocation));
    pushUniqueText(values, extractLocationText(value.primaryLocation || value.PrimaryLocation));
    pushUniqueText(values, extractLocationText(value.workLocation));
    return values.join(", ");
  }
  return normalizePostingValue(value);
}

function normalizeConfidence(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function epochToIso(epoch) {
  const value = Number(epoch);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function isPlaceholderCompanyName(value) {
  const normalized = normalizeSearchText(value);
  return ["unknown", "unknown company", "unknown employer", "n/a", "na", "none"].includes(normalized);
}

function normalizePosting(posting, company, atsKey, options = {}) {
  const companyName =
    firstValue([
      posting?.company_name,
      posting?.company?.name,
      posting?.company?.companyName,
      posting?.companyName,
      posting?.organization?.name,
      company?.company_name
    ]);
  const positionName = firstValue([
    posting?.position_name,
    posting?.title,
    posting?.job_title,
    posting?.jobOpeningName,
    posting?.name
  ]);
  const jobPostingUrl = canonicalizePostingUrl(firstValue([
    posting?.job_posting_url,
    posting?.canonical_url,
    posting?.absolute_url,
    posting?.hostedUrl,
    posting?.careers_url,
    posting?.applicationUrl,
    posting?.applyUrl,
    posting?.url,
    posting?.ref,
    posting?.externalUrl
  ]));
  const applyUrl = canonicalizePostingUrl(firstValue([
    posting?.apply_url,
    posting?.applicationUrl,
    posting?.applyUrl,
    posting?.hostedUrl,
    jobPostingUrl
  ]));
  const location = firstValue([
    posting?.location_text,
    extractLocationText(posting?.location),
    extractLocationText(posting?.locations),
    extractLocationText(posting?.jobLocation),
    extractLocationText(posting?.PrimaryLocation),
    extractLocationText(posting?.workLocation),
    posting?.locationName,
    posting?.workplaceLocation,
    posting?.workplace
  ]) || null;
  const postingDate = normalizePostingDate(firstValue([
    posting?.posting_date,
    posting?.date_posted,
    posting?.datePosted,
    posting?.posted_at,
    posting?.postedAt,
    posting?.postedDate,
    posting?.releasedDate,
    posting?.created_at,
    posting?.createdAt,
    posting?.published_at,
    posting?.publishedAt
  ]));
  const remoteSignal = [
    posting?.remote_type,
    posting?.workplaceType,
    posting?.workplace_type,
    posting?.workplace_type_text,
    posting?.locationType,
    posting?.workLocationOption,
    posting?.remote,
    posting?.is_remote,
    posting?.isRemote,
    posting?.location?.remote,
    posting?.location?.isRemote,
    posting?.location?.remoteAllowed,
    extractLocationText(posting?.locations),
    posting?.employment_type,
    posting?.job_type,
    location,
    positionName
  ].map((value) => (value === true ? "remote" : normalizePostingValue(value))).filter(Boolean).join(" ");
  const remoteType = normalizeRemoteType(remoteSignal);
  const explicitCountry = firstValue([
    posting?.country,
    posting?.countryName,
    posting?.country_code,
    posting?.countryCode,
    posting?.isoCountry,
    posting?.iso3,
    posting?.location?.country,
    posting?.location?.countryName,
    posting?.location?.country_code,
    posting?.location?.countryCode,
    posting?.location?.isoCountry,
    posting?.location?.iso3,
    posting?.jobLocation?.country,
    posting?.jobLocation?.countryName,
    posting?.PrimaryLocation?.country,
    posting?.PrimaryLocation?.countryName,
    posting?.workLocation?.country,
    posting?.workLocation?.countryName
  ]);
  const country = firstValue([normalizeCountryName(explicitCountry), normalizeCountryFromLocation(location)]);
  const region = firstValue([posting?.region, normalizeRegionFromCountry(country)]);
  const parserVersion = normalizePostingValue(options?.parserVersion) || "legacy-adapter-v1";
  const sourceJobId =
    normalizePostingValue(posting?.source_job_id) ||
    normalizePostingValue(posting?.id) ||
    normalizePostingValue(posting?.job_id) ||
    normalizePostingValue(posting?.jobId) ||
    normalizePostingValue(posting?.JobId) ||
    normalizePostingValue(posting?.jobID) ||
    normalizePostingValue(posting?.itemID) ||
    normalizePostingValue(posting?.itemId) ||
    normalizePostingValue(posting?.reqId) ||
    normalizePostingValue(posting?.reqID) ||
    normalizePostingValue(posting?.DocumentID) ||
    normalizePostingValue(posting?.documentId) ||
    normalizePostingValue(posting?.external_id) ||
    normalizePostingValue(posting?.externalId) ||
    normalizePostingValue(posting?.vacancyId) ||
    normalizePostingValue(posting?.JobControl) ||
    normalizePostingValue(posting?.jobNum) ||
    normalizePostingValue(posting?.JobNum) ||
    normalizePostingValue(posting?.openingId) ||
    normalizePostingValue(posting?.opening_id) ||
    normalizePostingValue(posting?.requisition_id) ||
    normalizePostingValue(posting?.requisitionId);
  const seenEpoch = Number(options?.nowEpoch || options?.lastSeenEpoch || 0) || null;
  const firstSeenEpoch = Number(options?.firstSeenEpoch || seenEpoch || 0) || null;
  const lastSeenEpoch = Number(options?.lastSeenEpoch || seenEpoch || 0) || null;
  return {
    ...posting,
    ats_key: atsKey,
    source_job_id: sourceJobId,
    canonical_url: jobPostingUrl,
    apply_url: applyUrl || jobPostingUrl,
    title: positionName,
    company: companyName,
    company_name: companyName,
    position_name: positionName,
    job_posting_url: jobPostingUrl,
    location_text: location,
    location,
    posting_date: postingDate.raw,
    posted_at: postingDate.raw,
    posting_date_epoch: postingDate.epoch,
    posted_at_epoch: postingDate.epoch,
    country,
    region,
    remote_type: remoteType,
    industry: firstValue([posting?.industry, posting?.department, posting?.team, posting?.category]),
    first_seen: epochToIso(firstSeenEpoch),
    last_seen: epochToIso(lastSeenEpoch),
    first_seen_epoch: firstSeenEpoch,
    last_seen_epoch: lastSeenEpoch,
    parser_version: parserVersion,
    raw_hash: stablePayloadHash(posting),
    confidence: normalizeConfidence(options?.confidence, 0.5),
    is_remote: remoteType === "remote" || remoteType === "hybrid"
  };
}

function validatePosting(posting) {
  const url = normalizePostingValue(posting?.canonical_url || posting?.job_posting_url);
  const companyName = normalizePostingValue(posting?.company_name || posting?.company);
  const positionName = normalizePostingValue(posting?.position_name || posting?.title);
  const normalizedTitle = normalizeSearchText(positionName);
  const normalizedCompany = normalizeSearchText(companyName);

  if (!url) {
    return { ok: false, error: "missing job_posting_url" };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "invalid job_posting_url" };
  }
  if (!companyName) {
    return { ok: false, error: "missing company_name" };
  }
  if (isPlaceholderCompanyName(normalizedCompany)) {
    return { ok: false, error: "placeholder company_name" };
  }
  if (!positionName) {
    return { ok: false, error: "missing position_name" };
  }
  if (["untitled", "untitled position", "unknown", "unknown position", "unknown job"].includes(normalizedTitle)) {
    return { ok: false, error: "placeholder position_name" };
  }
  return { ok: true, error: "" };
}

module.exports = {
  canonicalizePostingUrl,
  extractLocationText,
  isPlaceholderCompanyName,
  normalizeCountryFromLocation,
  normalizeCountryName,
  normalizePosting,
  normalizePostingDate,
  normalizePostingValue,
  normalizeRegionFromCountry,
  normalizeRemoteType,
  stablePayloadHash,
  validatePosting
};
