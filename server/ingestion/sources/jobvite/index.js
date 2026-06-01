const { createSourceModule } = require("../common");
const parser = require("./parse");
const { clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const baseModule = createSourceModule("jobvite");
const discover = createDiscover();
const fetchList = createFetchList({ discover });

function normalizeCompanyName(company = {}, fallback = "jobvite") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function parse(rawPayload, company = {}) {
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const companyName = normalizeCompanyName(company, config.companySlugLower || "jobvite");
  return parser.parseJobvitePostingsFromHtml(companyName, config, rawPayload);
}

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse
};
