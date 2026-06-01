const { createSourceModule } = require("../common");
const parser = require("./parse");
const { clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const baseModule = createSourceModule("loxo");
const discover = createDiscover();
const fetchList = createFetchList({ discover });

function normalizeCompanyName(company = {}, fallback = "loxo") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return rawPayload;
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;

  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  const html = typeof payload === "string" ? payload : String(payload?.html || payload?.body || "");
  const companyName = normalizeCompanyName(company, config.companySlugLower || "loxo");
  const detailHtmlByUrl = rawPayload?.__detailHtmlByUrl || rawPayload?.detailHtmlByUrl || {};
  const postings = parser.parseLoxoPostingsFromHtml(companyName, config, html, { detailHtmlByUrl });
  const listUrl = clean(rawPayload?.__sourceFetchFinalUrl || config.boardUrl || target.list_url);

  return postings.map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: listUrl,
      route_kind: posting.source_evidence?.route_kind || "loxo_public_list"
    }
  }));
}

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse
};
