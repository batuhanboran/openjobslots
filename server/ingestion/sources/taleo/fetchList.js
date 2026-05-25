const { safeFetch } = require("../../safeFetch");
const { hasUsefulGeoEvidence } = require("../../publicPostingGate");
const {
  extractTaleoPostingsFromAjax,
  extractTaleoPostingsFromRest
} = require("./parse");
const { buildCompanyContext, clean, createDiscover } = require("./discover");

const DEFAULT_TALEO_MAX_PAGES = 25;

function hostSlug(urlString) {
  try {
    const parsed = new URL(urlString);
    return clean(parsed.hostname.split(".")[0]);
  } catch {
    return "";
  }
}

function normalizeCompanyName(company = {}, fallback = "Taleo") {
  return clean(company.company_name || company.name || company.company || fallback) || fallback;
}

function makeSourceFetchError(reason, message, details = {}) {
  const error = new Error(message);
  error.ingestionErrorType = reason;
  Object.assign(error, details);
  return error;
}

function classifyPublicRouteStatus(status, fallback = "unsupported_tenant_shape") {
  const value = Number(status || 0);
  if (value === 401 || value === 403 || value === 429) return "blocked_or_rate_limited";
  if (value === 404 || value === 410) return "no_public_portal_route";
  if (value >= 500) return "network_or_server_error";
  return fallback;
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

function extractTaleoRestConfig(pageHtml) {
  const source = String(pageHtml || "");
  const portalMatch = source.match(/portal=([0-9]{6,})/i);
  const portal = clean(portalMatch?.[1]);

  const tokenNamePatterns = [
    /sessionCSRFTokenName\s*:\s*'([^']+)'/i,
    /sessionCSRFTokenName\s*:\s*"([^"]+)"/i,
    /"sessionCSRFTokenName"\s*:\s*"([^"]+)"/i,
    /name=['"](csrftoken)['"]/i
  ];
  const tokenValuePatterns = [
    /sessionCSRFToken\s*:\s*'([^']+)'/i,
    /sessionCSRFToken\s*:\s*"([^"]+)"/i,
    /"sessionCSRFToken"\s*:\s*"([^"]+)"/i,
    /name=["']csrftoken["'][^>]*value=["']([^"']+)["']/i
  ];

  let tokenName = "";
  let tokenValue = "";

  for (const pattern of tokenNamePatterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    tokenName = clean(match[1]);
    if (tokenName) break;
  }

  for (const pattern of tokenValuePatterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    tokenValue = clean(match[1]);
    if (tokenValue) break;
  }

  return { portal, tokenName, tokenValue };
}

function buildTaleoRestPayload(pageNo = 1) {
  return {
    multilineEnabled: true,
    sortingSelection: {
      sortBySelectionParam: "1",
      ascendingSortingOrder: "false"
    },
    fieldData: {
      fields: {
        LOCATION: "",
        CATEGORY: "",
        KEYWORD: ""
      },
      valid: true
    },
    filterSelectionParam: {
      searchFilterSelections: [
        { id: "JOB_FIELD", selectedValues: [] },
        { id: "LOCATION", selectedValues: [] },
        { id: "ORGANIZATION", selectedValues: [] },
        { id: "JOB_LEVEL", selectedValues: [] }
      ]
    },
    advancedSearchFiltersSelectionParam: {
      searchFilterSelections: [
        { id: "ORGANIZATION", selectedValues: [] },
        { id: "LOCATION", selectedValues: [] },
        { id: "JOB_FIELD", selectedValues: [] },
        { id: "JOB_NUMBER", selectedValues: [] },
        { id: "URGENT_JOB", selectedValues: [] },
        { id: "JOB_SHIFT", selectedValues: [] }
      ]
    },
    pageNo: Number(pageNo || 1)
  };
}

function buildTaleoAjaxPayload(lang = "en", csrfToken = "") {
  const payload = {
    ftlpageid: "reqListBasicPage",
    ftlinterfaceid: "requisitionListInterface",
    ftlcompid: "validateTimeZoneId",
    jsfCmdId: "validateTimeZoneId",
    ftlcompclass: "InitTimeZoneAction",
    ftlcallback: "requisition_restoreDatesValues",
    ftlajaxid: "ftlx1",
    tz: "GMT-07:00",
    tzname: "America/Los_Angeles",
    lang: clean(lang) || "en",
    isExternal: "true",
    "rlPager.currentPage": "1",
    "listRequisition.size": "25",
    dropListSize: "25"
  };

  if (csrfToken) payload.csrftoken = clean(csrfToken);
  return payload;
}

function responseStatus(payload) {
  return Number(payload?.status || payload?.statusCode || 200);
}

async function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "function") return payload.text();
  if (typeof payload?.body === "string") return payload.body;
  if (typeof payload?.html === "string") return payload.html;
  if (typeof payload?.data === "string") return payload.data;
  return "";
}

async function payloadToJson(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && !("body" in payload) && !("html" in payload)) {
    return payload;
  }
  const text = await payloadToText(payload);
  if (!text) return {};
  return JSON.parse(text);
}

async function fetchText(url, target, options = {}) {
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError(classifyPublicRouteStatus(status), `Taleo page request failed (${status})`, {
        status,
        url
      });
    }
    return payloadToText(payload);
  }

  const res = await safeFetch(url, target);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Taleo page request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  return res.text();
}

async function fetchJson(url, target, options = {}) {
  if (typeof options.fetcher === "function") {
    const payload = await options.fetcher(url, target);
    const status = responseStatus(payload);
    if (status < 200 || status >= 300) {
      throw makeSourceFetchError(classifyPublicRouteStatus(status), `Taleo REST request failed (${status})`, {
        status,
        url
      });
    }
    return payloadToJson(payload);
  }

  const res = await safeFetch(url, target);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Taleo REST request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  return res.json();
}

function createFetchList(dependencies = {}) {
  const discover = typeof dependencies.discover === "function" ? dependencies.discover : createDiscover();

  return async function fetchTaleoSourceList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = discover(context);
    const config = discovered?.config || {};
    const listUrl = clean(discovered?.list_url || context.url_string);
    if (!config.baseSectionUrl || !listUrl) {
      throw makeSourceFetchError("no_public_portal_route", "Taleo company URL is not a supported public careersection route", {
        url: listUrl
      });
    }

    const companyName = normalizeCompanyName(context, config.careerSectionLower || hostSlug(listUrl) || "Taleo");
    const maxPages = Math.max(1, Math.min(100, Number(options.maxTaleoPages || DEFAULT_TALEO_MAX_PAGES)));
    const postings = [];
    const seenUrls = new Set();
    let restPagesFetched = 0;
    let ajaxFetched = false;

    try {
      const pageHtml = await fetchText(listUrl, {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml"
        }
      }, options);
      const { portal, tokenName, tokenValue } = extractTaleoRestConfig(pageHtml);

      if (portal) {
        for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
          const apiUrl = `${config.baseOrigin}/careersection/rest/jobboard/searchjobs?lang=${encodeURIComponent(
            config.lang || "en"
          )}&portal=${encodeURIComponent(portal)}`;
          const headers = {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/json",
            "x-requested-with": "XMLHttpRequest",
            tz: "GMT-07:00",
            tzname: "America/Los_Angeles"
          };
          if (tokenName && tokenValue) headers[tokenName] = tokenValue;
          const response = await fetchJson(apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(buildTaleoRestPayload(pageNo))
          }, options);
          restPagesFetched += 1;
          const requisitions = Array.isArray(response?.requisitionList) ? response.requisitionList : [];
          if (requisitions.length === 0) break;

          for (const posting of extractTaleoPostingsFromRest(companyName, config, requisitions)) {
            if (seenUrls.has(posting.job_posting_url)) continue;
            seenUrls.add(posting.job_posting_url);
            postings.push(posting);
          }

          const pagingData = response?.pagingData && typeof response.pagingData === "object" ? response.pagingData : {};
          const totalCount = Number(pagingData?.totalCount);
          const pageSizeRaw = Number(pagingData?.pageSize);
          const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : requisitions.length;
          if (requisitions.length < pageSize) break;
          if (Number.isFinite(totalCount) && pageNo * pageSize >= totalCount) break;
        }
      }

      if (postings.length === 0) {
        const ajaxUrl = `${config.baseSectionUrl}/jobsearch.ajax`;
        const ajaxText = await fetchText(ajaxUrl, {
          method: "POST",
          headers: {
            Accept: "*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            "x-requested-with": "XMLHttpRequest",
            tz: "GMT-07:00",
            tzname: "America/Los_Angeles"
          },
          body: new URLSearchParams(buildTaleoAjaxPayload(config.lang, tokenValue)).toString()
        }, options);
        ajaxFetched = true;
        for (const posting of extractTaleoPostingsFromAjax(companyName, config, ajaxText)) {
          if (seenUrls.has(posting.job_posting_url)) continue;
          seenUrls.add(posting.job_posting_url);
          postings.push(posting);
        }
      }
    } catch (error) {
      error.ingestionErrorType = error.ingestionErrorType || classifyTaleoFetchError(error);
      throw error;
    }

    const enriched = postings.map((posting) => ({
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
        route_kind: "taleo_careersection_rest_or_ajax",
        rest_pages_fetched: restPagesFetched,
        ajax_fetched: ajaxFetched
      }
    };
  };
}

module.exports = {
  buildTaleoAjaxPayload,
  buildTaleoRestPayload,
  classifyTaleoFetchError,
  createFetchList,
  extractTaleoRestConfig,
  isTaleoAmbiguousLocation,
  parseTaleoSourcePayload,
  taleoHasExplicitWorkMode,
  taleoSourceFailureReasons
};
