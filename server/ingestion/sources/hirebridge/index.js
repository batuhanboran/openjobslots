const parser = require("./parse");
const { createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const { createSourceModule } = require("../common");

const atsKey = "hirebridge";
const baseModule = createSourceModule(atsKey);
const parserVersion = `${baseModule.parserVersion || "source-hirebridge-v1"}`;
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

function canonicalMapKey(value) {
  const input = clean(value);
  if (!input) return "";
  try {
    const parsed = new URL(input);
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return input.replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function lookupMapValue(mapValue, urlValue) {
  if (!mapValue || typeof mapValue !== "object") return "";
  const url = clean(urlValue);
  const canonical = canonicalMapKey(url);
  const candidates = [
    url,
    url.replace(/#.*$/, ""),
    canonical,
    `${canonical}/`
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(mapValue, candidate)) {
      return mapValue[candidate];
    }
  }

  return "";
}

function hasDetailEvidence(rawPayload) {
  return Boolean(
    rawPayload &&
      typeof rawPayload === "object" &&
      !Array.isArray(rawPayload) &&
      (
        Object.prototype.hasOwnProperty.call(rawPayload, "__detailHtmlByUrl") ||
        Object.prototype.hasOwnProperty.call(rawPayload, "__detailStatusByUrl") ||
        Object.prototype.hasOwnProperty.call(rawPayload, "__detailFailureByUrl")
      )
  );
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;

  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target?.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  const companyName =
    clean(company.company_name || company.companyName || company.name) ||
    (clean(config.cid) ? `hirebridge_${clean(config.cid)}` : atsKey);
  const postings = parser.parseHirebridgePostingsFromHtml(
    companyName,
    config,
    typeof payload === "string" ? payload : String(payload?.html || payload?.body || "")
  );

  const detailHtmlByUrl = rawPayload?.__detailHtmlByUrl || {};
  const detailStatusByUrl = rawPayload?.__detailStatusByUrl || {};
  const detailFailureByUrl = rawPayload?.__detailFailureByUrl || {};
  const listFinalUrl = clean(rawPayload?.__sourceFetchFinalUrl || config?.boardUrl || target?.list_url);

  if (!hasDetailEvidence(rawPayload)) {
    return postings;
  }

  const collected = [];
  const seenUrls = new Set();

  for (const posting of postings) {
    const postingUrl = clean(posting?.job_posting_url);
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    seenUrls.add(postingUrl);

    const detailHtml = lookupMapValue(detailHtmlByUrl, postingUrl);
    const postingDate = clean(parser.extractHirebridgeDatePostedFromDetailHtml(detailHtml));
    if (!postingDate) continue;

    const detailUrl = clean(parser.buildHirebridgeDetailsUrl(config, postingUrl) || postingUrl);
    const detailFetchStatus = Number(lookupMapValue(detailStatusByUrl, postingUrl) || 200);
    const detailFailureReason = clean(lookupMapValue(detailFailureByUrl, postingUrl));
    const sourceFailureReasons = Array.isArray(posting.source_failure_reasons)
      ? posting.source_failure_reasons.filter(Boolean)
      : [];
    if (detailFailureReason && !sourceFailureReasons.includes(detailFailureReason)) {
      sourceFailureReasons.push(detailFailureReason);
    }

    collected.push({
      ...posting,
      posting_date: postingDate,
      source_evidence: {
        ...(posting.source_evidence || {}),
        list_url: listFinalUrl,
        detail_url: detailUrl,
        detail_fetch_status: Number.isFinite(detailFetchStatus) ? detailFetchStatus : 200,
        posting_date_source: "labeled_detail_html",
        posting_date_path: "structured detail datePosted",
        posting_date_rule_name: "hirebridge_detail_dateposted"
      },
      source_failure_reasons: sourceFailureReasons
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
  fetchDetail: async () => null
};
