const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const { hasUsefulGeoEvidence } = require("../../publicPostingGate");
const {
  buildCompanyContext,
  classifyPublicRouteStatus,
  clean,
  hostSlug,
  makeSourceFetchError,
  normalizeCompanyName
} = require("./helpers");
const { parseApplyToJobPostingsFromHtml } = require("./parse");

async function fetchText(url, options = {}) {
  if (options.fetcher) {
    const response = await options.fetcher(url, options.target || {});
    if (typeof response === "string") return { text: response, finalUrl: url, status: 200 };
    if (response && typeof response === "object") {
      if (typeof response.text === "function") {
        return {
          text: await response.text(),
          finalUrl: response.url || url,
          status: Number(response.status || 200)
        };
      }
      if (typeof response.html === "string" || typeof response.body === "string") {
        return {
          text: String(response.html || response.body || ""),
          finalUrl: response.url || url,
          status: Number(response.status || 200)
        };
      }
    }
    return { text: String(response || ""), finalUrl: url, status: 200 };
  }

  const fetchOptions = options.fetchOptions || {};
  const response = await safeFetch(url, {
    ...fetchOptions,
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.5",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(fetchOptions.headers || {})
    }
  });
  if (!response.ok) {
    const code = classifyPublicRouteStatus(response.status, "fetch_failed");
    const sourceLabel = clean(options.sourceLabel || "ApplyToJob");
    throw makeSourceFetchError(code, `${sourceLabel} public route failed with HTTP ${response.status}`, {
      status: response.status,
      url
    });
  }
  return {
    text: await readLimitedResponseText(response, { sourceUrl: response.url || url }),
    finalUrl: response.url || url,
    status: response.status
  };
}

function applyToJobDetailKey(urlValue) {
  try {
    const parsed = new URL(clean(urlValue));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return clean(urlValue).replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function hasExplicitSourceRemote(posting = {}) {
  return ["remote", "hybrid", "onsite"].includes(clean(posting.remote_type).toLowerCase());
}

function sourceFailureReasonSet(posting = {}) {
  const reasons = new Set();
  const rawReasons = posting?.source_evidence?.source_failure_reasons || posting?.source_failure_reasons || [];
  for (const reason of Array.isArray(rawReasons) ? rawReasons : [rawReasons]) {
    const normalized = clean(reason).toLowerCase();
    if (normalized) reasons.add(normalized);
  }
  return reasons;
}

function applyToJobPostingNeedsDetail(posting = {}) {
  const reasons = sourceFailureReasonSet(posting);
  if (
    reasons.has("no_structured_location") ||
    reasons.has("detail_no_structured_location") ||
    reasons.has("no_explicit_remote_evidence") ||
    reasons.has("detail_no_explicit_remote") ||
    reasons.has("ambiguous_location") ||
    reasons.has("no_normalized_geo_or_explicit_remote")
  ) {
    return true;
  }
  if (!hasUsefulGeoEvidence(posting) && !hasExplicitSourceRemote(posting)) return true;
  return !clean(posting.posting_date);
}

function applyToJobDetailPriorityScore(posting = {}) {
  const reasons = sourceFailureReasonSet(posting);
  let score = applyToJobPostingNeedsDetail(posting) ? 100 : 0;
  if (!hasUsefulGeoEvidence(posting) && !hasExplicitSourceRemote(posting)) score += 40;
  if (reasons.has("no_structured_location") || reasons.has("detail_no_structured_location")) score += 30;
  if (reasons.has("ambiguous_location")) score += 25;
  if (reasons.has("no_explicit_remote_evidence") || reasons.has("detail_no_explicit_remote")) score += 15;
  if (!clean(posting.posting_date)) score += 5;
  return score;
}

function prioritizeApplyToJobDetailCandidates(postings = []) {
  return (Array.isArray(postings) ? postings : [])
    .map((posting, index) => ({
      posting,
      index,
      score: applyToJobDetailPriorityScore(posting)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.posting);
}

function resolveApplyToJobDetailFetchLimit(options = {}) {
  const raw = options.maxApplyToJobDetailPages ??
    options.detailFetchLimit ??
    process.env.OPENJOBSLOTS_APPLYTOJOB_DETAIL_FETCH_LIMIT_PER_COMPANY ??
    15;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 15;
  return Math.max(0, Math.min(50, Math.floor(parsed)));
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = options.target && options.target.list_url ? options.target : discover(context);
    const listUrl = clean(discovered?.list_url || context.url_string);
    if (!listUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "ApplyToJob source has no public list route", {
        url: context.url_string
      });
    }

    const list = await fetchText(listUrl, {
      ...options,
      target: discovered,
      sourceLabel: "ApplyToJob"
    });
    const config = {
      ...(discovered.config || {}),
      list_url: list.finalUrl || listUrl
    };
    const companyName = normalizeCompanyName(context, config.subdomainLower || hostSlug(listUrl) || "ApplyToJob");
    const parsed = parseApplyToJobPostingsFromHtml(companyName, config, {
      html: list.text,
      __listUrl: list.finalUrl || listUrl
    });

    if (parsed.length === 0) {
      throw makeSourceFetchError("portal_search_empty", "ApplyToJob public list returned no parseable postings", {
        url: listUrl
      });
    }

    const detailLimit = resolveApplyToJobDetailFetchLimit(options);
    let detailFetches = 0;
    const detailHtmlByUrl = {};
    const detailStatusByUrl = {};
    const detailFailureByUrl = {};

    for (const posting of prioritizeApplyToJobDetailCandidates(parsed)) {
      if (detailFetches >= detailLimit) break;
      if (!applyToJobPostingNeedsDetail(posting)) continue;
      const detailUrl = clean(posting.job_posting_url);
      if (!detailUrl) continue;
      try {
        const detail = await fetchText(detailUrl, {
          ...options,
          target: discovered,
          sourceLabel: "ApplyToJob"
        });
        detailFetches += 1;
        const key = applyToJobDetailKey(detailUrl);
        detailHtmlByUrl[detailUrl] = detail.text;
        detailHtmlByUrl[key] = detail.text;
        detailStatusByUrl[detailUrl] = detail.status;
        detailStatusByUrl[key] = detail.status;
      } catch (error) {
        detailFetches += 1;
        const key = applyToJobDetailKey(detailUrl);
        detailFailureByUrl[detailUrl] = classifyPublicRouteStatus(Number(error?.status || 0), "unsupported_html_shape");
        detailFailureByUrl[key] = detailFailureByUrl[detailUrl];
      }
    }

    return {
      html: list.text,
      __listUrl: list.finalUrl || listUrl,
      __detailHtmlByUrl: detailHtmlByUrl,
      __detailStatusByUrl: detailStatusByUrl,
      __detailFailureByUrl: detailFailureByUrl,
      __sourceConfig: {
        ...config,
        detail_fetch_count: detailFetches
      }
    };
  };
}

module.exports = {
  applyToJobPostingNeedsDetail,
  createFetchList,
  resolveApplyToJobDetailFetchLimit
};
