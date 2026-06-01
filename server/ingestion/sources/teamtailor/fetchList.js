const { safeFetch } = require("../../safeFetch");
const { buildCompanyContext, clean, createDiscover } = require("./discover");
const parser = require("./parse");

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

function buildHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

function buildRssHeaders() {
  return {
    Accept: "application/rss+xml, text/xml, application/xml;q=0.9, */*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

async function payloadToHtml(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

async function fetchOptionalJobsHtml(jobsUrl, options = {}) {
  const url = clean(jobsUrl);
  if (!url) return null;
  const target = {
    method: "GET",
    headers: buildHeaders()
  };

  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) return null;
    const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
    assertTeamtailorFinalHost(finalUrl, url);
    return {
      html: await payloadToHtml(payload),
      finalUrl
    };
  }

  const res = await safeFetch(url, target);
  if (!res.ok) return null;
  const finalUrl = clean(res.url || url);
  assertTeamtailorFinalHost(finalUrl, url);
  return {
    html: await res.text(),
    finalUrl
  };
}

async function fetchTeamtailorHtml(url, target, options = {}) {
  const requestedUrl = clean(url);
  if (!requestedUrl) {
    throw makeSourceFetchError("missing_url", "Teamtailor fetch requires a URL");
  }

  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(requestedUrl, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `Teamtailor page request failed (${status})`, {
        status,
        url: requestedUrl
      });
    }
    const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || requestedUrl);
    assertTeamtailorFinalHost(finalUrl, requestedUrl);
    return {
      html: await payloadToHtml(payload),
      finalUrl,
      status
    };
  }

  const response = await safeFetch(requestedUrl, target);
  if (!response.ok) {
    const body = await response.text();
    throw makeSourceFetchError("fetch_failed", `Teamtailor page request failed (${response.status}): ${body.slice(0, 180)}`, {
      status: response.status,
      url: response.url || requestedUrl
    });
  }
  const finalUrl = clean(response.url || requestedUrl);
  assertTeamtailorFinalHost(finalUrl, requestedUrl);
  return {
    html: await response.text(),
    finalUrl,
    status: response.status
  };
}

function shouldFetchHtmlFallbackForRss(rssText) {
  const source = String(rssText || "");
  return /<tt:locations>\s*<\/tt:locations>/i.test(source) || !/<tt:location(?:\s|>)/i.test(source);
}

function assertTeamtailorFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host.endsWith(".teamtailor.com")) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Teamtailor URL redirected to unexpected host: ${value}`, {
    url: value
  });
}

function withFinalConfig(config, finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  let baseOrigin = clean(config?.baseOrigin);
  try {
    const parsed = new URL(value);
    baseOrigin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Keep the discovered origin.
  }
  return {
    ...config,
    baseOrigin,
    jobsUrl: clean(config?.jobsUrl),
    rssUrl: value || clean(config?.rssUrl)
  };
}

function teamtailorDetailKey(urlValue) {
  try {
    const parsed = new URL(clean(urlValue));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return clean(urlValue).replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function postingNeedsTeamtailorDetail(posting = {}) {
  return Boolean(clean(posting.job_posting_url)) && !clean(posting.location);
}

function prioritizeTeamtailorDetailCandidates(postings = []) {
  return (Array.isArray(postings) ? postings : [])
    .map((posting, index) => {
      let score = 0;
      if (!clean(posting.location)) score += 100;
      if (posting.remote_type === "remote" || posting.remote_type === "hybrid") score += 40;
      if (!clean(posting.posting_date)) score += 5;
      return { posting, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.posting);
}

async function buildTeamtailorRssPayload({ rss, optionalHtml, config, finalUrl, rssUrl, context, options }) {
  const companyName = clean(context.company_name || config.subdomainLower || "teamtailor");
  const rssPostings = parser.parseTeamtailorPostingsFromRss(companyName, rss);
  const htmlPostings = optionalHtml?.html
    ? parser.parseTeamtailorPostingsFromHtml(companyName, config, optionalHtml.html)
    : [];
  const preliminary = parser.mergeTeamtailorRssAndHtmlPostings(rssPostings, htmlPostings);
  const detailLimit = Math.max(0, Math.min(75, Number(process.env.OPENJOBSLOTS_TEAMTAILOR_DETAIL_FETCH_LIMIT_PER_COMPANY || 25)));
  let detailFetches = 0;
  const detailHtmlByUrl = {};
  const detailStatusByUrl = {};
  const htmlTarget = {
    method: "GET",
    headers: buildHeaders()
  };

  for (const posting of prioritizeTeamtailorDetailCandidates(preliminary)) {
    if (detailFetches >= detailLimit) break;
    if (!postingNeedsTeamtailorDetail(posting)) continue;
    const detailUrl = clean(posting.job_posting_url);
    try {
      const detail = await fetchTeamtailorHtml(detailUrl, htmlTarget, options);
      detailFetches += 1;
      const key = teamtailorDetailKey(detailUrl);
      detailHtmlByUrl[detailUrl] = detail.html;
      detailHtmlByUrl[key] = detail.html;
      detailStatusByUrl[detailUrl] = detail.status;
      detailStatusByUrl[key] = detail.status;
    } catch {
      detailFetches += 1;
    }
  }

  return {
    rss,
    ...(optionalHtml?.html ? { html: optionalHtml.html } : {}),
    __detailHtmlByUrl: detailHtmlByUrl,
    __detailStatusByUrl: detailStatusByUrl,
    __sourceConfig: {
      ...withFinalConfig(config, finalUrl, rssUrl),
      detail_fetch_count: detailFetches
    },
    __sourceDetailFetchCount: detailFetches,
    __sourceFetchFinalUrl: finalUrl,
    ...(optionalHtml?.finalUrl ? { __sourceHtmlFetchFinalUrl: optionalHtml.finalUrl } : {}),
    __sourceFormat: "rss"
  };
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchTeamtailorSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const rssUrl = clean(config.rssUrl);
    const jobsUrl = clean(config.jobsUrl || discovered?.list_url);
    if (!rssUrl && !jobsUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Teamtailor source has no supported jobs route");
    }

    if (rssUrl) {
      const rssTarget = {
        method: "GET",
        headers: buildRssHeaders()
      };

      if (typeof options.fetcher === "function") {
        const payload = await options.fetcher(rssUrl, rssTarget);
        const status = responseStatus(payload);
        if (status >= 200 && status < 300) {
          const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || rssUrl);
          assertTeamtailorFinalHost(finalUrl, rssUrl);
          const rss = await payloadToHtml(payload);
          const optionalHtml = shouldFetchHtmlFallbackForRss(rss)
            ? await fetchOptionalJobsHtml(jobsUrl, options)
            : null;
          return buildTeamtailorRssPayload({ rss, optionalHtml, config, finalUrl, rssUrl, context, options });
        }
        if (status !== 404) {
          throw makeSourceFetchError("fetch_failed", `Teamtailor RSS request failed (${status})`, {
            status,
            url: rssUrl
          });
        }
      } else {
        const rssRes = await safeFetch(rssUrl, rssTarget);
        if (rssRes.ok) {
          const finalUrl = clean(rssRes.url || rssUrl);
          assertTeamtailorFinalHost(finalUrl, rssUrl);
          const rss = await rssRes.text();
          const optionalHtml = shouldFetchHtmlFallbackForRss(rss)
            ? await fetchOptionalJobsHtml(jobsUrl, options)
            : null;
          return buildTeamtailorRssPayload({ rss, optionalHtml, config, finalUrl, rssUrl, context, options });
        }
        if (rssRes.status !== 404) {
          const body = await rssRes.text();
          throw new Error(`Teamtailor RSS request failed (${rssRes.status}): ${body.slice(0, 180)}`);
        }
      }
    }

    const target = {
      method: "GET",
      headers: buildHeaders()
    };

    if (typeof options.fetcher === "function") {
      const payload = await options.fetcher(jobsUrl, target);
      const status = responseStatus(payload);
      if (status < 200 || status >= 300) {
        throw makeSourceFetchError("fetch_failed", `Teamtailor page request failed (${status})`, {
          status,
          url: jobsUrl
        });
      }
      const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || jobsUrl);
      assertTeamtailorFinalHost(finalUrl, jobsUrl);
      return {
        html: await payloadToHtml(payload),
        __sourceConfig: withFinalConfig(config, finalUrl, jobsUrl),
        __sourceFetchFinalUrl: finalUrl
      };
    }

    const res = await safeFetch(jobsUrl, target);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Teamtailor page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
    const finalUrl = clean(res.url || jobsUrl);
    assertTeamtailorFinalHost(finalUrl, jobsUrl);
    return {
      html: await res.text(),
      __sourceConfig: withFinalConfig(config, finalUrl, jobsUrl),
      __sourceFetchFinalUrl: finalUrl
    };
  };
}

module.exports = {
  postingNeedsTeamtailorDetail,
  createFetchList
};
