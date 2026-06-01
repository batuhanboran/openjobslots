const { safeFetch } = require("../../safeFetch");
const {
  TALENTLYFT_SOURCE_FAMILY,
  buildCompanyContext,
  clean,
  createDiscover,
  parseTalentlyftCompany,
  supportedTalentlyftHost
} = require("./discover");
const {
  extractTalentlyftInitialConfig,
  extractTalentlyftTotalPages,
  parseTalentlyftPostingsFromFragment
} = require("./parse");

const TALENTLYFT_RATE_LIMIT_WAIT_MS = 60 * 1000;

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

function buildLandingHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

function buildFragmentHeaders(config) {
  return {
    Accept: "text/html, */*; q=0.01",
    "x-requested-with": "XMLHttpRequest",
    Referer: `${clean(config?.websiteUrl).replace(/\/+$/, "")}/`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

function buildDetailHeaders(config) {
  return {
    ...buildLandingHeaders(),
    Referer: `${clean(config?.websiteUrl).replace(/\/+$/, "")}/`
  };
}

function assertTalentlyftFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedTalentlyftHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Talentlyft URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function talentlyftDetailKey(urlValue) {
  try {
    const parsed = new URL(clean(urlValue));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return clean(urlValue).replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function resolveTalentlyftDetailFetchLimit(options = {}) {
  const raw = options.maxTalentlyftDetailPages ??
    options.detailFetchLimit ??
    process.env.OPENJOBSLOTS_TALENTLYFT_DETAIL_FETCH_LIMIT_PER_COMPANY ??
    25;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(0, Math.min(75, Math.floor(parsed)));
}

function withRuntimeConfig(discoveredConfig, landingHtml, finalUrl, fallbackUrl) {
  const initialConfig = extractTalentlyftInitialConfig(landingHtml, finalUrl || fallbackUrl);
  const finalParsed = (() => {
    try {
      return new URL(clean(finalUrl || fallbackUrl));
    } catch {
      return null;
    }
  })();
  const baseOrigin = finalParsed
    ? `${finalParsed.protocol}//${finalParsed.host}`
    : clean(discoveredConfig?.baseOrigin);
  const websiteUrl = clean(initialConfig.websiteUrl || baseOrigin).replace(/\/+$/, "");
  const apiUrl = `${clean(initialConfig.apiUrl || `${websiteUrl}/JobList/`).replace(/\/+$/, "")}/`;

  return {
    ...discoveredConfig,
    ...initialConfig,
    baseOrigin,
    websiteUrl,
    apiUrl
  };
}

function buildFragmentUrl(config, page = 1, pageSize = 20) {
  const apiUrl = clean(config?.apiUrl);
  if (!apiUrl) {
    throw makeSourceFetchError("no_public_jobs_route", "Talentlyft API URL is missing");
  }

  const params = new URLSearchParams({
    layoutId: clean(config?.layoutId) || "Jobs-1",
    websiteUrl: clean(config?.websiteUrl),
    themeId: clean(config?.themeId) || "2",
    language: clean(config?.language) || "en",
    subdomain: clean(config?.subdomain),
    page: String(page),
    pageSize: String(pageSize),
    contains: ""
  }).toString();
  return `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}${params}`;
}

async function fetchText(url, target, options = {}) {
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `Talentlyft request failed (${status})`, {
        status,
        url
      });
    }
    const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
    assertTalentlyftFinalHost(finalUrl, url);
    return {
      text: await payloadToText(payload),
      finalUrl,
      status
    };
  }

  const response = await safeFetch(url, target);
  if (!response.ok) {
    const body = await response.text();
    throw makeSourceFetchError("fetch_failed", `Talentlyft request failed (${response.status}): ${body.slice(0, 180)}`, {
      status: response.status,
      url: response.url || url
    });
  }
  const finalUrl = clean(response.url || url);
  assertTalentlyftFinalHost(finalUrl, url);
  return {
    text: await response.text(),
    finalUrl,
    status: response.status
  };
}

function buildPreliminaryTalentlyftPostings(fragments = [], context = {}, runtimeConfig = {}) {
  const companyName = clean(context.company_name || runtimeConfig.subdomainLower || "talentlyft") || "talentlyft";
  const postings = [];
  const seenUrls = new Set();
  for (const fragment of fragments) {
    const batch = parseTalentlyftPostingsFromFragment(companyName, runtimeConfig, fragment?.html || fragment);
    for (const posting of batch) {
      const postingUrl = clean(posting.job_posting_url);
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      seenUrls.add(postingUrl);
      postings.push(posting);
    }
  }
  return postings;
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchTalentlyftSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.careersUrl
      ? discovered.config
      : parseTalentlyftCompany(context.url_string);
    const careersUrl = clean(config?.careersUrl || discovered?.list_url);
    if (!careersUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Talentlyft source has no supported jobs route", {
        url: context.url_string
      });
    }

    const landingTarget = {
      method: "GET",
      headers: buildLandingHeaders(),
      source_key: "talentlyft",
      source_family: TALENTLYFT_SOURCE_FAMILY,
      rateLimitMs: TALENTLYFT_RATE_LIMIT_WAIT_MS
    };
    const landing = await fetchText(careersUrl, landingTarget, options);
    const runtimeConfig = withRuntimeConfig(config, landing.text, landing.finalUrl, careersUrl);

    const fragments = [];
    const requests = [{
      url: careersUrl,
      kind: "landing"
    }];
    const maxPages = Math.max(1, Math.min(10, Number(options.maxTalentlyftPages || 10)));
    let totalPages = 1;
    for (let page = 1; page <= Math.min(maxPages, totalPages); page += 1) {
      const fragmentUrl = buildFragmentUrl(runtimeConfig, page, 20);
      const fragmentTarget = {
        method: "GET",
        headers: buildFragmentHeaders(runtimeConfig),
        source_key: "talentlyft",
        source_family: TALENTLYFT_SOURCE_FAMILY,
        rateLimitMs: TALENTLYFT_RATE_LIMIT_WAIT_MS
      };
      const fragment = await fetchText(fragmentUrl, fragmentTarget, options);
      fragments.push({
        page,
        html: fragment.text,
        finalUrl: fragment.finalUrl
      });
      requests.push({
        url: fragmentUrl,
        kind: "fragment",
        page
      });
      totalPages = Math.max(totalPages, extractTalentlyftTotalPages(fragment.text));
      if (!fragment.text && page >= totalPages) break;
    }

    const detailHtmlByUrl = {};
    const detailStatusByUrl = {};
    const detailLimit = resolveTalentlyftDetailFetchLimit(options);
    let detailFetches = 0;
    const detailTarget = {
      method: "GET",
      headers: buildDetailHeaders(runtimeConfig),
      source_key: "talentlyft",
      source_family: TALENTLYFT_SOURCE_FAMILY,
      rateLimitMs: TALENTLYFT_RATE_LIMIT_WAIT_MS
    };

    for (const posting of buildPreliminaryTalentlyftPostings(fragments, context, runtimeConfig)) {
      if (detailFetches >= detailLimit) break;
      const detailUrl = clean(posting.job_posting_url);
      if (!detailUrl) continue;
      try {
        const detail = await fetchText(detailUrl, detailTarget, options);
        detailFetches += 1;
        const originalKey = talentlyftDetailKey(detailUrl);
        const finalKey = talentlyftDetailKey(detail.finalUrl);
        detailHtmlByUrl[detailUrl] = detail.text;
        detailHtmlByUrl[originalKey] = detail.text;
        detailHtmlByUrl[detail.finalUrl] = detail.text;
        detailHtmlByUrl[finalKey] = detail.text;
        detailStatusByUrl[detailUrl] = detail.status;
        detailStatusByUrl[originalKey] = detail.status;
        detailStatusByUrl[detail.finalUrl] = detail.status;
        detailStatusByUrl[finalKey] = detail.status;
        requests.push({
          url: detailUrl,
          kind: "detail"
        });
      } catch {
        detailFetches += 1;
        requests.push({
          url: detailUrl,
          kind: "detail"
        });
      }
    }

    return {
      landingHtml: landing.text,
      fragments,
      __detailHtmlByUrl: detailHtmlByUrl,
      __detailStatusByUrl: detailStatusByUrl,
      __sourceConfig: {
        ...runtimeConfig,
        detail_fetch_count: detailFetches
      },
      __sourceDetailFetchCount: detailFetches,
      __sourceFetchFinalUrl: landing.finalUrl,
      __sourceRequest: {
        careersUrl,
        requestCount: requests.length,
        rateLimitMs: TALENTLYFT_RATE_LIMIT_WAIT_MS,
        requests
      }
    };
  };
}

module.exports = {
  TALENTLYFT_RATE_LIMIT_WAIT_MS,
  buildFragmentUrl,
  createFetchList
};
