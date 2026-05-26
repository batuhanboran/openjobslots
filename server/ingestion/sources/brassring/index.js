const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const { createSourceModule } = require("../common");

const atsKey = "brassring";
const baseModule = createSourceModule(atsKey);
const parserVersion = `${baseModule.parserVersion || "source-brassring-v1"}`;
const discover = createDiscover(baseModule.parserVersion);
const fetchList = createFetchList(discover);

function clean(value) {
  return String(value || "").trim();
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target?.config || {};
  const responseJson = rawPayload?.responseJson || rawPayload || {};
  const companyNameForPostings =
    clean(company.company_name || company.companyName || company.name || rawPayload?.companyName || config.boardCompanyName) ||
    `${clean(config.partnerId)}_${clean(config.siteId)}`;
  return parser.parseBrassringPostingsFromApi(companyNameForPostings, config, responseJson);
}

module.exports = {
  ...baseModule,
  ...parser,
  atsKey,
  key: atsKey,
  family: baseModule.family,
  status: baseModule.status,
  parserVersion,
  officialDocs: baseModule.officialDocs,
  discover,
  fetchList,
  parse,
  fetchDetail: async () => null
};
