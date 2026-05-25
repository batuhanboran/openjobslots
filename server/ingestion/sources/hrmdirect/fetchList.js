const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const {
  asUrl,
  buildCompanyContext,
  classifyPublicRouteStatus,
  clean,
  hostSlug,
  makeSourceFetchError,
  normalizeCompanyName
} = require("./helpers");
const { normalizeHrmDirectListUrl } = require("./discover");
const { extractHrmDirectDetailFields, parseHrmDirectPostingsFromHtml } = require("./parse");

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
      accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.8,*/*;q=0.5",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(fetchOptions.headers || {})
    }
  });
  if (!response.ok) {
    const code = classifyPublicRouteStatus(response.status, "fetch_failed");
    const sourceLabel = clean(options.sourceLabel || "HRMDirect");
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

function hrmDirectDetailKey(urlValue) {
  try {
    const parsed = new URL(clean(urlValue));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return clean(urlValue).replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function hrmDirectDetailFetchUrl(urlValue) {
  const parsed = asUrl(urlValue);
  if (!parsed) return clean(urlValue);
  const host = String(parsed.hostname || "").toLowerCase();
  if (host.endsWith(".hrmdirect.com") && /\/employment\/job-opening\.php$/i.test(parsed.pathname)) {
    const req = clean(parsed.searchParams.get("req"));
    if (req) {
      const reqOnly = new URL(`${parsed.origin}${parsed.pathname}`);
      reqOnly.searchParams.set("req", req);
      return reqOnly.toString();
    }
  }
  parsed.hash = "";
  return parsed.toString();
}

function hrmDirectReqIdFromPostingUrl(urlValue) {
  const parsed = asUrl(urlValue);
  if (!parsed) return "";
  return clean(parsed.searchParams.get("req"));
}

function hrmDirectDetailHasUsefulEvidence(detailHtml) {
  const fields = extractHrmDirectDetailFields(detailHtml);
  return Boolean(clean(fields.location) || ["remote", "hybrid"].includes(clean(fields.remote_type).toLowerCase()));
}

function hrmDirectRssUrl(urlValue) {
  const parsed = asUrl(urlValue);
  if (!parsed) return "";
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".hrmdirect.com")) return "";
  if (!/\/employment\/(?:job-openings|openings)\.php$/i.test(parsed.pathname)) return "";
  parsed.pathname = parsed.pathname.replace(/(?:job-openings|openings)\.php$/i, "rss.php");
  if (!parsed.searchParams.has("search")) parsed.searchParams.set("search", "true");
  parsed.hash = "";
  return parsed.toString();
}

function hrmDirectPostingNeedsDetail(posting = {}) {
  const location = clean(posting.location || posting.location_text);
  const remoteType = clean(posting.remote_type).toLowerCase();
  const hasExplicitRemote = ["remote", "hybrid"].includes(remoteType) ||
    /\b(remote|hybrid|work from home|wfh|telework|virtual)\b/i.test(location);
  const hasConcreteListLocation = Boolean(location) &&
    !/^(multiple|multiple locations|various|all locations|anywhere|global|remote|hybrid|tbd|to be determined)(?:\s|\(|$)/i.test(location);
  return !hasConcreteListLocation && !hasExplicitRemote;
}

function hrmDirectDetailLimit(parsedCount, needsDetailCount = parsedCount) {
  const envValue = process.env.OPENJOBSLOTS_HRMDIRECT_DETAIL_FETCH_LIMIT_PER_COMPANY;
  if (envValue !== undefined) {
    const configured = Number(envValue);
    return Math.max(0, Math.min(200, Number.isFinite(configured) ? configured : 10));
  }
  const count = Math.max(0, Number(parsedCount) || 0);
  const needed = Math.max(0, Math.min(count, Number(needsDetailCount) || 0));
  if (needed === 0) return 0;
  const sparseRatio = count > 0 ? needed / count : 0;
  if (count <= 250 && sparseRatio >= 0.5) return Math.min(200, needed);
  if (count <= 120 && sparseRatio >= 0.25) return Math.min(120, needed);
  return Math.min(35, Math.max(10, needed));
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = options.target && options.target.list_url ? options.target : discover(context);
    const listUrl = normalizeHrmDirectListUrl(discovered?.list_url || context.url_string);
    if (!listUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "HRMDirect source has no public job-openings route", {
        url: context.url_string
      });
    }

    const list = await fetchText(listUrl, {
      ...options,
      target: discovered,
      sourceLabel: "HRMDirect"
    });
    const config = {
      ...(discovered.config || {}),
      baseOrigin: asUrl(list.finalUrl || listUrl)?.origin || discovered.config?.baseOrigin || "",
      list_url: list.finalUrl || listUrl,
      jobsUrl: list.finalUrl || listUrl
    };
    const companyName = normalizeCompanyName(context, config.subdomainLower || hostSlug(listUrl) || "HRMDirect");
    const parsed = parseHrmDirectPostingsFromHtml(companyName, config, {
      html: list.text,
      __listUrl: list.finalUrl || listUrl
    });

    if (parsed.length === 0) {
      throw makeSourceFetchError("portal_search_empty", "HRMDirect public job-openings table returned no parseable postings", {
        url: listUrl
      });
    }

    const detailCandidates = parsed.filter((posting) => hrmDirectPostingNeedsDetail(posting));
    const detailLimit = hrmDirectDetailLimit(parsed.length, detailCandidates.length);
    const reqIdCounts = new Map();
    for (const posting of parsed) {
      const reqId = hrmDirectReqIdFromPostingUrl(posting.job_posting_url);
      if (!reqId) continue;
      reqIdCounts.set(reqId, (reqIdCounts.get(reqId) || 0) + 1);
    }

    let detailCandidatesProcessed = 0;
    let detailFetches = 0;
    const detailHtmlByUrl = {};
    const detailStatusByUrl = {};
    const detailFailureByUrl = {};
    const rssUrl = hrmDirectRssUrl(list.finalUrl || listUrl);
    let rssXml = "";
    let rssStatus = 0;
    let rssFailure = "";

    if (rssUrl) {
      try {
        const rss = await fetchText(rssUrl, {
          ...options,
          target: discovered,
          sourceLabel: "HRMDirect RSS",
          fetchOptions: {
            ...(options.fetchOptions || {}),
            headers: {
              accept: "application/rss+xml,text/xml,application/xml;q=0.8,text/html;q=0.5,*/*;q=0.3",
              ...(options.fetchOptions?.headers || {})
            }
          }
        });
        rssStatus = Number(rss.status || 0);
        if (rssStatus >= 200 && rssStatus < 300) {
          rssXml = rss.text;
        } else {
          rssFailure = classifyPublicRouteStatus(rssStatus, "rss_unavailable");
        }
      } catch (error) {
        rssStatus = Number(error?.status || 0);
        rssFailure = classifyPublicRouteStatus(rssStatus, "rss_unavailable");
      }
    }

    for (const posting of detailCandidates) {
      if (detailCandidatesProcessed >= detailLimit) break;
      detailCandidatesProcessed += 1;
      const detailUrl = clean(posting.job_posting_url);
      if (!detailUrl) continue;
      const reqOnlyFetchUrl = hrmDirectDetailFetchUrl(detailUrl);
      const reqId = hrmDirectReqIdFromPostingUrl(detailUrl);
      const hasDuplicateReq = reqId && (reqIdCounts.get(reqId) || 0) > 1;
      const primaryFetchUrl = hasDuplicateReq ? detailUrl : reqOnlyFetchUrl;
      const fallbackFetchUrl = hasDuplicateReq ? reqOnlyFetchUrl : "";
      let selectedDetail = null;
      let selectedFetchUrl = "";
      let detailFailure = "";

      try {
        const detail = await fetchText(primaryFetchUrl, {
          ...options,
          target: discovered,
          sourceLabel: "HRMDirect"
        });
        detailFetches += 1;
        selectedDetail = detail;
        selectedFetchUrl = primaryFetchUrl;
        if (
          fallbackFetchUrl &&
          fallbackFetchUrl !== primaryFetchUrl &&
          !hrmDirectDetailHasUsefulEvidence(detail.text)
        ) {
          const fallbackDetail = await fetchText(fallbackFetchUrl, {
            ...options,
            target: discovered,
            sourceLabel: "HRMDirect"
          });
          detailFetches += 1;
          if (hrmDirectDetailHasUsefulEvidence(fallbackDetail.text)) {
            selectedDetail = fallbackDetail;
            selectedFetchUrl = fallbackFetchUrl;
          }
        }
      } catch (error) {
        detailFetches += 1;
        detailFailure = classifyPublicRouteStatus(Number(error?.status || 0), "unsupported_html_shape");
        if (fallbackFetchUrl && fallbackFetchUrl !== primaryFetchUrl) {
          try {
            const fallbackDetail = await fetchText(fallbackFetchUrl, {
              ...options,
              target: discovered,
              sourceLabel: "HRMDirect"
            });
            detailFetches += 1;
            selectedDetail = fallbackDetail;
            selectedFetchUrl = fallbackFetchUrl;
            detailFailure = "";
          } catch (fallbackError) {
            detailFetches += 1;
            detailFailure = classifyPublicRouteStatus(Number(fallbackError?.status || error?.status || 0), "unsupported_html_shape");
          }
        }
      }

      const detailKey = hrmDirectDetailKey(detailUrl);
      const reqOnlyKey = hrmDirectDetailKey(reqOnlyFetchUrl);
      const selectedKey = hrmDirectDetailKey(selectedFetchUrl);
      if (selectedDetail) {
        for (const key of [detailUrl, detailKey, reqOnlyFetchUrl, reqOnlyKey, selectedFetchUrl, selectedKey].filter(Boolean)) {
          detailHtmlByUrl[key] = selectedDetail.text;
          detailStatusByUrl[key] = selectedDetail.status;
        }
      } else {
        const failure = detailFailure || "unsupported_html_shape";
        for (const key of [detailUrl, detailKey, reqOnlyFetchUrl, reqOnlyKey, primaryFetchUrl, fallbackFetchUrl].filter(Boolean)) {
          detailFailureByUrl[key] = failure;
        }
      }
    }

    return {
      html: list.text,
      __listUrl: list.finalUrl || listUrl,
      __rssUrl: rssUrl,
      __rssXml: rssXml,
      __rssStatus: rssStatus,
      __rssFailure: rssFailure,
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
  createFetchList,
  hrmDirectDetailLimit
};
