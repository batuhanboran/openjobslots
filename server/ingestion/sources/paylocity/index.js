const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const { createSourceModule } = require("../common");

const atsKey = "paylocity";
const baseModule = createSourceModule(atsKey);
const parserVersion = `${baseModule.parserVersion || "source-paylocity-v1"}`;
const discover = createDiscover(baseModule.parserVersion);
const fetchList = createFetchList({ discover });

function clean(value) {
  return String(value || "").trim();
}

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return rawPayload || {};
  }
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target?.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  const companyName = clean(company.company_name || company.companyName || company.name || config.companyId || atsKey);
  const postings = parser.parsePaylocityPostingsFromPageData(companyName, config, payload);
  const seenUrls = new Set();
  const collected = [];

  for (const posting of postings) {
    const postingUrl = clean(posting?.job_posting_url);
    if (!postingUrl) continue;
    if (seenUrls.has(postingUrl)) continue;
    if (!clean(posting?.posting_date)) continue;
    seenUrls.add(postingUrl);
    collected.push(posting);
  }

  return collected;
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
