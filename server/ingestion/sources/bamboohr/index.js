const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const { normalizeCompanyName } = require("./helpers");

const baseModule = createSourceModule("bamboohr");
const discover = createDiscover(baseModule.parserVersion);
const fetchList = createFetchList(discover);
const payloadShapePolicy = Object.freeze({
  ignored_stems: Object.freeze([
    "result[].location.city",
    "result[].location.state",
    "result[].location.province",
    "result[].location.region",
    "result[].location.country",
    "result[].location.countryName",
    "result[].location.countryCode",
    "result[].atsLocation.city",
    "result[].atsLocation.state",
    "result[].atsLocation.province",
    "result[].atsLocation.region",
    "result[].atsLocation.country",
    "result[].atsLocation.countryName",
    "result[].atsLocation.countryCode"
  ])
});

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? Object.fromEntries(Object.entries(rawPayload).filter(([name]) => name !== "__sourceConfig"))
    : rawPayload;
  return parser.parseBambooHrPostingsFromApi(
    normalizeCompanyName(company, config.companySubdomainLower || "bamboohr"),
    config,
    payload
  );
}

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse,
  payloadShapePolicy
};
