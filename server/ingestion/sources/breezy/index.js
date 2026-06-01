const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const { hostSlug, normalizeCompanyName } = require("./helpers");

const baseModule = createSourceModule("breezy");
const discover = createDiscover(baseModule.parserVersion);
const fetchList = createFetchList(discover);
const payloadShapePolicy = Object.freeze({
  optional_enrichment_prefixes: Object.freeze([
    "__json",
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
  return parser.parseBreezyPostingsFromHtml(
    normalizeCompanyName(company, config.subdomainLower || hostSlug(config.list_url || target.list_url) || "breezy"),
    config,
    payload
  );
}

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse,
  payloadShapePolicy
};
