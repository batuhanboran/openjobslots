const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const {
  extractIcimsLocationFromHtml,
  extractIcimsPostingDateFromHtml,
  extractIcimsRemoteTypeFromHtml,
  parseIcimsPostingsFromHtml
} = require("./parse");
const {
  buildCompanyContext,
  clean,
  ICIMS_SOURCE_FAMILY,
  parseIcimsPublicCompany
} = require("./discover");

const ICIMS_RATE_LIMIT_WAIT_MS = 60 * 1000;

function normalizeInteger(value, fallback, minValue, maxValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.max(minValue, Math.min(maxValue, Math.floor(parsed)));
  return clamped;
}

function makeSourceFetchError(code, message, details = {}) {
  const error = new Error(message || code);
  error.ingestionErrorType = code;
  if (details.status) error.status = details.status;
  if (details.url) error.url = details.url;
  return error;
}

function responseStatus(payload) {
  const rawStatus = Number(payload?.status || payload?.statusCode);
  if (Number.isFinite(rawStatus)) return rawStatus;
  if (payload?.ok === false) return 500;
  return 200;
}

function payloadToText(payload) {
  if (typeof payload === "string") return Promise.resolve(payload);
  if (!payload || typeof payload !== "object") return Promise.resolve("");

  if (typeof payload.text === "function") return payload.text();
  if (typeof payload.text === "string") return Promise.resolve(payload.text);
  if (typeof payload.body === "string") return Promise.resolve(payload.body);
  if (typeof payload.html === "string") return Promise.resolve(payload.html);
  return Promise.resolve("");
}

function classifyPublicRouteStatus(status, fallbackCode = "unsupported_tenant_shape") {
  const value = Number(status || 0);
  if (value === 404 || value === 410) return "detail_404_or_410";
  if (value === 401 || value === 403 || value === 429) return "blocked_or_rate_limited";
  return fallbackCode;
}

function parseUrl(value) {
  try {
    return new URL(clean(value));
  } catch {
    return null;
  }
}

function ensureIcimsIframeUrl(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return clean(urlString);
  parsed.searchParams.set("in_iframe", "1");
  return parsed.toString();
}

function normalizeAndResolveUrl(rawValue, baseUrl) {
  const value = clean(rawValue);
  const base = clean(baseUrl);
  if (!value) return "";

  const decoded = value.replace(/&amp;/g, "&").replace(/\\\//g, "/");
  if (/^\/\//.test(decoded)) {
    const baseParsed = parseUrl(base);
    return `${baseParsed?.protocol || "https:"}${decoded}`;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(decoded)) {
    if (!base) return "";
    try {
      return new URL(decoded, base).toString();
    } catch {
      return "";
    }
  }
  return decoded;
}

function normalizeIframeCandidate(rawValue, baseUrl, fallbackHostUrl) {
  const normalized = normalizeAndResolveUrl(rawValue, baseUrl);
  return ensureIcimsIframeUrl(normalized || fallbackHostUrl);
}

function extractIcimsIframeUrlFromHtml(pageHtml, baseUrl, fallbackUrl = "") {
  const source = String(pageHtml || "");
  const patterns = [
    /icimsFrame\.src\s*=\s*'([^']+)'/i,
    /icimsFrame\.src\s*=\s*"([^"]+)"/i,
    /<iframe[^>]*id=["']icims_content_iframe["'][^>]*src=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      return normalizeIframeCandidate(match[1], baseUrl, fallbackUrl);
    }
  }
  return ensureIcimsIframeUrl(fallbackUrl);
}

function isAllowedIcimsHost(candidateUrl, routeHost) {
  const parsed = parseUrl(candidateUrl);
  if (!parsed) return false;
  const host = String(parsed.hostname || "").toLowerCase();
  const allowedHost = clean(routeHost).toLowerCase();
  if (!host.endsWith(".icims.com")) return false;
  if (!allowedHost) return false;
  return host === allowedHost || host.endsWith(`.${allowedHost}`);
}

function assertIcimsHost(candidateUrl, fallbackUrl, stageLabel, routeHost) {
  if (isAllowedIcimsHost(candidateUrl, routeHost)) return;
  const safeTarget = clean(candidateUrl || fallbackUrl);
  throw makeSourceFetchError(
    "unexpected_redirect_host",
    `${stageLabel} redirected to unexpected host: ${safeTarget}`,
    { url: safeTarget }
  );
}

function extractIcimsNextPageUrlFromHtml(pageHtml, currentUrl, routeHost) {
  const source = String(pageHtml || "");
  const patterns = [
    /<link[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']next["'][^>]*>/i,
    /<a[^>]*(?:aria-label|title)=["']next["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<a[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?\bnext\b[\s\S]*?<\/a>/i
  ];
  const current = parseUrl(currentUrl);
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const rawValue = clean(match?.[1]);
    if (!rawValue) continue;
    const candidate = normalizeAndResolveUrl(rawValue, currentUrl);
    if (!candidate) continue;
    const candidateParsed = parseUrl(candidate);
    const currentHost = String(current?.hostname || "").toLowerCase();
    const candidateHost = String(candidateParsed?.hostname || "").toLowerCase();
    if (!candidateHost || candidateHost !== currentHost) continue;
    const withFrame = ensureIcimsIframeUrl(candidate);
    if (withFrame === clean(currentUrl)) continue;
    if (!isAllowedIcimsHost(withFrame, routeHost)) continue;
    return withFrame;
  }
  return "";
}

function icimsDetailUrl(urlString, routeHost) {
  const parsed = parseUrl(urlString);
  if (!parsed || !isAllowedIcimsHost(urlString, routeHost)) return "";
  return ensureIcimsIframeUrl(parsed.toString());
}

function hasIcimsPublicPostingEvidence(posting = {}) {
  return Boolean(clean(posting.location) || clean(posting.location_text) || clean(posting.remote_type));
}

function icimsDetailEvidenceKind(detailHtml, field) {
  const source = String(detailHtml || "");
  if (field === "location" && /application\/ld\+json/i.test(source) && /jobLocation/i.test(source)) {
    return "json_ld_joblocation";
  }
  if (field === "date" && /application\/ld\+json/i.test(source) && /datePosted/i.test(source)) {
    return "json_ld_dateposted";
  }
  if (field === "remote" && /data-(?:field|label)=["'](?:remote|workplace-type|location-type)["']/i.test(source)) {
    return "data_label_remote";
  }
  return `labeled_detail_${field}`;
}

function responseToText(payload) {
  return typeof payload?.text === "function" ? payload.text() : payloadToText(payload);
}

async function fetchText(url, target, options = {}) {
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      const text = await payloadToText(payload);
      throw makeSourceFetchError(
        classifyPublicRouteStatus(status),
        `iCIMS request failed with HTTP ${status}: ${String(text).slice(0, 180)}`,
        { status, url }
      );
    }
    return {
      text: await responseToText(payload),
      finalUrl: clean(payload?.url || payload?.__sourceFetchFinalUrl || url),
      status
    };
  }

  const response = await safeFetch(url, {
    ...target?.fetchOptions,
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/json;q=0.7,*/*;q=0.5",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(target?.fetchOptions?.headers || {})
    }
  }, options.fetchOptions || {});
  if (!response.ok) {
    const text = await readLimitedResponseText(response, { sourceUrl: response.url || url });
    throw makeSourceFetchError(
      classifyPublicRouteStatus(response.status),
      `iCIMS request failed with HTTP ${response.status}: ${String(text).slice(0, 180)}`,
      { status: response.status, url }
    );
  }
  return {
    text: await readLimitedResponseText(response, { sourceUrl: response.url || url }),
    finalUrl: clean(response.url || url),
    status: response.status
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : () => {
    throw new Error("iCIMS discover function is required");
  };

  return async function fetchIcimsSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const route = parseIcimsPublicCompany(discovered.list_url || context.url_string);
    if (!route || !route.searchUrl) {
      throw makeSourceFetchError("no_public_portal_route", "iCIMS source has no public *.icims.com portal route", {
        url: context.url_string
      });
    }

    const companyName = clean(context.company_name || route.tenant);
    const wrapperTarget = {
      ...(options.target || {}),
      method: "GET",
      source_family: ICIMS_SOURCE_FAMILY,
      source_key: "icims"
    };
    const wrapper = await fetchText(route.searchUrl, wrapperTarget, options);
    const wrapperFinalUrl = clean(wrapper.finalUrl);
    assertIcimsHost(wrapperFinalUrl, route.searchUrl, "iCIMS list URL", route.host);

    const firstPageUrl = extractIcimsIframeUrlFromHtml(wrapper.text, wrapperFinalUrl, route.searchUrl);
    const maxPages = normalizeInteger(
      process.env.OPENJOBSLOTS_ICIMS_SOURCE_MAX_PAGES,
      2,
      1,
      5
    );
    const postings = [];
    const seenPageUrls = new Set();
    const seenPostingUrls = new Set();
    const pages = [];

    let pageUrl = ensureIcimsIframeUrl(firstPageUrl);
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const normalizedPageUrl = ensureIcimsIframeUrl(pageUrl);
      if (!normalizedPageUrl || seenPageUrls.has(normalizedPageUrl)) break;
      seenPageUrls.add(normalizedPageUrl);

      let pageText = "";
      let pageFinalUrl = normalizedPageUrl;
      const listTarget = {
        ...(options.target || {}),
        method: "GET",
        source_family: ICIMS_SOURCE_FAMILY,
        source_key: "icims"
      };
      if (pageIndex > 0 || normalizedPageUrl !== wrapperFinalUrl) {
        const page = await fetchText(normalizedPageUrl, listTarget, options);
        pageText = page.text;
        pageFinalUrl = clean(page.finalUrl);
        assertIcimsHost(pageFinalUrl, normalizedPageUrl, "iCIMS page URL", route.host);
      } else {
        pageText = wrapper.text;
        pageFinalUrl = wrapperFinalUrl;
      }
      pages.push({ url: normalizedPageUrl, html: pageText });

      for (const posting of parseIcimsPostingsFromHtml(companyName, route, pageText)) {
        const postingUrl = clean(posting?.job_posting_url);
        if (!postingUrl || seenPostingUrls.has(postingUrl)) continue;
        seenPostingUrls.add(postingUrl);
        postings.push({
          ...posting,
          source_evidence: {
            ...(posting.source_evidence || {}),
            list_url: normalizedPageUrl,
            route_kind: "icims_public_iframe_list"
          }
        });
      }

      const nextPageUrl = extractIcimsNextPageUrlFromHtml(pageText, pageFinalUrl || normalizedPageUrl, route.host);
      if (!nextPageUrl) break;
      pageUrl = nextPageUrl;
    }

    if (postings.length === 0) {
      throw makeSourceFetchError("portal_search_empty", "iCIMS public portal search returned no parseable jobs", {
        url: route.searchUrl
      });
    }

    const detailLimit = normalizeInteger(
      process.env.OPENJOBSLOTS_ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY,
      20,
      0,
      100
    );
    let detailFetchCount = 0;
    const enriched = [];
    for (const posting of postings) {
      let enrichedPosting = posting;
      const needsDetail =
        detailFetchCount < detailLimit &&
        (!clean(posting.location) || !clean(posting.posting_date) || !clean(posting.remote_type));

      if (needsDetail) {
        const detailUrl = icimsDetailUrl(posting.job_posting_url, route.host);
        if (!detailUrl) {
          enrichedPosting = {
            ...posting,
            source_failure_reasons: ["no_public_portal_route"]
          };
        } else {
          try {
            const detailTarget = {
              ...(options.target || {}),
              method: "GET",
              source_family: ICIMS_SOURCE_FAMILY,
              source_key: "icims"
            };
            const detail = await fetchText(detailUrl, detailTarget, options);
            detailFetchCount += 1;
            assertIcimsHost(detail.finalUrl, detailUrl, "iCIMS detail URL", route.host);
            const detailLocation = extractIcimsLocationFromHtml(detail.text);
            const detailRemoteType = extractIcimsRemoteTypeFromHtml(detail.text);
            const detailPostingDate = extractIcimsPostingDateFromHtml(detail.text);
            enrichedPosting = {
              ...posting,
              location: clean(posting.location) || detailLocation || null,
              remote_type: clean(posting.remote_type) || detailRemoteType || null,
              posting_date: clean(posting.posting_date) || detailPostingDate || null,
              source_evidence: {
                ...(posting.source_evidence || {}),
                detail_url: detailUrl,
                detail_fetch_status: detail.status,
                location_source: detailLocation ? icimsDetailEvidenceKind(detail.text, "location") : "",
                remote_source: detailRemoteType ? icimsDetailEvidenceKind(detail.text, "remote") : "",
                posting_date_source: detailPostingDate ? icimsDetailEvidenceKind(detail.text, "date") : ""
              }
            };
          } catch (error) {
            detailFetchCount += 1;
            const statusCode = Number(error?.status || 0);
            enrichedPosting = {
              ...posting,
              source_failure_reasons: Array.from(new Set([
                ...(Array.isArray(posting.source_failure_reasons) ? posting.source_failure_reasons : []),
                classifyPublicRouteStatus(statusCode, "unsupported_tenant_shape")
              ]))
            };
          }
        }
      }

      if (!hasIcimsPublicPostingEvidence(enrichedPosting)) {
        enrichedPosting = {
          ...enrichedPosting,
          source_failure_reasons: Array.from(new Set([
            ...(Array.isArray(enrichedPosting.source_failure_reasons) ? enrichedPosting.source_failure_reasons : []),
            "no_structured_location",
            "no_explicit_remote_evidence"
          ]))
        };
      }

      enriched.push(enrichedPosting);
    }

    return {
      __legacyParsed: enriched,
      __sourceConfig: {
        ...route,
        list_pages_fetched: pages.length,
        detail_fetch_count: detailFetchCount
      },
      __sourceFetchFinalUrl: pages.length > 0 ? pages[0].url : route.searchUrl,
      __sourceRequest: {
        rateLimitMs: ICIMS_RATE_LIMIT_WAIT_MS,
        searchUrl: route.searchUrl,
        listPagesFetched: pages.length,
        detailFetchLimit: detailLimit,
        detailFetchCount
      }
    };
  };
}

module.exports = {
  ICIMS_RATE_LIMIT_WAIT_MS,
  createFetchList,
  classifyPublicRouteStatus,
  extractIcimsIframeUrlFromHtml,
  extractIcimsNextPageUrlFromHtml,
  ensureIcimsIframeUrl,
  hasIcimsPublicPostingEvidence,
  icimsDetailEvidenceKind
};
