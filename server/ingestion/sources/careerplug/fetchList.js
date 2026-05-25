const { readLimitedResponseText, safeFetch } = require("../../safeFetch");
const {
  asUrl,
  buildCompanyContext,
  clean,
  makeSourceFetchError,
  normalizeCompanyName
} = require("./helpers");
const {
  normalizeCareerplugCanonicalJobUrl,
  parseCareerplugPostingsFromHtml
} = require("./parse");

const CAREERPLUG_DEFAULT_DETAIL_LIMIT = 30;
const CAREERPLUG_DEFAULT_DETAIL_DELAY_MS = 150;

function shouldFetchCareerplugDetail(posting) {
  if (!posting) return false;
  if (!clean(posting.posting_date)) return true;
  if (!clean(posting.location) || !clean(posting.country) || !clean(posting.city)) return true;
  return false;
}

function careerplugDetailLimit(options = {}) {
  const value = Number(
    options.maxCareerplugDetailFetches ??
    process.env.OPENJOBSLOTS_CAREERPLUG_DETAIL_LIMIT ??
    CAREERPLUG_DEFAULT_DETAIL_LIMIT
  );
  if (!Number.isFinite(value)) return CAREERPLUG_DEFAULT_DETAIL_LIMIT;
  return Math.max(0, Math.min(250, Math.floor(value)));
}

function careerplugDetailDelayMs(options = {}) {
  const value = Number(
    options.careerplugDetailDelayMs ??
    process.env.OPENJOBSLOTS_CAREERPLUG_DETAIL_DELAY_MS ??
    CAREERPLUG_DEFAULT_DETAIL_DELAY_MS
  );
  if (!Number.isFinite(value)) return CAREERPLUG_DEFAULT_DETAIL_DELAY_MS;
  return Math.max(0, Math.min(5000, Math.floor(value)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCareerplugText(url, options = {}) {
  if (typeof options.fetcher === "function") {
    const response = await options.fetcher(url, options.target || {});
    if (typeof response === "string") return { text: response, status: 200, finalUrl: url };
    if (response && typeof response === "object") {
      if (typeof response.text === "function") {
        return {
          text: await response.text(),
          status: Number(response.status || 200),
          finalUrl: response.url || url
        };
      }
      return {
        text: String(response.html || response.body || response.text || ""),
        status: Number(response.status || 200),
        finalUrl: response.url || url
      };
    }
    return { text: String(response || ""), status: 200, finalUrl: url };
  }

  const response = await safeFetch(url, {
    ...(options.fetchOptions || {}),
    headers: {
      accept: "text/html,application/xhtml+xml,application/ld+json;q=0.8,*/*;q=0.5",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(options.fetchOptions?.headers || {})
    }
  });
  return {
    text: await readLimitedResponseText(response, { sourceUrl: response.url || url }),
    status: Number(response.status || 200),
    finalUrl: response.url || url
  };
}

function mergeCareerplugDetailPosting(listPosting, detailPosting, detailUrl) {
  if (!detailPosting) return listPosting;
  const listEvidence = listPosting.source_evidence || {};
  const detailEvidence = detailPosting.source_evidence || {};
  return {
    ...listPosting,
    position_name: listPosting.position_name || detailPosting.position_name,
    job_posting_url: listPosting.job_posting_url || detailPosting.job_posting_url,
    source_job_id: listPosting.source_job_id || detailPosting.source_job_id,
    posting_date: detailPosting.posting_date || listPosting.posting_date || null,
    location: detailPosting.location || listPosting.location || null,
    city: detailPosting.city || listPosting.city || null,
    state: detailPosting.state || listPosting.state || null,
    country: detailPosting.country || listPosting.country || null,
    employment_type: listPosting.employment_type || detailPosting.employment_type || null,
    source_evidence: {
      ...listEvidence,
      ...detailEvidence,
      route_kind: "careerplug_jobs_html_with_json_ld_detail",
      detail_url: detailUrl || detailEvidence.detail_url || "",
      list_location_source: listEvidence.location_source || "",
      list_location_path: listEvidence.location_path || "",
      list_location_rule_name: listEvidence.location_rule_name || ""
    }
  };
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const context = buildCompanyContext(company);
    const target = options.target && options.target.list_url ? options.target : discover(context);
    const listUrl = clean(target?.list_url || context.url_string).replace(/\/$/, "");
    if (!listUrl) {
      return {
        __legacyParsed: [],
        html: "",
        detail_fetch_count: 0,
        __sourceConfig: { baseOrigin: "" }
      };
    }

    const parsedBoard = asUrl(listUrl);
    const config = {
      ...(target.config || {}),
      baseOrigin: parsedBoard ? parsedBoard.origin : target.config?.baseOrigin || ""
    };
    const list = await fetchCareerplugText(listUrl, {
      ...options,
      target
    });
    if (list.status >= 400) {
      throw makeSourceFetchError("fetch_failed", `CareerPlug public jobs route failed with HTTP ${list.status}`, {
        status: list.status,
        url: list.finalUrl || listUrl
      });
    }
    const companyName = normalizeCompanyName(context, config.subdomainLower || "CareerPlug");
    const listPostings = parseCareerplugPostingsFromHtml(companyName, config, list.text);
    const maxDetails = careerplugDetailLimit(options);
    const detailDelayMs = typeof options.fetcher === "function" ? 0 : careerplugDetailDelayMs(options);
    let detailFetches = 0;
    const enriched = [];

    for (const posting of listPostings) {
      if (!shouldFetchCareerplugDetail(posting) || detailFetches >= maxDetails) {
        enriched.push(posting);
        continue;
      }
      detailFetches += 1;
      try {
        if (detailFetches > 1 && detailDelayMs > 0) await delay(detailDelayMs);
        const detailUrl = normalizeCareerplugCanonicalJobUrl(posting.job_posting_url, config);
        const detail = await fetchCareerplugText(detailUrl, {
          ...options,
          target
        });
        if (detail.status >= 400) {
          enriched.push({
            ...posting,
            source_failure_reasons: [
              ...(posting.source_failure_reasons || []),
              detail.status === 404 || detail.status === 410 ? "detail_404_or_410" : "detail_fetch_failed"
            ]
          });
          continue;
        }
        const detailParsed = parseCareerplugPostingsFromHtml(companyName, config, detail.text)
          .find((item) => item.source_job_id === posting.source_job_id) || null;
        enriched.push(mergeCareerplugDetailPosting(posting, detailParsed, detail.finalUrl || detailUrl));
      } catch (error) {
        enriched.push({
          ...posting,
          source_failure_reasons: [
            ...(posting.source_failure_reasons || []),
            error.status === 404 || error.status === 410 ? "detail_404_or_410" : "detail_fetch_failed"
          ]
        });
      }
    }

    return {
      __legacyParsed: enriched,
      html: list.text,
      detail_fetch_count: detailFetches,
      __sourceConfig: config
    };
  };
}

module.exports = {
  careerplugDetailLimit,
  createFetchList
};
