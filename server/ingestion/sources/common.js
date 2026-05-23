const {
  collectPostingsForCompany,
  buildApplitrackDetailUrl,
  extractApplitrackDetailFields,
  parseApplitrackPostings,
  parseAshbyPostingsFromApi,
  parseBambooHrPostingsFromApi,
  parseAdpMyjobsPostingsFromApi,
  parseAdpWorkforcenowPostingsFromApi,
  parseBrassringPostingsFromApi,
  parseManatalPostingsFromApi,
  parseOraclePostingsFromApi,
  parsePaylocityPostingsFromPageData,
  parsePinpointHqPostingsFromApi,
  parseRecruitCrmPostingsFromApi,
  parseRecruiteePostingsFromPublicApp,
  parseSapHrCloudPostingsFromApi,
  parseSmartRecruitersPostingsFromApi,
  parseTalentreefPostingsFromSearchResponse,
  parseUltiProPostingsFromApi,
  parseWorkdayPostingsFromApi,
  parseZohoPostingsFromHtml
} = require("../../index");
const { parseApplyToJobPostingsFromHtml } = require("./applytojob/parse");
const { parseBreezyPostingsFromHtml } = require("./breezy/parse");
const { parseCareerplugPostingsFromHtml } = require("./careerplug/parse");
const { parseFountainPostingsFromApi } = require("./fountain/parse");
const { parseGreenhousePostingsFromApi } = require("./greenhouse/parse");
const { parseHirebridgePostingsFromHtml } = require("./hirebridge/parse");
const { parseHrmDirectPostingsFromHtml } = require("./hrmdirect/parse");
const {
  extractIcimsLocationFromHtml,
  extractIcimsPostingDateFromHtml,
  extractIcimsRemoteTypeFromHtml,
  parseIcimsPostingsFromHtml
} = require("./icims/parse");
const { parseJobvitePostingsFromHtml } = require("./jobvite/parse");
const { parseLeverPostingsFromApi } = require("./lever/parse");
const { parsePageupPostingsFromResults } = require("./pageup/parse");
const {
  extractTaleoPostingsFromAjax,
  extractTaleoPostingsFromRest
} = require("./taleo/parse");
const { validateNormalizedPostingContract } = require("../parserContract");
const { buildEvidenceMetadata, evaluatePublicPosting, hasUsefulGeoEvidence } = require("../publicPostingGate");
const { decideDetailEscalation } = require("../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../posting");
const { readLimitedResponseText, safeFetch } = require("../safeFetch");

const DEFAULT_PARSER_CONFIDENCE = 0.75;
const DEFAULT_RATE_LIMIT = Object.freeze({
  requestsPerMinute: 30,
  strategy: "direct-json-api-per-host-serialized"
});
const ENTERPRISE_RATE_LIMIT = Object.freeze({
  requestsPerMinute: 8,
  strategy: "enterprise-brittle-per-host-serialized"
});

function clean(value) {
  return String(value || "").trim();
}

function asUrl(value) {
  try {
    return new URL(clean(value));
  } catch {
    return null;
  }
}

function firstPathSegment(value) {
  const parsed = asUrl(value);
  if (!parsed) return "";
  return decodeURIComponent(parsed.pathname.split("/").filter(Boolean)[0] || "").trim();
}

function hostSlug(value) {
  const parsed = asUrl(value);
  if (!parsed) return "";
  const host = parsed.hostname.toLowerCase();
  const parts = host.split(".");
  if (parts.length <= 2) return firstPathSegment(value);
  return parts[0];
}

function queryParam(value, name) {
  const parsed = asUrl(value);
  if (!parsed) return "";
  return clean(parsed.searchParams.get(name));
}

function parsePathParts(value) {
  const parsed = asUrl(value);
  if (!parsed) return [];
  return parsed.pathname.split("/").map((part) => clean(part)).filter(Boolean);
}

function applitrackSiteRoot(value) {
  const parsed = asUrl(value);
  if (!parsed) return "";
  const pathValue = String(parsed.pathname || "/");
  const lowerPath = pathValue.toLowerCase();
  const onlineAppIndex = lowerPath.indexOf("/onlineapp/");
  const rootPath = onlineAppIndex >= 0
    ? pathValue.slice(0, onlineAppIndex + "/onlineapp/".length)
    : pathValue.endsWith("/default.aspx")
      ? pathValue.slice(0, -1 * "default.aspx".length)
      : pathValue.endsWith("/")
        ? pathValue
        : `${pathValue.replace(/[^/]*$/, "")}`;
  const normalizedRootPath = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return `${parsed.protocol}//${parsed.host}${normalizedRootPath}`;
}

function buildCompanyContext(company = {}) {
  return {
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key)
  };
}

function normalizeCompanyName(company, fallback) {
  return clean(company?.company_name || company?.companyName || company?.name || fallback);
}

async function fetchJson(url, init = {}) {
  const response = await safeFetch(url, {
    ...init,
    headers: {
      accept: "application/json,text/html;q=0.8,*/*;q=0.5",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const error = new Error(`source fetch failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const body = await readLimitedResponseText(response, { sourceUrl: response.url || url });
  if (contentType.includes("json")) return JSON.parse(body);
  return body;
}

function makeSourceFetchError(code, message, detail = {}) {
  const error = new Error(message || code);
  error.ingestionErrorType = code;
  if (detail.status) error.status = detail.status;
  if (detail.url) error.url = detail.url;
  return error;
}

function classifyPublicRouteStatus(status, fallbackCode = "fetch_failed") {
  const value = Number(status || 0);
  if (value === 404 || value === 410) return "detail_404_or_410";
  if (value === 401 || value === 403 || value === 429) return "blocked_or_rate_limited";
  return fallbackCode;
}

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
      accept: "text/html,application/xhtml+xml,application/json;q=0.7,*/*;q=0.5",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(fetchOptions.headers || {})
    }
  });
  if (!response.ok) {
    const code = classifyPublicRouteStatus(response.status, "fetch_failed");
    const sourceLabel = clean(options.sourceLabel || "source");
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

function ensureIcimsIframeUrl(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return clean(urlString);
  parsed.searchParams.set("in_iframe", "1");
  return parsed.toString();
}

function parseIcimsPublicCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".icims.com")) return null;
  const [tenant = ""] = host.split(".");
  if (!tenant) return null;
  const searchUrl = new URL(parsed.toString());
  searchUrl.pathname = "/jobs/search";
  if (!searchUrl.searchParams.has("ss")) searchUrl.searchParams.set("ss", "1");
  searchUrl.searchParams.delete("in_iframe");
  return {
    tenant,
    host,
    origin: `${parsed.protocol}//${parsed.host}`,
    searchUrl: searchUrl.toString()
  };
}

function parseRecruitCrmPublicCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;
  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruitcrm.io" && !host.endsWith(".recruitcrm.io")) return null;

  const pathParts = parsePathParts(urlString);
  let account = "";
  if (pathParts.length >= 2 && pathParts[0].toLowerCase() === "jobs") {
    account = pathParts[1];
  } else {
    account = queryParam(urlString, "account");
  }
  if (!account) return null;

  return {
    account,
    publicJobsUrl: `https://recruitcrm.io/jobs/${encodeURIComponent(account)}`,
    apiUrl: `https://albatross.recruitcrm.io/v1/external-pages/jobs-by-account/get?account=${encodeURIComponent(account)}&batch=true`
  };
}

async function fetchRecruitCrmSourceList(company = {}, target = {}, options = {}) {
  const config = target?.config?.apiUrl ? target.config : parseRecruitCrmPublicCompany(company.url_string);
  if (!config?.apiUrl) {
    throw makeSourceFetchError("no_public_jobs_route", "RecruitCRM source has no public jobs route", {
      url: company.url_string
    });
  }

  const jobs = [];
  const seen = new Set();
  const limit = 100;
  const maxPages = Math.max(1, Math.min(5, Number(process.env.OPENJOBSLOTS_RECRUITCRM_SOURCE_MAX_PAGES || 5)));
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * limit;
    const body = JSON.stringify({
      limit,
      offset,
      search_data: "",
      onlyJobs: true
    });
    const payload = options.fetcher
      ? await options.fetcher(config.apiUrl, { ...target, method: "POST", body })
      : await fetchJson(config.apiUrl, {
          method: "POST",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            Origin: "https://recruitcrm.io",
            Referer: config.publicJobsUrl,
            "User-Agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)"
          },
          body
        });
    const data = typeof payload === "string" ? JSON.parse(payload) : payload;
    const batch = Array.isArray(data?.data?.jobs)
      ? data.data.jobs
      : Array.isArray(data?.jobs)
        ? data.jobs
        : Array.isArray(data?.data)
          ? data.data
          : [];
    for (const item of batch) {
      const key = clean(item?.id || item?.job_id || item?.jobId || item?.uuid || item?.jobcode || item?.slug || item?.url);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      jobs.push(item);
    }
    if (batch.length < limit) break;
  }
  return {
    data: { jobs },
    __sourceConfig: config
  };
}

function extractIcimsIframeUrlFromHtml(pageHtml, baseUrl) {
  const source = String(pageHtml || "");
  const patterns = [
    /icimsFrame\.src\s*=\s*'([^']+)'/i,
    /icimsFrame\.src\s*=\s*"([^"]+)"/i,
    /<iframe[^>]*id=["']icims_content_iframe["'][^>]*src=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const rawValue = clean(match?.[1]);
    if (!rawValue) continue;
    let candidate = rawValue.replace(/&amp;/g, "&").replace(/\\\//g, "/");
    if (candidate.startsWith("//")) {
      const parsedBase = asUrl(baseUrl);
      candidate = `${parsedBase?.protocol || "https:"}${candidate}`;
    } else if (!/^https?:\/\//i.test(candidate)) {
      try {
        candidate = new URL(candidate, baseUrl).toString();
      } catch {
        continue;
      }
    }
    return ensureIcimsIframeUrl(candidate);
  }
  return ensureIcimsIframeUrl(baseUrl);
}

function extractIcimsNextPageUrlFromHtml(pageHtml, currentUrl) {
  const source = String(pageHtml || "");
  const patterns = [
    /<link[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']next["'][^>]*>/i,
    /<a[^>]*(?:aria-label|title)=["']next["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<a[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?\bnext\b[\s\S]*?<\/a>/i
  ];
  const current = asUrl(currentUrl);
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const rawValue = clean(match?.[1]);
    if (!rawValue) continue;
    let candidate = rawValue.replace(/&amp;/g, "&").replace(/\\\//g, "/");
    if (candidate.startsWith("//")) {
      candidate = `${current?.protocol || "https:"}${candidate}`;
    } else if (!/^https?:\/\//i.test(candidate)) {
      try {
        candidate = new URL(candidate, currentUrl).toString();
      } catch {
        continue;
      }
    }
    const parsedCandidate = asUrl(candidate);
    if (!parsedCandidate || !current || parsedCandidate.host !== current.host) continue;
    const normalized = ensureIcimsIframeUrl(candidate);
    if (normalized && normalized !== clean(currentUrl)) return normalized;
  }
  return "";
}

function icimsDetailUrl(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed || !String(parsed.hostname || "").toLowerCase().endsWith(".icims.com")) return "";
  return ensureIcimsIframeUrl(parsed.toString());
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

function hasIcimsPublicPostingEvidence(posting = {}) {
  return Boolean(clean(posting.location) || clean(posting.location_text) || clean(posting.remote_type));
}

async function fetchIcimsSourceList(company = {}, target = {}, options = {}) {
  const discovered = target && target.list_url ? target : SOURCE_SPECS.icims.discover(company);
  const route = parseIcimsPublicCompany(discovered.list_url || company.url_string);
  if (!route) {
    throw makeSourceFetchError("no_public_portal_route", "iCIMS source has no public *.icims.com portal route", {
      url: company.url_string
    });
  }

  const companyName = normalizeCompanyName(company, route.tenant);
  const wrapper = await fetchText(route.searchUrl, { ...options, target: discovered });
  const firstPageUrl = extractIcimsIframeUrlFromHtml(wrapper.text, wrapper.finalUrl || route.searchUrl);
  const pages = [];
  const seenPageUrls = new Set();
  const maxPages = Math.max(1, Math.min(5, Number(process.env.OPENJOBSLOTS_ICIMS_SOURCE_MAX_PAGES || 2)));
  let pageUrl = firstPageUrl;

  for (let page = 0; page < maxPages; page += 1) {
    const normalizedPageUrl = ensureIcimsIframeUrl(pageUrl);
    if (!normalizedPageUrl || seenPageUrls.has(normalizedPageUrl)) break;
    seenPageUrls.add(normalizedPageUrl);
    const pageResponse = normalizedPageUrl === wrapper.finalUrl || normalizedPageUrl === route.searchUrl
      ? wrapper
      : await fetchText(normalizedPageUrl, { ...options, target: discovered });
    pages.push({ url: normalizedPageUrl, html: pageResponse.text });
    const nextPageUrl = extractIcimsNextPageUrlFromHtml(pageResponse.text, normalizedPageUrl);
    if (!nextPageUrl) break;
    pageUrl = nextPageUrl;
  }

  const postings = [];
  const seenPostingUrls = new Set();
  for (const page of pages) {
    for (const posting of parseIcimsPostingsFromHtml(companyName, route, page.html)) {
      const postingUrl = clean(posting?.job_posting_url);
      if (!postingUrl || seenPostingUrls.has(postingUrl)) continue;
      seenPostingUrls.add(postingUrl);
      postings.push({
        ...posting,
        source_evidence: {
          list_url: page.url,
          route_kind: "icims_public_iframe_list"
        }
      });
    }
  }

  if (postings.length === 0) {
    throw makeSourceFetchError("portal_search_empty", "iCIMS public portal search returned no parseable jobs", {
      url: route.searchUrl
    });
  }

  const detailLimit = Math.max(0, Math.min(100, Number(process.env.OPENJOBSLOTS_ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY || 20)));
  let detailFetches = 0;
  const enriched = [];
  for (const posting of postings) {
    let enrichedPosting = posting;
    const needsDetail =
      detailFetches < detailLimit &&
      (!clean(posting.location) || !clean(posting.posting_date) || !clean(posting.remote_type));
    if (needsDetail) {
      const detailUrl = icimsDetailUrl(posting.job_posting_url);
      if (!detailUrl) {
        enrichedPosting = {
          ...posting,
          source_failure_reasons: ["no_public_portal_route"]
        };
      } else {
        try {
          const detail = await fetchText(detailUrl, { ...options, target: discovered });
          detailFetches += 1;
          const detailLocation = extractIcimsLocationFromHtml(detail.text);
          const detailRemoteType = extractIcimsRemoteTypeFromHtml(detail.text);
          const detailPostingDate = extractIcimsPostingDateFromHtml(detail.text);
          const sourceEvidence = {
            ...(posting.source_evidence || {}),
            detail_url: detailUrl,
            detail_fetch_status: detail.status,
            location_source: detailLocation ? icimsDetailEvidenceKind(detail.text, "location") : "",
            remote_source: detailRemoteType ? icimsDetailEvidenceKind(detail.text, "remote") : "",
            posting_date_source: detailPostingDate ? icimsDetailEvidenceKind(detail.text, "date") : ""
          };
          enrichedPosting = {
            ...posting,
            location: clean(posting.location) || detailLocation || null,
            remote_type: clean(posting.remote_type) || detailRemoteType || null,
            posting_date: clean(posting.posting_date) || detailPostingDate || null,
            source_evidence: sourceEvidence
          };
        } catch (error) {
          detailFetches += 1;
          const statusCode = Number(error?.status || 0);
          enrichedPosting = {
            ...posting,
            source_failure_reasons: [classifyPublicRouteStatus(statusCode, "unsupported_tenant_shape")]
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
      detail_fetch_count: detailFetches
    }
  };
}

function isApplitrackAmbiguousLocation(value) {
  const normalized = clean(value).toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (/^(district\s*wide|districtwide|various|multiple|multiple locations|all locations|tbd|n\/a|to be determined)$/i.test(normalized)) {
    return true;
  }
  return /\b(multiple|various)\s+locations?\b/i.test(normalized);
}

function applitrackDetailEvidenceKind(detailHtml, field) {
  const source = String(detailHtml || "");
  if (field === "location" && /class=["']label["'][^>]*>\s*(?:Location|Location\(s\)|School|Site|Campus|Building|Worksite|Assignment Location|Work Location|Job Location)\s*:/i.test(source)) {
    return "labeled_detail_location";
  }
  if (field === "date" && /class=["']label["'][^>]*>\s*(?:Date Posted|Posted|Posting Date|Date Available)\s*:/i.test(source)) {
    return "labeled_detail_date";
  }
  if (field === "remote" && /class=["']label["'][^>]*>\s*(?:Remote|Work Location Type|Work Type)\s*:/i.test(source)) {
    return "labeled_detail_remote";
  }
  return `detail_${field}`;
}

function applitrackSourceFailureReasons(posting = {}) {
  const reasons = [];
  const location = clean(posting.location || posting.location_text);
  const remoteType = clean(posting.remote_type).toLowerCase();
  const ambiguousLocation = isApplitrackAmbiguousLocation(location);
  if (ambiguousLocation) reasons.push("district_wide_ambiguous");
  if (!location) reasons.push("no_structured_location");
  if ((!location || ambiguousLocation) && !["remote", "hybrid", "onsite"].includes(remoteType)) {
    reasons.push("no_explicit_remote_evidence");
  }
  return reasons;
}

async function fetchApplitrackSourceList(company = {}, target = {}, options = {}) {
  const discovered = target && target.list_url ? target : SOURCE_SPECS.applitrack.discover(company);
  const siteRoot = clean(discovered?.config?.siteRoot || applitrackSiteRoot(company.url_string));
  if (!siteRoot) {
    throw makeSourceFetchError("no_public_output_route", "Applitrack source has no public Output.asp route", {
      url: company.url_string
    });
  }

  const listUrl = clean(discovered.list_url) || new URL("jobpostings/Output.asp?all=1", siteRoot).toString();
  const list = await fetchText(listUrl, {
    ...options,
    target: discovered,
    sourceLabel: "Applitrack"
  });
  const companyName = normalizeCompanyName(company, hostSlug(siteRoot) || "Applitrack");
  const parsed = parseApplitrackPostings(list.text, siteRoot, companyName).map((posting) => ({
    ...posting,
    source_requires_normalized_geo_or_remote: true,
    source_evidence: {
      list_url: list.finalUrl || listUrl,
      route_kind: "applitrack_output_list"
    }
  }));

  if (parsed.length === 0) {
    throw makeSourceFetchError("output_empty", "Applitrack Output.asp returned no parseable postings", {
      url: listUrl
    });
  }

  const detailLimit = Math.max(0, Math.min(100, Number(process.env.OPENJOBSLOTS_APPLITRACK_DETAIL_FETCH_LIMIT_PER_COMPANY || 25)));
  let detailFetches = 0;
  const enriched = [];
  for (const posting of parsed) {
    let enrichedPosting = posting;
    const needsDetail =
      detailFetches < detailLimit &&
      (!clean(posting.location) ||
        !clean(posting.posting_date) ||
        !clean(posting.remote_type) ||
        isApplitrackAmbiguousLocation(posting.location));
    if (needsDetail) {
      const detailUrl = buildApplitrackDetailUrl(siteRoot, posting.source_job_id, posting.job_posting_url);
      try {
        const detail = await fetchText(detailUrl, {
          ...options,
          target: discovered,
          sourceLabel: "Applitrack"
        });
        detailFetches += 1;
        const fields = extractApplitrackDetailFields(detail.text);
        const detailLocation = clean(fields.location);
        const currentLocation = clean(posting.location);
        const chosenLocation = currentLocation && !isApplitrackAmbiguousLocation(currentLocation)
          ? currentLocation
          : detailLocation || currentLocation;
        const sourceEvidence = {
          ...(posting.source_evidence || {}),
          detail_url: detailUrl,
          detail_fetch_status: detail.status,
          location_source: detailLocation ? applitrackDetailEvidenceKind(detail.text, "location") : "",
          remote_source: clean(fields.remote_type) ? applitrackDetailEvidenceKind(detail.text, "remote") : "",
          posting_date_source: clean(fields.posting_date) ? applitrackDetailEvidenceKind(detail.text, "date") : ""
        };
        enrichedPosting = {
          ...posting,
          location: chosenLocation || null,
          posting_date: clean(posting.posting_date) || clean(fields.posting_date) || null,
          remote_type: clean(posting.remote_type) || clean(fields.remote_type) || null,
          department: clean(posting.department) || clean(fields.department) || null,
          source_evidence: sourceEvidence
        };
      } catch (error) {
        detailFetches += 1;
        enrichedPosting = {
          ...posting,
          source_failure_reasons: [classifyPublicRouteStatus(Number(error?.status || 0), "unsupported_tenant_shape")]
        };
      }
    }

    const sourceFailureReasons = applitrackSourceFailureReasons(enrichedPosting);
    enriched.push({
      ...enrichedPosting,
      source_failure_reasons: Array.from(new Set([
        ...(Array.isArray(enrichedPosting.source_failure_reasons) ? enrichedPosting.source_failure_reasons : []),
        ...sourceFailureReasons
      ]))
    });
  }

  return {
    __legacyParsed: enriched,
    __sourceConfig: {
      ...discovered.config,
      siteRoot,
      list_url: listUrl,
      detail_fetch_count: detailFetches
    }
  };
}

function isTaleoAmbiguousLocation(value) {
  const normalized = clean(value).toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  return /^(multiple locations?|various locations?|all locations?|tbd|to be determined|unknown|n\/a|na)$/i.test(normalized);
}

function taleoHasExplicitWorkMode(posting = {}, normalized = {}) {
  const remoteType = clean(normalized.remote_type || posting.remote_type).toLowerCase();
  if (!["remote", "hybrid", "onsite"].includes(remoteType)) return false;

  const sourceText = [
    posting.remote_type,
    posting.workplace_type,
    posting.workplaceType,
    posting.work_type,
    posting.workType,
    posting.location,
    posting.location_text,
    posting?.source_evidence?.remote_source,
    posting?.source_evidence?.location_source
  ].map((value) => clean(value)).filter(Boolean).join(" ");

  if (!sourceText) return false;
  if (remoteType === "remote") return /\b(remote|fully remote|work from home|wfh|virtual|telework|telecommute)\b/i.test(sourceText);
  if (remoteType === "hybrid") return /\bhybrid\b/i.test(sourceText);
  return /\b(on[-\s]?site|onsite|office based|in office|work from office)\b/i.test(sourceText);
}

function taleoSourceFailureReasons(posting = {}, normalized = {}) {
  const target = normalized && Object.keys(normalized).length > 0 ? normalized : posting;
  const reasons = [];
  const title = clean(target.position_name || target.title || posting.position_name || posting.title);
  const sourceJobId = clean(target.source_job_id || posting.source_job_id || posting.jobId || posting.contestNo);
  const location = clean(target.location_text || target.location || posting.location_text || posting.location);
  const usefulGeo = hasUsefulGeoEvidence(target);
  const explicitWorkMode = taleoHasExplicitWorkMode(posting, target);

  if (/^\d{4,}$/.test(title) || (sourceJobId && title.toLowerCase() === sourceJobId.toLowerCase())) {
    reasons.push("unsupported_tenant_shape");
  }
  if (isTaleoAmbiguousLocation(location) && !explicitWorkMode) reasons.push("ambiguous_location");
  if (!usefulGeo && !explicitWorkMode) {
    reasons.push("no_structured_location");
    reasons.push("no_explicit_remote_evidence");
  }

  return Array.from(new Set(reasons));
}

function parseTaleoSourcePayload(companyName, config, payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const ajaxText = typeof payload.ajaxText === "string"
      ? payload.ajaxText
      : typeof payload.ajax_text === "string"
        ? payload.ajax_text
        : "";
    if (ajaxText) return extractTaleoPostingsFromAjax(companyName, config, ajaxText);
  }
  return extractTaleoPostingsFromRest(
    companyName,
    config,
    Array.isArray(payload) ? payload : payload?.requisitionList || []
  );
}

function classifyTaleoFetchError(error) {
  const message = String(error?.message || error || "");
  const statusMatch = message.match(/\b([1-5][0-9]{2})\b/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  if (status) return classifyPublicRouteStatus(status, "unsupported_tenant_shape");
  if (/portal|csrf|token/i.test(message)) return "unsupported_tenant_shape";
  if (/timed? out|rate|blocked|forbidden/i.test(message)) return "blocked_or_rate_limited";
  return "unsupported_tenant_shape";
}

async function fetchTaleoSourceList(company = {}, target = {}, options = {}) {
  const context = buildCompanyContext(company);
  const discovered = target && target.list_url ? target : SOURCE_SPECS.taleo.discover(context);
  const config = discovered?.config || {};
  const listUrl = clean(discovered?.list_url || context.url_string);
  const companyName = normalizeCompanyName(context, hostSlug(listUrl) || "Taleo");
  let parsed = [];

  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(listUrl, discovered);
    parsed = parseTaleoSourcePayload(companyName, config, payload);
  } else {
    try {
      parsed = await collectPostingsForCompany({
        ...context,
        ATS_name: "taleo"
      });
    } catch (error) {
      error.ingestionErrorType = error.ingestionErrorType || classifyTaleoFetchError(error);
      throw error;
    }
  }

  const enriched = (Array.isArray(parsed) ? parsed : []).map((posting) => ({
    ...posting,
    source_requires_normalized_geo_or_remote: true,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: listUrl,
      route_kind: "taleo_careersection_rest_or_ajax",
      location_source: clean(posting.location || posting.location_text) ? "taleo_requisition_column" : "",
      remote_source: clean(posting.remote_type || posting.workplace_type || posting.workplaceType) ? "taleo_requisition_column" : "",
      posting_date_source: clean(posting.posting_date) ? "taleo_requisition_column" : ""
    },
    source_failure_reasons: taleoSourceFailureReasons(posting)
  }));

  if (enriched.length === 0) {
    throw makeSourceFetchError("portal_search_empty", "Taleo public careersection returned no parseable jobs", {
      url: listUrl
    });
  }

  return {
    __legacyParsed: enriched,
    __sourceConfig: {
      ...config,
      list_url: listUrl,
      route_kind: "taleo_careersection_rest_or_ajax"
    }
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
  return new Set(
    (Array.isArray(posting.source_failure_reasons) ? posting.source_failure_reasons : [])
      .map((reason) => clean(reason).toLowerCase())
      .filter(Boolean)
  );
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

function detailPriorityScore(posting = {}, needsDetail) {
  const reasons = sourceFailureReasonSet(posting);
  let score = needsDetail(posting) ? 100 : 0;
  if (!hasUsefulGeoEvidence(posting) && !hasExplicitSourceRemote(posting)) score += 40;
  if (reasons.has("no_structured_location") || reasons.has("detail_no_structured_location")) score += 30;
  if (reasons.has("ambiguous_location")) score += 25;
  if (reasons.has("no_explicit_remote_evidence") || reasons.has("detail_no_explicit_remote")) score += 15;
  if (!clean(posting.posting_date)) score += 5;
  return score;
}

function prioritizeDetailCandidates(postings = [], needsDetail) {
  return (Array.isArray(postings) ? postings : [])
    .map((posting, index) => ({
      posting,
      index,
      score: detailPriorityScore(posting, needsDetail)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.posting);
}

async function fetchApplyToJobSourceList(company = {}, target = {}, options = {}) {
  const context = buildCompanyContext(company);
  const discovered = target && target.list_url ? target : SOURCE_SPECS.applytojob.discover(context);
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
  const companyName = normalizeCompanyName(context, hostSlug(listUrl) || "ApplyToJob");
  const parsed = parseApplyToJobPostingsFromHtml(companyName, config, {
    html: list.text,
    __listUrl: list.finalUrl || listUrl
  });

  if (parsed.length === 0) {
    throw makeSourceFetchError("portal_search_empty", "ApplyToJob public list returned no parseable postings", {
      url: listUrl
    });
  }

  const detailLimit = Math.max(0, Math.min(50, Number(process.env.OPENJOBSLOTS_APPLYTOJOB_DETAIL_FETCH_LIMIT_PER_COMPANY || 15)));
  let detailFetches = 0;
  const detailHtmlByUrl = {};
  const detailStatusByUrl = {};
  const detailFailureByUrl = {};

  for (const posting of prioritizeDetailCandidates(parsed, applyToJobPostingNeedsDetail)) {
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

function breezyPostingNeedsDetail(posting = {}) {
  const location = clean(posting.location || posting.location_text);
  const remoteType = clean(posting.remote_type).toLowerCase();
  const hasExplicitRemote = ["remote", "hybrid", "onsite"].includes(remoteType);
  const hasConcreteListLocation = Boolean(location) &&
    !/^(multiple|multiple locations|various|all locations|anywhere|global|remote|hybrid|tbd|to be determined)(?:\s|\(|$)/i.test(location);
  return !hasConcreteListLocation || !hasExplicitRemote || !clean(posting.posting_date);
}

async function fetchBreezySourceList(company = {}, target = {}, options = {}) {
  const context = buildCompanyContext(company);
  const discovered = target && target.list_url ? target : SOURCE_SPECS.breezy.discover(context);
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
  const config = {
    ...(discovered.config || {}),
    list_url: list.finalUrl || listUrl
  };
  const companyName = normalizeCompanyName(context, hostSlug(listUrl) || "Breezy");
  const parsed = parseBreezyPostingsFromHtml(companyName, config, {
    html: list.text,
    __listUrl: list.finalUrl || listUrl
  });

  if (parsed.length === 0) {
    throw makeSourceFetchError("portal_search_empty", "Breezy public portal returned no parseable postings", {
      url: listUrl
    });
  }

  const detailLimit = Math.max(0, Math.min(75, Number(process.env.OPENJOBSLOTS_BREEZY_DETAIL_FETCH_LIMIT_PER_COMPANY || 20)));
  let detailFetches = 0;
  const detailHtmlByUrl = {};
  const detailStatusByUrl = {};
  const detailFailureByUrl = {};

  for (const posting of prioritizeDetailCandidates(parsed, breezyPostingNeedsDetail)) {
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
    __listUrl: list.finalUrl || listUrl,
    __detailHtmlByUrl: detailHtmlByUrl,
    __detailStatusByUrl: detailStatusByUrl,
    __detailFailureByUrl: detailFailureByUrl,
    __sourceConfig: {
      ...config,
      detail_fetch_count: detailFetches
    }
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

function hrmDirectPostingNeedsDetail(posting = {}) {
  const location = clean(posting.location || posting.location_text);
  const remoteType = clean(posting.remote_type).toLowerCase();
  const hasExplicitRemote = ["remote", "hybrid"].includes(remoteType) ||
    /\b(remote|hybrid|work from home|wfh|telework|virtual)\b/i.test(location);
  const hasConcreteListLocation = Boolean(location) &&
    !/^(multiple|multiple locations|various|all locations|anywhere|global|remote|hybrid|tbd|to be determined)(?:\s|\(|$)/i.test(location);
  return !hasConcreteListLocation && !hasExplicitRemote;
}

async function fetchHrmDirectSourceList(company = {}, target = {}, options = {}) {
  const context = buildCompanyContext(company);
  const discovered = target && target.list_url ? target : SOURCE_SPECS.hrmdirect.discover(context);
  const listUrl = clean(discovered?.list_url || context.url_string);
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
    list_url: list.finalUrl || listUrl
  };
  const companyName = normalizeCompanyName(context, hostSlug(listUrl) || "HRMDirect");
  const parsed = parseHrmDirectPostingsFromHtml(companyName, config, {
    html: list.text,
    __listUrl: list.finalUrl || listUrl
  });

  if (parsed.length === 0) {
    throw makeSourceFetchError("portal_search_empty", "HRMDirect public job-openings table returned no parseable postings", {
      url: listUrl
    });
  }

  const configuredDetailLimit = Number(process.env.OPENJOBSLOTS_HRMDIRECT_DETAIL_FETCH_LIMIT_PER_COMPANY ?? 10);
  const detailLimit = Math.max(0, Math.min(75, Number.isFinite(configuredDetailLimit) ? configuredDetailLimit : 10));
  let detailFetches = 0;
  const detailHtmlByUrl = {};
  const detailStatusByUrl = {};
  const detailFailureByUrl = {};

  for (const posting of parsed) {
    if (detailFetches >= detailLimit) break;
    if (!hrmDirectPostingNeedsDetail(posting)) continue;
    const detailUrl = clean(posting.job_posting_url);
    if (!detailUrl) continue;
    try {
      const detail = await fetchText(detailUrl, {
        ...options,
        target: discovered,
        sourceLabel: "HRMDirect"
      });
      detailFetches += 1;
      const key = hrmDirectDetailKey(detailUrl);
      detailHtmlByUrl[detailUrl] = detail.text;
      detailHtmlByUrl[key] = detail.text;
      detailStatusByUrl[detailUrl] = detail.status;
      detailStatusByUrl[key] = detail.status;
    } catch (error) {
      detailFetches += 1;
      const key = hrmDirectDetailKey(detailUrl);
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
}

async function fetchWorkdaySourceList(company = {}, target = {}, options = {}) {
  const discovered = target && target.list_url ? target : SOURCE_SPECS.workday.discover(company);
  const config = discovered?.config || {};
  const listUrl = clean(discovered?.list_url || "");
  if (!listUrl) {
    throw makeSourceFetchError("no_public_jobs_route", "Workday source has no public CXS jobs route", {
      url: company.url_string
    });
  }

  const jobs = [];
  const seen = new Set();
  const limit = Math.max(1, Math.min(100, Number(process.env.OPENJOBSLOTS_WORKDAY_SOURCE_PAGE_SIZE || 20)));
  const maxPages = Math.max(1, Math.min(5, Number(process.env.OPENJOBSLOTS_WORKDAY_SOURCE_MAX_PAGES || 5)));
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * limit;
    const body = JSON.stringify({
      appliedFacets: {},
      limit,
      offset,
      searchText: ""
    });
    const payload = options.fetcher
      ? await options.fetcher(listUrl, { ...target, method: "POST", body })
      : await fetchJson(listUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body
        });
    const data = typeof payload === "string" ? JSON.parse(payload) : payload;
    const batch = Array.isArray(data?.jobPostings)
      ? data.jobPostings
      : Array.isArray(data?.data?.jobPostings)
        ? data.data.jobPostings
        : Array.isArray(data?.jobs)
          ? data.jobs
          : [];
    for (const item of batch) {
      const key = clean(item?.jobRequisitionId || item?.jobReqId || item?.requisitionId || item?.jobId || item?.id || item?.externalPath);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      jobs.push(item);
    }
    if (batch.length < limit) break;
  }

  return {
    jobPostings: jobs,
    __sourceConfig: config
  };
}

const SOURCE_SPECS = Object.freeze({
  greenhouse: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parseGreenhousePostingsFromApi,
    officialDocs: "https://developer.greenhouse.io/job-board.html",
    discover(company) {
      const boardToken = firstPathSegment(company.url_string);
      return {
        config: { boardToken, boardTokenLower: boardToken.toLowerCase() },
        listUrl: boardToken ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true` : ""
      };
    }
  },
  lever: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parseLeverPostingsFromApi,
    officialDocs: "https://github.com/lever/postings-api",
    discover(company) {
      const organization = firstPathSegment(company.url_string);
      return {
        config: { organization, organizationLower: organization.toLowerCase() },
        listUrl: organization ? `https://api.lever.co/v0/postings/${encodeURIComponent(organization)}?mode=json` : ""
      };
    }
  },
  ashby: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parseAshbyPostingsFromApi,
    officialDocs: "https://developers.ashbyhq.com/docs/public-job-posting-api",
    discover(company) {
      const organizationHostedJobsPageName = firstPathSegment(company.url_string);
      return {
        config: {
          organizationHostedJobsPageName,
          organizationHostedJobsPageNameLower: organizationHostedJobsPageName.toLowerCase()
        },
        listUrl: organizationHostedJobsPageName
          ? `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(organizationHostedJobsPageName)}`
          : ""
      };
    }
  },
  smartrecruiters: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parseSmartRecruitersPostingsFromApi,
    officialDocs: "https://developers.smartrecruiters.com/docs/endpoints",
    discover(company) {
      const companySlug = firstPathSegment(company.url_string) || hostSlug(company.url_string);
      return {
        config: { companySlug },
        listUrl: companySlug ? `https://jobs.smartrecruiters.com/sr-jobs/search?company=${encodeURIComponent(companySlug)}&limit=100` : ""
      };
    }
  },
  recruitee: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parseRecruiteePostingsFromPublicApp,
    officialDocs: "https://docs.recruitee.com/reference/intro-to-careers-site-api",
    discover(company) {
      const parsed = asUrl(company.url_string);
      const baseUrl = parsed ? parsed.origin : "";
      return {
        config: { baseUrl },
        listUrl: baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/offers/` : ""
      };
    }
  },
  bamboohr: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parseBambooHrPostingsFromApi,
    officialDocs: "https://documentation.bamboohr.com/reference/get-company-report-1",
    discover(company) {
      const parsed = asUrl(company.url_string);
      const baseOrigin = parsed ? parsed.origin : "";
      const boardUrl = clean(company.url_string).replace(/\/$/, "");
      return {
        config: { boardUrl, baseOrigin },
        listUrl: boardUrl ? `${boardUrl}/list` : ""
      };
    }
  },
  manatal: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parseManatalPostingsFromApi,
    officialDocs: "observed public careers-page JSON endpoint",
    discover(company) {
      const domainSlug = firstPathSegment(company.url_string) || hostSlug(company.url_string);
      return {
        config: {
          domainSlug,
          publicBaseUrl: "https://www.careers-page.com"
        },
        listUrl: domainSlug ? `https://www.careers-page.com/api/jobs/${encodeURIComponent(domainSlug)}/` : ""
      };
    }
  },
  recruitcrm: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parseRecruitCrmPostingsFromApi,
    officialDocs: "observed Recruit CRM public jobs endpoint",
    discover(company) {
      const config = parseRecruitCrmPublicCompany(company.url_string) || {};
      return {
        config,
        listUrl: config.apiUrl || ""
      };
    },
    fetchList: fetchRecruitCrmSourceList,
    postNormalize(normalized, posting) {
      if (clean(posting?.remote_type)) return {};
      return {
        remote_type: "unknown",
        is_remote: false
      };
    }
  },
  pinpointhq: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parsePinpointHqPostingsFromApi,
    officialDocs: "observed Pinpoint public postings JSON endpoint",
    discover(company) {
      const parsed = asUrl(company.url_string);
      const baseOrigin = parsed ? parsed.origin : "";
      const boardUrl = clean(company.url_string).replace(/\/$/, "");
      return {
        config: { boardUrl, baseOrigin },
        listUrl: boardUrl ? `${boardUrl}.json` : ""
      };
    }
  },
  fountain: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: parseFountainPostingsFromApi,
    officialDocs: "observed Fountain public openings JSON endpoint",
    discover(company) {
      const boardUrl = clean(company.url_string).replace(/\/$/, "");
      return {
        config: { boardUrl },
        listUrl: boardUrl ? `${boardUrl}.json` : ""
      };
    }
  },
  zoho: {
    sourceFamily: "embedded_json",
    confidence: 0.75,
    parser: parseZohoPostingsFromHtml,
    officialDocs: "observed Zoho Recruit public careers page embedded payload",
    discover(company) {
      const careersUrl = clean(company.url_string).replace(/\/$/, "");
      return {
        config: { careersUrl },
        listUrl: careersUrl
      };
    }
  },
  workday: {
    sourceFamily: "enterprise_api",
    confidence: 0.65,
    parser: parseWorkdayPostingsFromApi,
    fetchList: fetchWorkdaySourceList,
    officialDocs: "observed Workday CXS public jobs endpoint",
    discover(company) {
      const parsed = asUrl(company.url_string);
      const parts = parsePathParts(company.url_string);
      const jobsIndex = parts.findIndex((part) => part.toLowerCase() === "jobs");
      const site = jobsIndex > 0 ? parts[jobsIndex - 1] : parts[parts.length - 1] || "";
      const tenant = parsed?.hostname?.split(".")[0] || "";
      const origin = parsed ? parsed.origin : "";
      return {
        config: {
          tenant,
          site,
          companyBaseUrl: clean(company.url_string).replace(/\/+$/, "")
        },
        listUrl: origin && tenant && site ? `${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs` : ""
      };
    }
  },
  icims: {
    sourceFamily: "html_detail",
    confidence: 0.55,
    parser: (companyName, config, payload) => parseIcimsPostingsFromHtml(companyName, config, payload?.html || payload),
    officialDocs: "iCIMS Job Portal/Search API and public portal detail pages",
    fetchList: fetchIcimsSourceList,
    discover(company) {
      const route = parseIcimsPublicCompany(company.url_string);
      return {
        config: route
          ? {
              tenant: route.tenant,
              host: route.host,
              origin: route.origin,
              searchUrl: route.searchUrl,
              routeKind: "icims_public_portal"
            }
          : {},
        listUrl: route?.searchUrl || clean(company.url_string)
      };
    }
  },
  taleo: {
    sourceFamily: "brittle",
    confidence: 0.35,
    parser: parseTaleoSourcePayload,
    officialDocs: "observed Taleo careersection REST/AJAX public endpoints",
    fetchList: fetchTaleoSourceList,
    discover(company) {
      const url = clean(company.url_string);
      const parsed = asUrl(url);
      const lang = parsed?.searchParams?.get("lang") || "en";
      const baseSectionUrl = url.replace(/\/(?:jobsearch|jobdetail)\.ftl.*$/i, "");
      return {
        config: { baseSectionUrl, lang },
        listUrl: url
      };
    },
    postNormalize(normalized, posting) {
      const usefulGeo = hasUsefulGeoEvidence(normalized);
      const explicitWorkMode = taleoHasExplicitWorkMode(posting, normalized);
      const patch = {};
      if (!usefulGeo && !explicitWorkMode) {
        patch.remote_type = "unknown";
        patch.is_remote = false;
      }
      const finalPosting = { ...normalized, ...patch };
      const reasons = taleoSourceFailureReasons(posting, finalPosting);
      patch.source_failure_reasons = reasons;
      return patch;
    }
  },
  oracle: {
    sourceFamily: "enterprise_api",
    confidence: 0.65,
    parser: parseOraclePostingsFromApi,
    officialDocs: "Oracle HCM Candidate Experience public requisitions endpoint",
    discover(company) {
      const parsed = asUrl(company.url_string);
      const parts = parsePathParts(company.url_string);
      const languageIndex = parts.findIndex((part) => part.toLowerCase() === "candidateexperience");
      const language = languageIndex >= 0 ? parts[languageIndex + 1] || "en" : "en";
      const sitesIndex = parts.findIndex((part) => part.toLowerCase() === "sites");
      const siteNumber = sitesIndex >= 0 ? parts[sitesIndex + 1] || "CX_1" : "CX_1";
      const siteBaseUrl = parsed ? parsed.origin : "";
      return {
        config: {
          siteBaseUrl,
          language,
          siteNumber,
          boardUrl: clean(company.url_string)
        },
        listUrl: siteBaseUrl ? `${siteBaseUrl}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` : ""
      };
    }
  },
  paylocity: {
    sourceFamily: "enterprise_api",
    confidence: 0.65,
    parser: parsePaylocityPostingsFromPageData,
    officialDocs: "observed Paylocity public recruiting page data",
    discover(company) {
      const parsed = asUrl(company.url_string);
      const parts = parsePathParts(company.url_string);
      const companyId = parts[parts.length - 1] || "";
      return {
        config: {
          companyId,
          siteBaseUrl: parsed ? parsed.origin : ""
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  adp_workforcenow: {
    sourceFamily: "enterprise_api",
    confidence: 0.65,
    parser: parseAdpWorkforcenowPostingsFromApi,
    officialDocs: "observed ADP Workforce Now public recruitment endpoint",
    discover(company) {
      return {
        config: {
          cid: queryParam(company.url_string, "cid"),
          ccId: queryParam(company.url_string, "ccId"),
          boardUrl: clean(company.url_string)
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  adp_myjobs: {
    sourceFamily: "enterprise_api",
    confidence: 0.6,
    parser: parseAdpMyjobsPostingsFromApi,
    officialDocs: "observed ADP MyJobs public requisitions endpoint",
    discover(company) {
      const companyName = firstPathSegment(company.url_string) || hostSlug(company.url_string);
      return {
        config: {
          companyName,
          boardUrl: clean(company.url_string)
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  ultipro: {
    sourceFamily: "enterprise_api",
    confidence: 0.55,
    parser: parseUltiProPostingsFromApi,
    officialDocs: "observed UKG/UltiPro public JobBoard LoadSearchResults endpoint",
    discover(company) {
      const parts = parsePathParts(company.url_string);
      const tenant = parts[0] || "";
      const boardId = parts.find((part) => /^[0-9a-f-]{12,}$/i.test(part)) || parts[2] || "";
      const boardUrl = clean(company.url_string).replace(/\/+$/, "");
      return {
        config: {
          tenant,
          boardId,
          tenantLower: tenant.toLowerCase(),
          baseBoardUrl: boardUrl
        },
        listUrl: tenant && boardId ? `https://recruiting.ultipro.com/${encodeURIComponent(tenant)}/JobBoard/${encodeURIComponent(boardId)}/JobBoardView/LoadSearchResults` : boardUrl
      };
    }
  },
  pageup: {
    sourceFamily: "html_detail",
    confidence: 0.55,
    parser: (companyName, config, payload) => parsePageupPostingsFromResults(companyName, config, payload?.html || payload),
    officialDocs: "observed PageUp public job listing pages",
    discover(company) {
      const parsed = asUrl(company.url_string);
      return {
        config: {
          baseOrigin: parsed ? parsed.origin : "",
          boardUrl: clean(company.url_string)
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  saphrcloud: {
    sourceFamily: "enterprise_api",
    confidence: 0.55,
    parser: parseSapHrCloudPostingsFromApi,
    officialDocs: "observed SAP SuccessFactors Recruiting Marketing public search payload",
    discover(company) {
      const parsed = asUrl(company.url_string);
      return {
        config: {
          baseOrigin: parsed ? parsed.origin : "",
          boardUrl: clean(company.url_string),
          localeFromUrl: queryParam(company.url_string, "locale") || "en_US"
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  brassring: {
    sourceFamily: "brittle",
    confidence: 0.35,
    parser: parseBrassringPostingsFromApi,
    officialDocs: "observed BrassRing public TGNewUI search API",
    discover(company) {
      const partnerId = queryParam(company.url_string, "partnerid");
      const siteId = queryParam(company.url_string, "siteid");
      return {
        config: {
          partnerId,
          siteId,
          boardUrl: clean(company.url_string)
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  applitrack: {
    sourceFamily: "public_sector",
    confidence: 0.55,
    parser: (companyName, config, payload) => parseApplitrackPostings(payload?.html || payload, config.siteRoot, companyName),
    officialDocs: "observed Applitrack Output.asp list and JobPostings/view.asp detail pages",
    fetchList: fetchApplitrackSourceList,
    discover(company) {
      const siteRoot = applitrackSiteRoot(company.url_string);
      return {
        config: { siteRoot },
        listUrl: siteRoot ? new URL("jobpostings/Output.asp?all=1", siteRoot).toString() : ""
      };
    }
  },
  hirebridge: {
    sourceFamily: "html_detail",
    confidence: 0.45,
    parser: (companyName, config, payload) => parseHirebridgePostingsFromHtml(companyName, config, payload?.html || payload),
    officialDocs: "observed Hirebridge public list HTML and detail pages",
    discover(company) {
      const parsed = asUrl(company.url_string);
      return {
        config: {
          baseOrigin: parsed ? parsed.origin : "",
          cid: queryParam(company.url_string, "cid"),
          detailsBaseUrl: parsed ? `${parsed.origin}/v3/CareerCenter/v2/details.aspx` : ""
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  jobvite: {
    sourceFamily: "html_detail",
    confidence: 0.55,
    parser: (companyName, config, payload) => parseJobvitePostingsFromHtml(companyName, config, payload?.html || payload),
    officialDocs: "observed Jobvite public job-list HTML",
    discover(company) {
      const parsed = asUrl(company.url_string);
      return {
        config: {
          baseOrigin: parsed ? parsed.origin : ""
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  careerplug: {
    sourceFamily: "html_detail",
    confidence: 0.75,
    parser: (companyName, config, payload) => parseCareerplugPostingsFromHtml(companyName, config, payload?.html || payload),
    officialDocs: "observed CareerPlug public jobs HTML",
    discover(company) {
      const parsed = asUrl(company.url_string);
      return {
        config: {
          baseOrigin: parsed ? parsed.origin : ""
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  talentreef: {
    sourceFamily: "html_detail",
    confidence: 0.55,
    parser: parseTalentreefPostingsFromSearchResponse,
    officialDocs: "observed TalentReef public career-page alias and posting search response",
    discover(company) {
      const parsed = asUrl(company.url_string);
      const companyName = firstPathSegment(company.url_string);
      return {
        config: {
          baseOrigin: parsed ? parsed.origin : "",
          companyName,
          boardUrl: clean(company.url_string)
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  hrmdirect: {
    sourceFamily: "html_detail",
    confidence: 0.75,
    parser: (companyName, config, payload) => parseHrmDirectPostingsFromHtml(companyName, config, payload),
    fetchList: fetchHrmDirectSourceList,
    officialDocs: "observed HRMDirect public job-openings table HTML",
    discover(company) {
      const parsed = asUrl(company.url_string);
      return {
        config: {
          baseOrigin: parsed ? parsed.origin : ""
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  breezy: {
    sourceFamily: "html_detail",
    confidence: 0.75,
    parser: (companyName, config, payload) => parseBreezyPostingsFromHtml(companyName, config, payload),
    fetchList: fetchBreezySourceList,
    officialDocs: "observed Breezy public portal HTML",
    discover(company) {
      const parsed = asUrl(company.url_string);
      return {
        config: {
          origin: parsed ? parsed.origin : ""
        },
        listUrl: clean(company.url_string)
      };
    },
    postNormalize(normalized, posting) {
      const sourceEvidence = {
        ...(posting?.source_evidence || {}),
        ...(normalized?.source_evidence || {})
      };
      if (clean(sourceEvidence.remote_source || sourceEvidence.remote_path)) return {};
      if (!["remote", "hybrid", "onsite"].includes(clean(normalized.remote_type).toLowerCase())) return {};
      return {
        remote_type: "unknown",
        is_remote: false,
        source_evidence: {
          ...sourceEvidence,
          remote_source: "",
          remote_path: "",
          remote_rule_name: ""
        }
      };
    }
  },
  applytojob: {
    sourceFamily: "html_detail",
    confidence: 0.75,
    parser: (companyName, config, payload) => parseApplyToJobPostingsFromHtml(companyName, config, payload),
    fetchList: fetchApplyToJobSourceList,
    officialDocs: "observed ApplyToJob public list HTML",
    discover(company) {
      const parsed = asUrl(company.url_string);
      return {
        config: {
          baseOrigin: parsed ? parsed.origin : ""
        },
        listUrl: clean(company.url_string)
      };
    }
  }
});

function getSourceSpec(atsKey) {
  return SOURCE_SPECS[clean(atsKey).toLowerCase()] || null;
}

function createSourceModule(atsKey) {
  const key = clean(atsKey).toLowerCase();
  const spec = getSourceSpec(key);
  if (!spec) throw new Error(`unknown direct source module ${atsKey}`);
  const parserVersion = `source-${key}-v1`;

  function discover(company = {}) {
    const context = buildCompanyContext(company);
    const discovered = spec.discover(context) || {};
    return {
      ats_key: key,
      source_family: spec.sourceFamily || (key === "zoho" ? "embedded_json" : "direct_json"),
      docs_url: spec.officialDocs,
      company: context,
      list_url: clean(discovered.listUrl),
      config: discovered.config || {},
      parser_version: parserVersion
    };
  }

  async function fetchList(company = {}, options = {}) {
    const target = discover(company);
    if (typeof spec.fetchList === "function") {
      return spec.fetchList(buildCompanyContext(company), target, options);
    }
    if (!target.list_url) {
      return {
        __legacyParsed: await collectPostingsForCompany({
          ...company,
          ATS_name: company?.ATS_name || key
        }),
        __sourceConfig: target.config
      };
    }
    const payload = options.fetcher
      ? await options.fetcher(target.list_url, target)
      : await fetchJson(target.list_url, options.fetchOptions || {});
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return { ...payload, __sourceConfig: target.config };
    }
    return payload;
  }

  async function fetchDetail() {
    return null;
  }

  function parse(rawPayload, company = {}) {
    if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
    const target = discover(company);
    const config = rawPayload?.__sourceConfig || target.config || {};
    const payload = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
      ? Object.fromEntries(Object.entries(rawPayload).filter(([name]) => name !== "__sourceConfig"))
      : rawPayload;
    return spec.parser(normalizeCompanyName(company, config.companySlug || config.boardTokenLower || key), config, payload);
  }

  function normalize(posting, company = {}, options = {}) {
    const normalized = normalizePosting(posting, company, key, {
      parserVersion,
      confidence: options.confidence || spec.confidence || DEFAULT_PARSER_CONFIDENCE,
      ...options
    });
    normalized.parser_key = key;
    normalized.parser_version = parserVersion;
    normalized.parser_confidence = Number(normalized.parser_confidence || spec.confidence || DEFAULT_PARSER_CONFIDENCE);
    normalized.confidence_score = normalized.parser_confidence;
    normalized.canonical_url = canonicalizePostingUrl(normalized.canonical_url || normalized.job_posting_url);
    normalized.job_posting_url = normalized.canonical_url;
    normalized.apply_url = canonicalizePostingUrl(normalized.apply_url || normalized.canonical_url);
    normalized.source_family = spec.sourceFamily || (key === "zoho" ? "embedded_json" : "direct_json");
    normalized.evidence = buildEvidenceMetadata(normalized, { parserVersion, sourceFamily: normalized.source_family });
    normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
      sourceFamily: normalized.source_family,
      detailSupported: typeof spec.fetchDetail === "function" || ["enterprise_api", "html_detail", "public_sector", "brittle"].includes(normalized.source_family)
    });
    if (typeof spec.postNormalize === "function") {
      const patch = spec.postNormalize(normalized, posting, company, options) || {};
      Object.assign(normalized, patch);
      normalized.evidence = buildEvidenceMetadata(normalized, { parserVersion, sourceFamily: normalized.source_family });
      normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
        sourceFamily: normalized.source_family,
        detailSupported: typeof spec.fetchDetail === "function" || ["enterprise_api", "html_detail", "public_sector", "brittle"].includes(normalized.source_family)
      });
    }
    return normalized;
  }

  function validate(posting) {
    const basic = validatePosting(posting);
    if (!basic.ok) return basic;
    const contract = validateNormalizedPostingContract(posting);
    if (!contract.ok) return contract;
    if (!clean(posting?.source_job_id)) {
      return { ok: false, error: "missing source_job_id", status: "quarantined" };
    }
    return { ok: true, error: "", status: "valid" };
  }

  function validatePublic(posting) {
    return evaluatePublicPosting(posting, { parserVersion });
  }

  function rateLimit() {
    return ["enterprise_api", "html_detail", "public_sector", "brittle"].includes(spec.sourceFamily)
      ? ENTERPRISE_RATE_LIMIT
      : DEFAULT_RATE_LIMIT;
  }

  function qualityThreshold() {
    return {
      parse_success_minimum_pct: spec.sourceFamily === "brittle" ? 90 : 95,
      max_batch_bad_row_pct: spec.sourceFamily === "brittle" ? 10 : 5,
      requires_title_company_canonical_url: true,
      public_requires_geo_or_explicit_remote: true,
      ambiguous_rows: "quarantine"
    };
  }

  function fixtures() {
    return [
      `server/ingestion/sources/${key}/fixtures/list.json`,
      `server/ingestion/sources/${key}/fixtures/expected-normalized.json`,
      `server/ingestion/sources/${key}/fixtures/invalid-shapes.json`
    ];
  }

  return {
    atsKey: key,
    key,
    parserVersion,
    discover,
    fetchList,
    fetchDetail,
    parse,
    normalize,
    validate,
    validatePublic,
    rateLimit,
    qualityThreshold,
    fixtures
  };
}

module.exports = {
  SOURCE_SPECS,
  createSourceModule,
  getSourceSpec
};
