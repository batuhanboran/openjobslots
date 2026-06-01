const { createSourceModule } = require("../common");
const parser = require("./parse");
const { clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const baseModule = createSourceModule("isolvisolvedhire");
const discover = createDiscover();
const fetchList = createFetchList({ discover });

function normalizeCompanyName(company = {}, fallback = "isolvisolvedhire") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function parse(rawPayload, company = {}) {
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const companyName = normalizeCompanyName(company, config.tenantLower || "isolvisolvedhire");
  return parser.parseIsolvisolvedhirePostingsFromApi(companyName, stripInternalPayloadFields(rawPayload), config);
}

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse
};
