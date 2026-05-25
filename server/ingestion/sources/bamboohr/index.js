const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const { normalizeCompanyName } = require("./helpers");

const baseModule = createSourceModule("bamboohr");
const discover = createDiscover(baseModule.parserVersion);
const fetchList = createFetchList(discover);

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
  parse
};
