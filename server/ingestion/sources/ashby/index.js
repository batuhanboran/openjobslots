const { createSourceModule } = require("../common");
const parser = require("./parse");

const baseModule = createSourceModule("ashby");

function clean(value) {
  return String(value || "").trim();
}

function normalizeCompanyName(company = {}, fallback = "ashby") {
  return clean(company.company_name || company.companyName || company.name || fallback);
}

function stripSourceConfig(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => name !== "__sourceConfig"));
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = baseModule.discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  return parser.parseAshbyPostingsFromApi(
    normalizeCompanyName(company, "ashby"),
    config,
    stripSourceConfig(rawPayload)
  );
}

module.exports = {
  ...baseModule,
  ...parser,
  parse,
  fetchDetail: require("./fetchDetail")
};
