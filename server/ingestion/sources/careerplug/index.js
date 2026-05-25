const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const { hostSlug, normalizeCompanyName } = require("./helpers");

const baseModule = createSourceModule("careerplug");
const discover = createDiscover(baseModule.parserVersion);
const fetchList = createFetchList(discover);

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? Object.fromEntries(Object.entries(rawPayload).filter(([name]) => name !== "__sourceConfig"))
    : rawPayload;
  return parser.parseCareerplugPostingsFromHtml(
    normalizeCompanyName(company, config.subdomainLower || hostSlug(config.list_url || target.list_url) || "careerplug"),
    config,
    payload?.html || payload
  );
}

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse
};
