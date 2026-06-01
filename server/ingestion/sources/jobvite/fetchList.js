const { safeFetch } = require("../../safeFetch");
const { normalizeCountryFromLocation } = require("../../posting");
const { buildCompanyContext, clean, createDiscover, parseJobviteCompany, supportedJobviteHost } = require("./discover");
const { parseJobvitePostingsFromHtml } = require("./parse");

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

async function payloadToHtml(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  return "";
}

async function fetchJobviteHtml(url, target, options = {}) {
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError("fetch_failed", `Jobvite page request failed (${status})`, {
        status,
        url
      });
    }
    const finalUrl = clean(payload?.url || payload?.__sourceFetchFinalUrl || url);
    assertJobviteFinalHost(finalUrl, url);
    return {
      html: await payloadToHtml(payload),
      finalUrl,
      status
    };
  }

  const response = await safeFetch(url, target);
  if (!response.ok) {
    const body = await response.text();
    throw makeSourceFetchError("fetch_failed", `Jobvite page request failed (${response.status}): ${body.slice(0, 180)}`, {
      status: response.status,
      url: response.url || url
    });
  }
  const finalUrl = clean(response.url || url);
  assertJobviteFinalHost(finalUrl, url);
  return {
    html: await response.text(),
    finalUrl,
    status: response.status
  };
}

function assertJobviteFinalHost(finalUrl, fallbackUrl) {
  const value = clean(finalUrl || fallbackUrl);
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (supportedJobviteHost(host)) return;
  } catch {
    // Fall through to the source error below.
  }
  throw makeSourceFetchError("unexpected_redirect_host", `Jobvite URL redirected to unexpected host: ${value}`, {
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
    jobsUrl: value || clean(config?.jobsUrl)
  };
}

function jobviteDetailKey(urlValue) {
  try {
    const parsed = new URL(clean(urlValue));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return clean(urlValue).replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function jobviteLocationLooksAmbiguous(location) {
  return /^\s*(?:\d+\s+locations?|multiple locations?|various locations?|all locations?)\s*$/i.test(clean(location));
}

function jobviteLocationHasAustraliaState(location) {
  return /\b(new south wales|queensland|victoria|western australia|south australia|tasmania|australian capital territory|northern territory|nsw|qld|vic|wa|sa|tas|act|nt)\b/i.test(clean(location));
}

function stripJobviteWorkModePrefix(location) {
  return clean(location).replace(/^\s*(?:hybrid(?:\s+remote)?|remote)\b\s*,?\s*/i, "").trim();
}

function jobviteLocationLooksCountrylessConcrete(location) {
  const sourceLocation = clean(location);
  const locationValue = stripJobviteWorkModePrefix(sourceLocation);
  if (!locationValue) return false;
  if (jobviteLocationLooksAmbiguous(locationValue)) return false;
  if (/^(remote|hybrid(?:\s+remote)?)$/i.test(sourceLocation)) return false;
  return !normalizeCountryFromLocation(locationValue);
}

function jobvitePostingNeedsDetail(posting = {}) {
  const sourceLocation = posting.source_list_location || posting.location;
  return !clean(posting.posting_date) ||
    jobviteLocationLooksAmbiguous(sourceLocation) ||
    jobviteLocationLooksCountrylessConcrete(sourceLocation) ||
    jobviteLocationHasAustraliaState(sourceLocation);
}

function jobviteDetailPriorityScore(posting = {}) {
  let score = 0;
  const sourceLocation = posting.source_list_location || posting.location;
  if (jobviteLocationLooksAmbiguous(sourceLocation)) score += 100;
  if (jobviteLocationLooksCountrylessConcrete(sourceLocation)) score += 90;
  if (jobviteLocationHasAustraliaState(sourceLocation)) score += 80;
  if (!clean(sourceLocation)) score += 40;
  if (!clean(posting.posting_date)) score += 5;
  return score;
}

function prioritizeJobviteDetailCandidates(postings = []) {
  return (Array.isArray(postings) ? postings : [])
    .map((posting, index) => ({ posting, index, score: jobviteDetailPriorityScore(posting) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.posting);
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchJobviteSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config?.jobsUrl
      ? discovered.config
      : parseJobviteCompany(context.url_string);
    const jobsUrl = clean(config?.jobsUrl || discovered?.list_url);
    if (!jobsUrl) {
      throw makeSourceFetchError("no_public_jobs_route", "Jobvite source has no supported jobs route", {
        url: context.url_string
      });
    }

    const target = {
      method: "GET",
      headers: buildHeaders()
    };

    const list = await fetchJobviteHtml(jobsUrl, target, options);
    const finalUrl = list.finalUrl || jobsUrl;
    const finalConfig = withFinalConfig(config, finalUrl, jobsUrl);
    const companyName = clean(context.company_name || finalConfig.companySlugLower || finalConfig.companySlug || "jobvite");
    const preliminary = parseJobvitePostingsFromHtml(companyName, finalConfig, { html: list.html });
    const detailLimit = Math.max(0, Math.min(75, Number(process.env.OPENJOBSLOTS_JOBVITE_DETAIL_FETCH_LIMIT_PER_COMPANY || 25)));
    let detailFetches = 0;
    const detailHtmlByUrl = {};

    for (const posting of prioritizeJobviteDetailCandidates(preliminary)) {
      if (detailFetches >= detailLimit) break;
      if (!jobvitePostingNeedsDetail(posting)) continue;
      const detailUrl = clean(posting.job_posting_url);
      if (!detailUrl) continue;
      try {
        const detail = await fetchJobviteHtml(detailUrl, target, options);
        detailFetches += 1;
        const key = jobviteDetailKey(detailUrl);
        detailHtmlByUrl[detailUrl] = detail.html;
        detailHtmlByUrl[key] = detail.html;
      } catch {
        detailFetches += 1;
      }
    }

    return {
      html: list.html,
      __detailHtmlByUrl: detailHtmlByUrl,
      __sourceConfig: {
        ...finalConfig,
        detail_fetch_count: detailFetches
      },
      __sourceFetchFinalUrl: finalUrl
    };
  };
}

module.exports = {
  jobvitePostingNeedsDetail,
  createFetchList
};
