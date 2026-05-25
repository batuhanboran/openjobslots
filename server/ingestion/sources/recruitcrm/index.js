const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const baseModule = createSourceModule("recruitcrm");
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
    ? Object.fromEntries(Object.entries(rawPayload).filter(([name]) => name !== "__sourceConfig"))
    : rawPayload;
  return parser.parseRecruitCrmPostingsFromApi(
    clean(company.company_name || company.companyName || company.name || config.account || "recruitcrm"),
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
