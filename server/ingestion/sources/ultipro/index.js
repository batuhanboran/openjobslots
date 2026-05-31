const { createSourceModule } = require("../common");
const parser = require("./parse");
const { clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const baseModule = createSourceModule("ultipro");
const discover = createDiscover();
const fetchList = createFetchList({ discover });
const payloadShapePolicy = Object.freeze({
  empty_job_list_stems: Object.freeze(["opportunities"])
});

function normalizeCompanyName(company = {}, fallback = "ultipro") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function parse(rawPayload, company = {}) {
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const companyName = normalizeCompanyName(company, config.tenantLower || config.tenant || "ultipro");
  return parser.parseUltiProPostingsFromApi(companyName, config, stripInternalPayloadFields(rawPayload));
}

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse,
  payloadShapePolicy
};
