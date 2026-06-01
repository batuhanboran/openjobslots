const { createSourceModule } = require("../common");
const parser = require("./parse");

const baseModule = createSourceModule("lever");

function clean(value) {
  return String(value || "").trim();
}

function normalizeCompanyName(company = {}, fallback = "lever") {
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
  return parser.parseLeverPostingsFromApi(
    normalizeCompanyName(company, "lever"),
    config,
    stripSourceConfig(rawPayload)
  );
}

module.exports = {
  ...baseModule,
  ...parser,
  parse
};
