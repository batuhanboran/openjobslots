const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const { hasUsefulGeoEvidence } = require("../../publicPostingGate");
const {
  asUrl,
  buildCompanyContext,
  classifyPublicRouteStatus,
  clean,
  hostSlug,
  makeSourceFetchError,
  normalizeCompanyName
} = require("./helpers");
const { parseBreezyPostingsFromHtml } = require("./parse");

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
    const sourceLabel = clean(options.sourceLabel || "Breezy");
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

function assertBreezyFinalUrl(finalUrl, fallbackUrl) {
  const finalValue = clean(finalUrl || fallbackUrl);
  const finalHost = String(asUrl(finalValue)?.hostname || "").toLowerCase();
  if (finalHost === "breezy.hr" || finalHost === "www.breezy.hr") {
    throw makeSourceFetchError("unexpected_redirect_host", `Breezy URL redirected to main page: ${finalValue}`, {
      url: finalValue
    });
  }
}

function breezyDetailKey(urlValue) {
  try {
    const parsed = new URL(clean(urlValue));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return clean(urlValue).replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function breezyJsonUrl(urlValue) {
  const parsed = asUrl(urlValue);
  if (!parsed) return "";
  parsed.pathname = "/json";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function hasExplicitSourceRemote(posting = {}) {
  return ["remote", "hybrid", "onsite"].includes(clean(posting.remote_type).toLowerCase());
}

function sourceFailureReasonSet(posting = {}) {
  return new Set(
    (Array.isArray(posting.source_failure_reasons) ? posting.source_failure_reasons : [])
      .map((reason) => clean(reason).toLowerCase())
      .filter(Boolean)
  );
}

function breezyPostingNeedsDetail(posting = {}) {
  const location = clean(posting.location || posting.location_text);
  const remoteType = clean(posting.remote_type).toLowerCase();
  const hasExplicitRemote = ["remote", "hybrid", "onsite"].includes(remoteType);
  const hasConcreteListLocation = Boolean(location) &&
    !/^(multiple|multiple locations|various|all locations|anywhere|global|remote|hybrid|tbd|to be determined)(?:\s|\(|$)/i.test(location);
  return !hasConcreteListLocation || !hasExplicitRemote || !clean(posting.posting_date);
}

function breezyDetailPriorityScore(posting = {}) {
  const reasons = sourceFailureReasonSet(posting);
  let score = breezyPostingNeedsDetail(posting) ? 100 : 0;
  if (!hasUsefulGeoEvidence(posting) && !hasExplicitSourceRemote(posting)) score += 40;
  if (reasons.has("no_structured_location") || reasons.has("detail_no_structured_location")) score += 30;
  if (reasons.has("ambiguous_location")) score += 25;
  if (reasons.has("no_explicit_remote_evidence") || reasons.has("detail_no_explicit_remote")) score += 15;
  if (!clean(posting.posting_date)) score += 5;
  return score;
}

function prioritizeBreezyDetailCandidates(postings = []) {
  return (Array.isArray(postings) ? postings : [])
    .map((posting, index) => ({
      posting,
      index,
      score: breezyDetailPriorityScore(posting)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.posting);
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = options.target && options.target.list_url ? options.target : discover(context);
    const listUrl = clean(discovered?.list_url || context.url_string);
    if (!listUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Breezy source has no public portal route", {
        url: context.url_string
      });
    }

    const list = await fetchText(listUrl, {
      ...options,
      target: discovered,
      sourceLabel: "Breezy"
    });
    assertBreezyFinalUrl(list.finalUrl || listUrl, listUrl);
    const finalUrl = list.finalUrl || listUrl;
    const finalParsed = asUrl(finalUrl);
    const config = {
      ...(discovered.config || {}),
      origin: finalParsed ? `${finalParsed.protocol}//${finalParsed.host}` : discovered.config?.origin || "",
      list_url: finalUrl
    };
    const companyName = normalizeCompanyName(context, config.subdomainLower || hostSlug(listUrl) || "Breezy");
    const parsed = parseBreezyPostingsFromHtml(companyName, config, {
      html: list.text,
      __listUrl: finalUrl
    });

    const jsonUrl = breezyJsonUrl(finalUrl);
    let jsonPayload = null;
    if (jsonUrl) {
      try {
        const jsonResponse = await fetchText(jsonUrl, {
          ...options,
          target: discovered,
          sourceLabel: "Breezy JSON",
          fetchOptions: {
            ...(options.fetchOptions || {}),
            headers: {
              accept: "application/json,text/plain;q=0.8,*/*;q=0.5",
              ...(options.fetchOptions?.headers || {})
            }
          }
        });
        jsonPayload = JSON.parse(jsonResponse.text);
      } catch {
        jsonPayload = null;
      }
    }

    const parsedWithJson = jsonPayload
      ? parseBreezyPostingsFromHtml(companyName, config, {
        html: list.text,
        __listUrl: finalUrl,
        __json: jsonPayload
      })
      : parsed;
    const sourceParsed = parsedWithJson.length > 0 ? parsedWithJson : parsed;

    if (sourceParsed.length === 0) {
      throw makeSourceFetchError("portal_search_empty", "Breezy public portal returned no parseable postings", {
        url: listUrl
      });
    }

    const detailLimit = Math.max(0, Math.min(75, Number(process.env.OPENJOBSLOTS_BREEZY_DETAIL_FETCH_LIMIT_PER_COMPANY || 20)));
    let detailFetches = 0;
    const detailHtmlByUrl = {};
    const detailStatusByUrl = {};
    const detailFailureByUrl = {};

    for (const posting of prioritizeBreezyDetailCandidates(sourceParsed)) {
      if (detailFetches >= detailLimit) break;
      if (!breezyPostingNeedsDetail(posting)) continue;
      const detailUrl = clean(posting.job_posting_url);
      if (!detailUrl) continue;
      try {
        const detail = await fetchText(detailUrl, {
          ...options,
          target: discovered,
          sourceLabel: "Breezy"
        });
        detailFetches += 1;
        const key = breezyDetailKey(detailUrl);
        detailHtmlByUrl[detailUrl] = detail.text;
        detailHtmlByUrl[key] = detail.text;
        detailStatusByUrl[detailUrl] = detail.status;
        detailStatusByUrl[key] = detail.status;
      } catch (error) {
        detailFetches += 1;
        const key = breezyDetailKey(detailUrl);
        detailFailureByUrl[detailUrl] = classifyPublicRouteStatus(Number(error?.status || 0), "unsupported_html_shape");
        detailFailureByUrl[key] = detailFailureByUrl[detailUrl];
      }
    }

    return {
      html: list.text,
      __listUrl: finalUrl,
      __json: jsonPayload,
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
  breezyPostingNeedsDetail,
  createFetchList
};
