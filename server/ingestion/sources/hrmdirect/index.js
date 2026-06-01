const { SOURCE_FAMILIES, SOURCE_STATUSES } = require("../../sourceContracts");
const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover, normalizeHrmDirectListUrl } = require("./discover");
const { createFetchList, hrmDirectDetailLimit } = require("./fetchList");
const { createNormalize } = require("./normalize");
const { hostSlug, normalizeCompanyName } = require("./helpers");

const baseModule = createSourceModule("hrmdirect");
const discover = createDiscover(baseModule.parserVersion);
const fetchList = createFetchList(discover);
const normalize = createNormalize(baseModule);
const payloadShapePolicy = Object.freeze({
  optional_enrichment_prefixes: Object.freeze([
    "__rssUrl",
    "__rssXml",
    "__rssStatus",
    "__rssFailure",
    "__detailHtmlByUrl",
    "__detailStatusByUrl",
    "__detailFailureByUrl"
  ])
});

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? Object.fromEntries(Object.entries(rawPayload).filter(([name]) => name !== "__sourceConfig"))
    : rawPayload;
  return parser.parseHrmDirectPostingsFromHtml(
    normalizeCompanyName(company, config.subdomainLower || hostSlug(config.list_url || target.list_url) || "hrmdirect"),
    config,
    payload
  );
}

module.exports = {
  ...baseModule,
  ...parser,
  atsKey: "hrmdirect",
  family: SOURCE_FAMILIES.vendorSpecific,
  status: SOURCE_STATUSES.enabled,
  discover,
  fetchList,
  parse,
  normalize,
  payloadShapePolicy,
  normalizeHrmDirectListUrl,
  hrmDirectDetailLimit
};
