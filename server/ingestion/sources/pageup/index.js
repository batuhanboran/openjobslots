const { createSourceModule } = require("../common");
const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const atsKey = "pageup";
const baseModule = createSourceModule(atsKey);
const parserVersion = `${baseModule.parserVersion || "source-pageup-v1"}`;
const discover = createDiscover(parserVersion);
const fetchList = createFetchList({ discover });
const payloadShapePolicy = Object.freeze({
  optional_enrichment_prefixes: Object.freeze([
    "__detailPostingDateByUrl",
    "__detailFailureByUrl"
  ])
});

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
  const companyName =
    clean(rawPayload?.__companyNameForPostings) ||
    clean(company.company_name || company.companyName || company.name) ||
    (clean(config.boardId) ? `pageup_${clean(config.boardId).toLowerCase()}` : atsKey);
  const postings = parser.parsePageupPostingsFromResults(companyName, config, payload?.html || payload);
  const detailDates = rawPayload?.__detailPostingDateByUrl;
  if (!detailDates || typeof detailDates !== "object") return postings;

  const collected = [];
  const seenUrls = new Set();
  for (const posting of postings) {
    const postingUrl = clean(posting?.job_posting_url);
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    const postingDate = clean(detailDates[postingUrl]);
    if (!postingDate) continue;
    seenUrls.add(postingUrl);
    collected.push({
      ...posting,
      posting_date: postingDate,
      source_evidence: {
        ...(posting.source_evidence || {}),
        list_url: clean(rawPayload?.__sourceFetchFinalUrl || config?.boardUrl || target?.list_url),
        search_url: clean(rawPayload?.__sourceSearchFinalUrl || config?.searchUrl),
        detail_url: postingUrl,
        posting_date_source: "labeled_detail_html",
        posting_date_rule_name: "pageup_detail_posting_date"
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
  officialDocs: baseModule.officialDocs,
  discover,
  fetchList,
  parse,
  payloadShapePolicy,
  fetchDetail: async () => null
};
