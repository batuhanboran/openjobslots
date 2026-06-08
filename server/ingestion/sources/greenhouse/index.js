const { SOURCE_FAMILIES, SOURCE_STATUSES } = require("../../sourceContracts");
const { createSourceModule } = require("../common");
const parser = require("./parse");
const {
  buildCompanyContext,
  createDiscover,
  clean,
  parseGreenhouseCompany
} = require("./discover");
const { createFetchList } = require("./fetchList");

const sourceModule = createSourceModule("greenhouse");
const discover = createDiscover(sourceModule.parserVersion);
const fetchList = createFetchList({ discover });

function stripMetadataFields(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return Object.fromEntries(
    Object.entries(payload).filter(([name]) => !String(name).startsWith("__"))
  );
}

function parse(rawPayload = {}, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;

  const context = buildCompanyContext(company);
  const discovered = discover(context);
  const metadataPayload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const config = metadataPayload.__sourceConfig || discovered.config || {};
  const payload = stripMetadataFields(rawPayload);
  const resolvedConfig = parseGreenhouseCompany(context.url_string) || config;
  const companyNameForPostings = clean(
    context.company_name ||
    metadataPayload.__companyNameForPostings ||
    resolvedConfig.companyNameForPostings ||
    config.boardTokenLower ||
    sourceModule.key
  );

  return parser.parseGreenhousePostingsFromApi(
    companyNameForPostings,
    { ...config, ...resolvedConfig },
    payload
  );
}

const fetchDetail = require("./fetchDetail");

module.exports = {
  ...sourceModule,
  atsKey: "greenhouse",
  key: sourceModule.key,
  family: SOURCE_FAMILIES.directJsonStable,
  status: SOURCE_STATUSES.enabled,
  discover,
  fetchList,
  fetchDetail,
  parse,
  ...parser
};
