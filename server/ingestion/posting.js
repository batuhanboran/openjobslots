function normalizePostingValue(value) {
  return String(value || "").trim();
}

function canonicalizePostingUrl(value) {
  const raw = normalizePostingValue(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith("utm_") ||
        [
          "_ga",
          "_gl",
          "gh_src",
          "iis",
          "iisn",
          "lever-source",
          "ref",
          "referrer",
          "source",
          "src"
        ].includes(normalizedKey)
      ) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return raw.replace(/#.*$/, "");
  }
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
  ["Germany", ["de", "deu", "germany", "deutschland", "njemacka"]],
  ["France", ["fr", "fra", "france"]],
  ["Netherlands", ["nl", "nld", "netherlands", "holland", "nederland", "niederlande", "nizozemska"]],
  ["Spain", ["es", "esp", "spain", "españa", "espana"]],
  ["Italy", ["it", "ita", "italy", "italia"]],
  ["Ireland", ["ie", "irl", "ireland"]],
  ["Iceland", ["is", "isl", "iceland"]],
  ["India", ["in", "ind", "india"]],
  ["Australia", ["au", "aus", "australia"]],
  ["New Zealand", ["nz", "nzl", "new zealand"]],
  ["Singapore", ["sg", "sgp", "singapore"]],
  ["Japan", ["jp", "jpn", "japan"]],
  ["South Korea", ["kr", "kor", "south korea", "korea", "republic of korea"]],
  ["China", ["cn", "chn", "china", "中国"]],
  ["Hong Kong", ["hk", "hkg", "hong kong"]],
  ["Malaysia", ["my", "mys", "malaysia"]],
  ["Indonesia", ["id", "idn", "indonesia"]],
  ["Philippines", ["ph", "phl", "philippines"]],
  ["Sri Lanka", ["lk", "lka", "sri lanka"]],
  ["Papua New Guinea", ["pg", "png", "papua new guinea"]],
  ["Brunei", ["bn", "brn", "brunei", "brunei darussalam"]],
  ["Macao", ["mac", "macao", "macau"]],
  ["Bangladesh", ["bd", "bgd", "bangladesh"]],
  ["Thailand", ["th", "tha", "thailand"]],
  ["Vietnam", ["vn", "vnm", "vietnam", "viet nam"]],
  ["Laos", ["lao", "laos"]],
  ["Brazil", ["br", "bra", "brazil", "brasil"]],
  ["Mexico", ["mx", "mex", "mexico", "méxico"]],
  ["Argentina", ["ar", "arg", "argentina"]],
  ["Bolivia", ["bo", "bol", "bolivia"]],
  ["Chile", ["cl", "chl", "chile"]],
  ["Colombia", ["co", "col", "colombia"]],
  ["Costa Rica", ["cr", "cri", "costa rica"]],
  ["Suriname", ["sr", "sur", "suriname"]],
  ["Belize", ["bz", "blz", "belize"]],
  ["Guyana", ["gy", "guy", "guyana"]],
  ["El Salvador", ["sv", "slv", "el salvador"]],
  ["Guatemala", ["gt", "gtm", "guatemala"]],
  ["Honduras", ["hn", "hnd", "honduras"]],
  ["Nicaragua", ["ni", "nic", "nicaragua"]],
  ["Panama", ["pa", "pan", "panama", "panamá"]],
  ["Peru", ["pe", "per", "peru"]],
  ["Paraguay", ["py", "pry", "paraguay"]],
  ["Uruguay", ["uy", "ury", "uruguay"]],
  ["Portugal", ["pt", "prt", "portugal"]],
  ["Poland", ["pl", "pol", "poland", "polska"]],
  ["Romania", ["ro", "rou", "romania"]],
  ["Czech Republic", ["cz", "cze", "czech republic", "czechia"]],
  ["Slovakia", ["sk", "svk", "slovakia", "slovensko"]],
  ["Hungary", ["hu", "hun", "hungary"]],
  ["Austria", ["at", "aut", "austria", "osterreich", "austrija"]],
  ["Switzerland", ["ch", "che", "switzerland", "schweiz", "suisse"]],
  ["Belgium", ["be", "bel", "belgium", "belgie"]],
  ["Denmark", ["dk", "dnk", "denmark"]],
  ["Sweden", ["se", "swe", "sweden"]],
  ["Norway", ["no", "nor", "norway"]],
  ["Finland", ["fi", "fin", "finland"]],
  ["Estonia", ["ee", "est", "estonia"]],
  ["Latvia", ["lv", "lva", "latvia", "latvija"]],
  ["Lithuania", ["lt", "ltu", "lithuania"]],
  ["Greece", ["gr", "grc", "greece"]],
  ["Bulgaria", ["bg", "bgr", "bulgaria"]],
  ["Croatia", ["hr", "hrv", "croatia", "hrvatska"]],
  ["Serbia", ["rs", "srb", "serbia", "srbija"]],
  ["Slovenia", ["si", "svn", "slovenia", "slovenija"]],
  ["Bosnia and Herzegovina", ["ba", "bih", "bosnia and herzegovina", "bosnia", "bosna i hercegovina"]],
  ["Kosovo", ["xk", "kosovo"]],
  ["Ukraine", ["ua", "ukr", "ukraine"]],
  ["Israel", ["il", "isr", "israel"]],
  ["United Arab Emirates", ["ae", "are", "uae", "united arab emirates", "dubai", "abu dhabi"]],
  ["Saudi Arabia", ["sa", "sau", "saudi arabia"]],
  ["Afghanistan", ["af", "afg", "afghanistan"]],
  ["Algeria", ["dz", "dza", "algeria"]],
  ["Sudan", ["sd", "sdn", "sudan"]],
  ["South Sudan", ["ss", "ssd", "south sudan"]],
  ["Syria", ["sy", "syr", "syria"]],
  ["Djibouti", ["dj", "dji", "djibouti"]],
  ["Kazakhstan", ["kz", "kaz", "kazakhstan"]],
  ["Guam", ["gu", "gum", "guam"]],
  ["Luxembourg", ["lu", "lux", "luxembourg"]],
  ["Malta", ["mt", "mlt", "malta"]],
  ["Lebanon", ["lb", "lbn", "lebanon"]],
  ["Jordan", ["jo", "jor", "jordan"]],
  ["Iraq", ["iq", "irq", "iraq"]],
  ["Cambodia", ["kh", "khm", "cambodia"]],
  ["Kenya", ["ke", "ken", "kenya"]],
  ["Ghana", ["gh", "gha", "ghana"]],
  ["Ethiopia", ["et", "eth", "ethiopia"]],
  ["Cameroon", ["cm", "cmr", "cameroon", "cameroun"]],
  ["Nigeria", ["ng", "nga", "nigeria"]],
  ["Uganda", ["ug", "uga", "uganda"]],
  ["Zimbabwe", ["zw", "zwe", "zimbabwe"]],
  ["Cote d'Ivoire", ["ci", "civ", "cote d'ivoire", "cote divoire", "cote d'ivoire (ivory coast)", "ivory coast"]],
  ["Botswana", ["bw", "bwa", "botswana"]],
  ["Mauritania", ["mr", "mrt", "mauritania"]],
  ["Benin", ["bj", "ben", "benin"]],
  ["Burkina Faso", ["bf", "bfa", "burkina faso"]],
  ["Central African Republic", ["cf", "caf", "central african republic"]],
  ["Gambia", ["gm", "gmb", "gambia"]],
  ["Togo", ["tg", "tgo", "togo"]],
  ["Gabon", ["ga", "gab", "gabon"]],
  ["Liberia", ["lr", "lbr", "liberia"]],
  ["Madagascar", ["mg", "mdg", "madagascar"]],
  ["Tanzania", ["tz", "tza", "tanzania"]],
  ["Mozambique", ["mz", "moz", "mozambique"]],
  ["Zambia", ["zm", "zmb", "zambia"]],
  ["Myanmar", ["mm", "mmr", "myanmar", "burma"]],
  ["North Macedonia", ["mk", "mkd", "macedonia", "north macedonia", "sjeverna makedonija"]],
  ["Montenegro", ["me", "mne", "montenegro", "crna gora"]],
  ["Solomon Islands", ["sb", "slb", "solomon islands"]],
  ["Mauritius", ["mu", "mus", "mauritius"]],
  ["South Africa", ["za", "zaf", "south africa"]],
  ["Egypt", ["eg", "egy", "egypt"]],
  ["Libya", ["ly", "lby", "libya"]],
  ["Pakistan", ["pk", "pak", "pakistan"]],
  ["Iran", ["ir", "irn", "iran", "iran islamic republic of", "islamic republic of iran"]],
  ["Chad", ["td", "tcd", "chad"]],
  ["Ecuador", ["ec", "ecu", "ecuador"]],
  ["Bahamas", ["bs", "bhs", "bahamas", "the bahamas"]],
  ["Puerto Rico", ["pr", "pri", "puerto rico"]],
  ["U.S. Virgin Islands", ["vi", "vir", "usvi", "u.s. virgin islands", "us virgin islands", "united states virgin islands", "virgin islands, u.s."]],
  ["Dominican Republic", ["do", "dom", "dominican republic", "rep dom", "rep.dom"]],
  ["Jamaica", ["jm", "jam", "jamaica"]],
  ["Barbados", ["bb", "brb", "barbados"]],
  ["Guyana", ["gy", "guy", "guyana"]],
  ["Trinidad and Tobago", ["tt", "tto", "trinidad and tobago"]],
  ["Aruba", ["aw", "abw", "aruba"]],
  ["Bermuda", ["bm", "bmu", "bermuda"]],
  ["British Virgin Islands", ["vg", "vgb", "bvi", "british virgin islands", "virgin islands, british", "virgin islands british"]],
  ["Saint Kitts and Nevis", ["kn", "kna", "saint kitts and nevis", "st kitts and nevis"]],
  ["Morocco", ["mar", "morocco"]],
  ["Malta", ["mlt", "malta"]],
  ["Monaco", ["mco", "monaco"]],
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
  ["United Kingdom", ["london", "manchester", "birmingham", "edinburgh", "glasgow", "bristol", "leeds", "cambridge", "hebburn", "falmouth"]],
  ["Canada", [
    "toronto", "vancouver", "montreal", "ottawa", "calgary", "edmonton", "waterloo", "quebec",
    "alberta", "british columbia", "manitoba", "new brunswick", "newfoundland and labrador", "nova scotia",
    "ontario", "prince edward island", "saskatchewan", "northwest territories", "nunavut", "yukon"
  ]],
  ["Germany", ["berlin", "munich", "münchen", "hamburg", "frankfurt", "cologne", "stuttgart", "heidelberg"]],
  ["France", ["paris", "lyon", "marseille", "toulouse", "lille"]],
  ["Netherlands", ["amsterdam", "rotterdam", "utrecht", "eindhoven"]],
  ["Spain", ["madrid", "barcelona", "valencia", "malaga"]],
  ["Italy", ["rome", "roma", "milan", "milano", "turin"]],
  ["Ireland", ["dublin", "cork", "galway"]],
  ["India", ["bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi", "gurgaon", "gurugram", "noida", "chennai"]],
  ["Australia", ["sydney", "melbourne", "brisbane", "perth", "adelaide", "carlton", "victoria"]],
  ["Singapore", ["singapore"]],
  ["Japan", ["tokyo", "osaka", "kyoto"]],
  ["Brazil", ["sao paulo", "são paulo", "rio de janeiro", "curitiba", "nova lima"]],
  ["Mexico", ["mexico city", "ciudad de mexico", "guadalajara", "monterrey"]],
  ["Poland", ["warsaw", "krakow", "kraków", "wroclaw", "wrocław"]],
  ["Portugal", ["lisbon", "lisboa", "porto"]],
  ["United Arab Emirates", ["dubai", "abu dhabi"]],
  ["Luxembourg", ["luxembourg"]],
  ["Lebanon", ["beirut", "ajaltoun"]],
  ["Jordan", ["amman"]],
  ["Iraq", ["baghdad", "basra"]],
  ["Cambodia", ["poipet", "phnom penh"]],
  ["Kenya", ["nairobi", "nairobi area"]],
  ["Myanmar", ["bago", "yangon", "mandalay"]],
  ["North Macedonia", ["skopje", "tetovo"]],
  ["Solomon Islands", ["honiara"]],
  ["Serbia", ["belgrade"]],
  ["Romania", ["cluj napoca", "bucharest"]],
  ["Philippines", ["taguig", "manila", "mandaluyong", "mandaluyong city"]],
  ["Saudi Arabia", ["riyadh", "jeddah", "dammam", "madinah", "al ahsa"]],
  ["Mauritius", ["ebene"]],
  ["South Korea", ["seoul", "ulsan", "busan", "incheon"]],
  ["Taiwan", ["taipei", "hsinchu", "hsin chu", "taichung", "kaohsiung", "taiwan"]],
  ["Armenia", ["yerevan"]],
  ["Cyprus", ["nicosia", "limassol"]],
  ["Cayman Islands", ["george town", "grand cayman"]],
  ["Ecuador", ["quito", "guayaquil"]],
  ["Iran", ["tehran"]]
]);

const US_STATE_NAMES = Object.freeze(new Set([
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "district of columbia",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming"
]));

const CANADA_PROVINCE_NAMES = Object.freeze(new Set([
  "alberta",
  "british columbia",
  "manitoba",
  "new brunswick",
  "newfoundland and labrador",
  "nova scotia",
  "northwest territories",
  "nunavut",
  "ontario",
  "prince edward island",
  "quebec",
  "saskatchewan",
  "yukon"
]));

const US_STATE_ABBREVIATION_PATTERN =
  /(?:^|,\s*|\s-\s)(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?:\s|,|$)/i;
const CANADA_PROVINCE_ABBREVIATION_PATTERN =
  /(?:^|,\s*|\s-\s)(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)(?:\s|,|$)/i;
const US_STATE_ABBREVIATION_EXACT_PATTERN =
  /^(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)$/i;
const CANADA_PROVINCE_ABBREVIATION_EXACT_PATTERN =
  /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/i;
const US_STATE_HYPHEN_PREFIX_PATTERN =
  /^(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)[-\s]/i;
const CANADA_PROVINCE_HYPHEN_PREFIX_PATTERN =
  /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)[-\s]/i;
const COUNTRY_CODE_LOCATION_PATTERN = /^([A-Z]{2,3})[-\s](.+)$/i;

function normalizeCountryFromAtsCodeLocation(value) {
  const location = normalizePostingValue(value);
  const exactCode = location.match(/^([A-Z]{2,3})-?$/i);
  if (exactCode?.[1]) {
    return COUNTRY_ALIASES[normalizeSearchText(exactCode[1]).replace(/[^a-z0-9]+/g, "")] || "";
  }

  const match = location.match(COUNTRY_CODE_LOCATION_PATTERN);
  if (!match?.[1] || !match?.[2]) return "";

  const countryCode = normalizeSearchText(match[1]).replace(/[^a-z0-9]+/g, "");
  const remainder = String(match[2] || "").trim();
  const country = COUNTRY_ALIASES[countryCode];
  if (!country) return "";

  const remainderHead = String(remainder.split(/[-\s,]+/)[0] || "").toUpperCase();
  if (country === "United States") {
    if (/^(Remote|Hybrid|Virtual)$/i.test(remainder)) return country;
    return US_STATE_ABBREVIATION_PATTERN.test(`, ${remainderHead}`) || /^[A-Z]{2}[-\s]/.test(remainder)
      ? country
      : "";
  }
  if (country === "Canada") {
    if (/^(Remote|Hybrid|Virtual)$/i.test(remainder)) return country;
    return CANADA_PROVINCE_ABBREVIATION_PATTERN.test(`, ${remainderHead}`) || /^[A-Z]{2}[-\s]/.test(remainder)
      ? country
      : "";
  }

  return country;
}

function hasAtsCountryCodePhysicalLocation(value) {
  const location = normalizePostingValue(value);
  if (!normalizeCountryFromAtsCodeLocation(location)) return false;
  const remainder = String(location.match(COUNTRY_CODE_LOCATION_PATTERN)?.[2] || "");
  if (!remainder || normalizeRemoteType(remainder) !== "unknown") return false;
  return /[A-Za-z]{3,}/.test(remainder);
}

function normalizeCountryFromDelimitedCode(location) {
  const tokens = String(location || "")
    .split(/[,\n\r/|;]+/)
    .map((part) => normalizeSearchText(part).replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean);
  for (const token of tokens) {
    const compact = token.replace(/\s+/g, "");
    if (compact.length < 2 || compact.length > 3) continue;
    if (compact.length === 2 && tokens.length > 2) continue;
    const country = COUNTRY_ALIASES[compact];
    if (!country) continue;
    if (country === "United States" || country === "Canada") continue;
    return country;
  }
  return "";
}

function locationLooksNarrativeText(value) {
  const text = normalizePostingValue(value);
  if (!text || text.length < 45) return false;
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length < 7) return false;
  const hasSentenceEnd = /[.!?]$/.test(text);
  const hasNarrativeCue = /\b(?:ability to|client[-\s]specific|collaborating|compliance|customers?|develop|ensuring|experience|external|internal|manage|provide|requirements?|responsibilit(?:y|ies)|skills?|supporting|team|while|working)\b/i.test(text);
  if (hasSentenceEnd && hasNarrativeCue) return true;
  return words.length >= 10 && /\b(?:responsible for|you will|we are|ability to|experience with|ensuring that)\b/i.test(text);
}

function normalizeCountryFromLocation(value) {
  const location = normalizePostingValue(value);
  const normalized = normalizeSearchText(location);
  if (!normalized) return "";
  if (locationLooksNarrativeText(location)) return "";
  const atsCodeCountry = normalizeCountryFromAtsCodeLocation(location);
  if (atsCodeCountry) return atsCodeCountry;
  if (US_STATE_ABBREVIATION_PATTERN.test(location)) return "United States";
  if (US_STATE_HYPHEN_PREFIX_PATTERN.test(location)) return "United States";
  if (CANADA_PROVINCE_ABBREVIATION_PATTERN.test(location)) return "Canada";
  if (CANADA_PROVINCE_HYPHEN_PREFIX_PATTERN.test(location)) return "Canada";
  const delimitedCodeCountry = normalizeCountryFromDelimitedCode(location);
  if (delimitedCodeCountry) return delimitedCodeCountry;

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
    "iceland",
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
    "bosnia and herzegovina",
    "kosovo",
    "ukraine",
    "israel",
    "chad",
    "iran",
    "armenia",
    "cyprus",
    "luxembourg",
    "malta",
    "lebanon",
    "jordan",
    "iraq",
    "kenya",
    "ghana",
    "ethiopia",
    "cameroon",
    "nigeria",
    "uganda",
    "zimbabwe",
    "cote d'ivoire",
    "botswana",
    "mauritania",
    "benin",
    "burkina faso",
    "central african republic",
    "gambia",
    "togo",
    "gabon",
    "liberia",
    "madagascar",
    "tanzania",
    "mozambique",
    "zambia",
    "north macedonia",
    "montenegro",
    "morocco",
    "algeria",
    "sudan",
    "south sudan",
    "syria",
    "djibouti",
    "malta",
    "qatar",
    "kuwait",
    "bahrain",
    "oman",
    "united arab emirates",
    "saudi arabia",
    "mauritius",
    "south africa",
    "egypt",
    "libya",
    "monaco"
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
    "sri lanka",
    "papua new guinea",
    "brunei",
    "macao",
    "bangladesh",
    "cambodia",
    "myanmar",
    "philippines",
    "thailand",
    "vietnam",
    "laos",
    "pakistan",
    "afghanistan",
    "kazakhstan",
    "solomon islands",
    "guam"
  ].includes(normalized)) {
    return "APAC";
  }
  if ([
    "brazil",
    "mexico",
    "argentina",
    "bolivia",
    "chile",
    "colombia",
    "costa rica",
    "suriname",
    "belize",
    "el salvador",
    "guatemala",
    "guyana",
    "honduras",
    "nicaragua",
    "panama",
    "peru",
    "paraguay",
    "uruguay",
    "ecuador"
  ].includes(normalized)) {
    return "LATAM";
  }
  if ([
    "aruba",
    "bahamas",
    "barbados",
    "cayman islands",
    "dominican republic",
    "jamaica",
    "puerto rico",
    "u.s. virgin islands",
    "bermuda",
    "british virgin islands",
    "trinidad and tobago",
    "saint kitts and nevis"
  ].includes(normalized)) {
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

function hasConcretePhysicalLocation(value) {
  const location = normalizePostingValue(value);
  const normalized = normalizeSearchText(location);
  if (!normalized) return false;
  if (normalizeRemoteType(location) === "remote" || normalizeRemoteType(location) === "hybrid") return false;
  if (hasAtsCountryCodePhysicalLocation(location)) return true;
  if (US_STATE_ABBREVIATION_PATTERN.test(location) || CANADA_PROVINCE_ABBREVIATION_PATTERN.test(location)) return true;
  if (US_STATE_HYPHEN_PREFIX_PATTERN.test(location) || CANADA_PROVINCE_HYPHEN_PREFIX_PATTERN.test(location)) return true;
  if (/[A-Za-z][A-Za-z .'-]+,\s*[A-Za-z][A-Za-z .'-]+/.test(location)) return true;
  for (const [, terms] of COUNTRY_LOCATION_TERMS) {
    for (const term of terms) {
      const normalizedTerm = normalizeSearchText(term);
      if (normalizedTerm.length < 4) continue;
      const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(normalized)) return true;
    }
  }
  return false;
}

function normalizeRemoteTypeFromEvidence(remoteSignal, location) {
  const remoteType = normalizeRemoteType(remoteSignal);
  if (remoteType !== "unknown") return remoteType;
  return hasConcretePhysicalLocation(location) ? "onsite" : "unknown";
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

function stripHtmlToPlainText(value) {
  return normalizePostingValue(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCityText(posting, location, country) {
  const explicit = firstValue([
    posting?.city,
    posting?.location?.city,
    posting?.jobLocation?.city,
    posting?.PrimaryLocation?.city,
    posting?.primaryLocation?.city,
    posting?.workLocation?.city
  ]);
  if (explicit) {
    const normalizedExplicit = normalizeSearchText(explicit);
    const normalizedCountry = normalizeSearchText(country);
    if (/^(remote|hybrid|onsite|on[- ]?site|work from home|wfh|worldwide|anywhere)$/i.test(explicit)) return "";
    if (/\b(?:work from home|home based|remote|hybrid)\b/i.test(explicit)) return "";
    if (/^\(?\s*(multiple|various|several|all)\b/i.test(explicit)) return "";
    if (locationLooksNarrativeText(explicit)) return "";
    if (normalizedCountry && normalizedExplicit === normalizedCountry) return "";
    if (COUNTRY_ALIASES[normalizedExplicit]) return "";
    if (
      (US_STATE_ABBREVIATION_EXACT_PATTERN.test(explicit) && (!normalizedCountry || normalizedCountry === "united states")) ||
      (CANADA_PROVINCE_ABBREVIATION_EXACT_PATTERN.test(explicit) && (!normalizedCountry || normalizedCountry === "canada"))
    ) {
      return "";
    }
    return explicit;
  }

  const locationText = normalizePostingValue(location);
  if (!locationText || /^(remote|worldwide|anywhere)$/i.test(locationText)) return "";
  const atsCodeCity = extractCityFromAtsCodeLocation(locationText);
  if (atsCodeCity) return atsCodeCity;
  const locationWithoutModePrefix = locationText.replace(
    /^(?:remote|hybrid|onsite|on[- ]?site|work from home|wfh|virtual|telework)\s*[-:,]\s*/i,
    ""
  );
  const firstSegment = locationWithoutModePrefix.split(/\s*,\s*|\s+-\s+|\s+\|\s+/)[0]?.trim() || "";
  if (!firstSegment || firstSegment.length > 80) return "";
  if (/^(remote|hybrid|onsite|on[- ]?site|work from home|wfh|worldwide|anywhere)$/i.test(firstSegment)) return "";
  if (/\b(?:work from home|home based|remote|hybrid)\b/i.test(firstSegment)) return "";
  if (/^[A-Z]{2}\s+[A-Z0-9]{2,}\s+.*\bwork from home\b/i.test(firstSegment)) return "";
  if (/^\(?\s*(multiple|various|several|all)\b/i.test(firstSegment)) return "";
  if (/^\(?\s*(multiple|various|several|all)\s*$/i.test(firstSegment)) return "";
  if (/^\(?\s*(multiple|various|several|all)\s+(locations|states|sites|schools|campuses|bases|offices)\b/i.test(firstSegment)) return "";
  if (/^(district[- ]?wide|statewide|nationwide|tbd|n\/?a|unknown)$/i.test(firstSegment)) return "";
  if (locationLooksNarrativeText(firstSegment)) return "";
  const normalizedFirst = normalizeSearchText(firstSegment);
  const normalizedCountry = normalizeSearchText(country);
  if (normalizedCountry && normalizedFirst === normalizedCountry) return "";
  if (COUNTRY_ALIASES[normalizedFirst]) return "";
  if (
    ((US_STATE_ABBREVIATION_EXACT_PATTERN.test(firstSegment) || US_STATE_NAMES.has(normalizedFirst)) && (!normalizedCountry || normalizedCountry === "united states")) ||
    ((CANADA_PROVINCE_ABBREVIATION_EXACT_PATTERN.test(firstSegment) || CANADA_PROVINCE_NAMES.has(normalizedFirst)) && (!normalizedCountry || normalizedCountry === "canada"))
  ) {
    return "";
  }
  return firstSegment;
}

function extractCityFromAtsCodeLocation(value) {
  const location = normalizePostingValue(value);
  const match = location.match(/^([A-Z]{2,3})[-\s]([A-Z]{2,3})[-\s](.+)$/i);
  if (!match?.[1] || !match?.[3]) return "";
  if (!normalizeCountryFromAtsCodeLocation(location)) return "";
  const city = normalizePostingValue(match[3]).replace(/[-_]+/g, " ");
  if (!city || /^(remote|hybrid|virtual|work from home|wfh)$/i.test(city)) return "";
  return city;
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
  const remoteType = normalizeRemoteTypeFromEvidence(remoteSignal, location);
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
  const country = firstValue([
    normalizeCountryName(explicitCountry),
    normalizeSearchText(atsKey) === "icims" ? normalizeCountryFromAtsCodeLocation(location) : "",
    normalizeCountryFromLocation(location)
  ]);
  const region = firstValue([posting?.region, normalizeRegionFromCountry(country)]);
  const city = extractCityText(posting, location, country);
  const department = firstValue([
    posting?.department,
    posting?.team,
    posting?.category,
    posting?.departmentName,
    posting?.job?.department?.name,
    posting?.categories?.team,
    posting?.categories?.department
  ]);
  const employmentType = firstValue([
    posting?.employment_type,
    posting?.employmentType,
    posting?.job_type,
    posting?.jobType,
    posting?.commitment,
    posting?.categories?.commitment,
    posting?.type
  ]);
  const descriptionHtml = firstValue([
    posting?.description_html,
    posting?.descriptionHtml,
    posting?.body_html,
    posting?.content_html,
    posting?.job_description_html
  ]);
  const descriptionTextSource = firstValue([
    posting?.description_plain,
    posting?.descriptionPlain,
    posting?.description_text,
    posting?.descriptionText,
    posting?.description,
    posting?.body,
    posting?.content,
    descriptionHtml
  ]);
  const descriptionPlain = stripHtmlToPlainText(descriptionTextSource);
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
    city,
    posting_date: postingDate.raw,
    posted_at: postingDate.raw,
    posting_date_epoch: postingDate.epoch,
    posted_at_epoch: postingDate.epoch,
    country,
    region,
    remote_type: remoteType,
    industry: firstValue([posting?.industry, posting?.department, posting?.team, posting?.category]),
    department,
    employment_type: employmentType,
    description_plain: descriptionPlain,
    description_html: descriptionHtml,
    first_seen: epochToIso(firstSeenEpoch),
    last_seen: epochToIso(lastSeenEpoch),
    first_seen_epoch: firstSeenEpoch,
    last_seen_epoch: lastSeenEpoch,
    parser_version: parserVersion,
    raw_hash: stablePayloadHash(posting),
    confidence: normalizeConfidence(options?.confidence, 0.5),
    parser_confidence: normalizeConfidence(options?.confidence, 0.5),
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
  normalizeCountryFromAtsCodeLocation,
  normalizeCountryName,
  normalizePosting,
  normalizePostingDate,
  normalizePostingValue,
  normalizeRegionFromCountry,
  normalizeRemoteType,
  normalizeRemoteTypeFromEvidence,
  stablePayloadHash,
  validatePosting
};
