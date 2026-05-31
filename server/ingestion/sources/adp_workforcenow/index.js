const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const atsKey = "adp_workforcenow";
const baseModule = createSourceModule(atsKey);
const payloadShapePolicy = Object.freeze({
  empty_job_list_stems: Object.freeze(["jobRequisitions"])
});

function clean(value) {
  return String(value || "").trim();
}

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
  const companyNameForPostings =
    clean(rawPayload?.__companyNameForPostings) ||
    clean(company.company_name || company.companyName || company.name) ||
    clean(config.companyNameForPostings) ||
    atsKey;
  return parser.parseAdpWorkforcenowPostingsFromApi(companyNameForPostings, config, payload);
}

const discover = createDiscover(baseModule.parserVersion);
const fetchList = createFetchList({ discover });

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse,
  atsKey,
  key: atsKey,
  family: baseModule.family,
  status: baseModule.status,
  parserVersion: baseModule.parserVersion,
  payloadShapePolicy
};
