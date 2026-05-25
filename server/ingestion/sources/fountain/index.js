const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const baseModule = createSourceModule("fountain");
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
  return parser.parseFountainPostingsFromApi(
    clean(company.company_name || company.companyName || company.name || config.companySlugLower || "fountain"),
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
