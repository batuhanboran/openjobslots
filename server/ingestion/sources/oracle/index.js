const { createSourceModule } = require("../common");
const parser = require("./parse");
const { clean, createDiscover, ORACLE_PARSER_VERSION } = require("./discover");
const { createFetchList } = require("./fetchList");

const atsKey = "oracle";
const baseModule = createSourceModule(atsKey);
const parserVersion = `${baseModule.parserVersion || ORACLE_PARSER_VERSION}`;
const discover = createDiscover(parserVersion);
const fetchList = createFetchList({ discover });
const payloadShapePolicy = Object.freeze({
  empty_job_list_stems: Object.freeze(["items[].requisitionList"])
});

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return rawPayload || {};
  }
  return Object.fromEntries(
    Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__"))
  );
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  const companyName =
    clean(rawPayload?.__companyNameForPostings) ||
    clean(company.company_name || company.companyName || company.name) ||
    (clean(config.siteNumber) ? `oracle_${clean(config.siteNumber).toLowerCase()}` : "oracle");
  return parser.parseOraclePostingsFromApi(companyName, config, payload);
}

module.exports = {
  ...baseModule,
  ...parser,
  atsKey,
  key: atsKey,
  family: baseModule.family,
  status: baseModule.status,
  parserVersion,
  discover,
  fetchList,
  parse,
  payloadShapePolicy
};
