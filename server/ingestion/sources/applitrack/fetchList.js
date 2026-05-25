"use strict";

const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const {
  buildApplitrackDetailUrl,
  extractApplitrackDetailFields,
  parseApplitrackPostings
} = require("./parse");
const {
  applitrackSiteRoot,
  buildCompanyContext,
  clean
} = require("./discover");

const APPLITRACK_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

function hostSlug(value) {
  try {
    return String(new URL(clean(value)).hostname || "").split(".").filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}

function normalizeCompanyName(company, fallback) {
  return clean(company?.company_name || company?.companyName || company?.name || fallback);
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

async function fetchText(url, options = {}) {
  const target = {
    ...(options.target || {}),
    method: "GET",
    headers: {
      Accept: APPLITRACK_ACCEPT,
      ...(options.target?.headers || {})
    }
  };
  if (typeof options.fetcher === "function") {
    const response = await options.fetcher(url, target);
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

  const response = await safeFetch(url, {
    ...(options.fetchOptions || {}),
    method: "GET",
    headers: {
      accept: APPLITRACK_ACCEPT,
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(options.fetchOptions?.headers || {})
    }
  });
  if (!response.ok) {
    const code = classifyPublicRouteStatus(response.status, "fetch_failed");
    const sourceLabel = clean(options.sourceLabel || "Applitrack");
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

function applitrackDetailLimit(options = {}) {
  const value = Number(
    options.maxApplitrackDetailFetches ??
    process.env.OPENJOBSLOTS_APPLITRACK_DETAIL_FETCH_LIMIT_PER_COMPANY ??
    25
  );
  if (!Number.isFinite(value)) return 25;
  return Math.max(0, Math.min(100, Math.floor(value)));
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const discovered = options.target && options.target.list_url ? options.target : discover(context);
    const siteRoot = clean(discovered?.config?.siteRoot || applitrackSiteRoot(context.url_string));
    if (!siteRoot) {
      throw makeSourceFetchError("no_public_output_route", "Applitrack source has no public Output.asp route", {
        url: context.url_string
      });
    }

    const listUrl = clean(discovered.list_url) || new URL("jobpostings/Output.asp?all=1", siteRoot).toString();
    const list = await fetchText(listUrl, {
      ...options,
      target: discovered,
      sourceLabel: "Applitrack"
    });
    const companyName = normalizeCompanyName(context, hostSlug(siteRoot) || "Applitrack");
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

    const detailLimit = applitrackDetailLimit(options);
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
  };
}

module.exports = {
  APPLITRACK_ACCEPT,
  applitrackDetailLimit,
  createFetchList
};
