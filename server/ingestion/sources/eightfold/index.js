const { createSourceModule } = require("../common");
const parser = require("./parse");
const { clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const atsKey = "eightfold";
const baseModule = createSourceModule(atsKey);
const parserVersion = `${baseModule.parserVersion || "source-eightfold-v1"}`;
const discover = createDiscover(parserVersion);
const fetchList = createFetchList({ discover });

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
  const companyName =
    clean(rawPayload?.__companyNameForPostings) ||
    clean(company.company_name || company.companyName || company.name) ||
    (clean(config.host) ? `eightfold_${clean(config.host).split(".")[0]}` : atsKey);
  const rawPostings = parser.parseEightfoldPostingsFromApi(companyName, config, payload);
  const collected = [];
  const seenUrls = new Set();

  for (const posting of rawPostings) {
    const postingUrl = clean(posting?.job_posting_url);
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    if (!clean(posting?.posting_date)) continue;
    seenUrls.add(postingUrl);
    collected.push({
      ...posting,
      source_evidence: {
        ...(posting.source_evidence || {}),
        list_url: clean(rawPayload?.__sourceRequest?.boardUrl || config.boardUrl || target?.list_url),
        api_url: clean(rawPayload?.__sourceRequest?.apiUrl || config.apiUrl)
      }
    });
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
  discover,
  fetchList,
  parse,
  fetchDetail: async () => null
};
