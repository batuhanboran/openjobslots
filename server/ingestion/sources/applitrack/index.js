const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const baseModule = createSourceModule("applitrack");
const discover = createDiscover(baseModule.parserVersion);
const fetchList = createFetchList(discover);

function clean(value) {
  return String(value || "").trim();
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")))
    : rawPayload;
  return parser.parseApplitrackPostings(
    payload?.html || payload,
    config.siteRoot,
    clean(company.company_name || company.companyName || company.name || "Applitrack")
  );
}

function normalize(posting, company = {}, options = {}) {
  const cleanLoc = String(posting.location || "").trim();
  const fallback = company.company_name || company.companyName || company.name || posting.company_name;
  const hasFallback = fallback &&
                      fallback.toLowerCase() !== "www" &&
                      fallback.toLowerCase() !== "applitrack" &&
                      !/fixture|test|example/i.test(fallback);
  
  const updatedPosting = {
    ...posting,
    location: cleanLoc || (hasFallback ? fallback : null)
  };
  return baseModule.normalize(updatedPosting, company, options);
}

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse,
  normalize
};
