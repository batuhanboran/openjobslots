const { parseAshbyPostingsFromApi } = require("./ashby/parse");
const { parseLeverPostingsFromApi } = require("./lever/parse");
const { parseSapHrCloudPostingsFromApi } = require("./saphrcloud/parse");
const { parseUltiProPostingsFromApi } = require("./ultipro/parse");
const { parseWorkdayPostingsFromApi } = require("./workday/parse");
const { validateNormalizedPostingContract } = require("../parserContract");
const { buildEvidenceMetadata, evaluatePublicPosting } = require("../publicPostingGate");
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
let legacyCollectPostingsForCompany = null;

function setLegacyCollectPostingsForCompany(collector) {
  legacyCollectPostingsForCompany = typeof collector === "function" ? collector : null;
}

async function collectPostingsForCompany(company) {
  if (typeof legacyCollectPostingsForCompany === "function") {
    return legacyCollectPostingsForCompany(company);
  }
  throw makeSourceFetchError(
    "legacy_collector_unavailable",
    "Legacy source collector fallback is not configured for this source module."
  );
}

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
    parser: () => [],
    officialDocs: "https://developer.greenhouse.io/job-board.html",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
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
    parser: () => [],
    officialDocs: "https://developers.smartrecruiters.com/docs/endpoints",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  recruitee: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: () => [],
    officialDocs: "https://docs.recruitee.com/reference/intro-to-careers-site-api",
    discover() {
      return {
        config: {},
        listUrl: ""
      };
    }
  },
  bamboohr: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: () => [],
    officialDocs: "https://documentation.bamboohr.com/reference/get-company-report-1",
    discover(company) {
      const parsed = asUrl(company.url_string);
      const baseOrigin = parsed ? parsed.origin : "";
      const boardUrl = clean(company.url_string).replace(/\/+$/, "");
      return {
        config: { boardUrl, baseOrigin },
        listUrl: clean(company.url_string)
      };
    }
  },
  manatal: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    parser: () => [],
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
    parser: () => [],
    officialDocs: "observed Recruit CRM public jobs endpoint",
    discover() {
      return {
        config: {},
        listUrl: ""
      };
    },
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
    parser: () => [],
    officialDocs: "observed Pinpoint public postings JSON endpoint",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  fountain: {
    sourceFamily: "direct_json",
    confidence: 0.75,
    officialDocs: "observed Fountain public openings JSON endpoint",
    discover(company) {
      return {
        config: {},
        listUrl: ""
      };
    }
  },
  isolvisolvedhire: {
    sourceFamily: "direct_json",
    confidence: 0.65,
    parser: () => [],
    officialDocs: "observed isolvedhire public jobs endpoint",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  zoho: {
    sourceFamily: "embedded_json",
    confidence: 0.75,
    parser: () => [],
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
    parser: () => [],
    officialDocs: "iCIMS Job Portal/Search API and public portal detail pages",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  taleo: {
    sourceFamily: "brittle",
    confidence: 0.35,
    parser: () => [],
    officialDocs: "observed Taleo careersection REST/AJAX public endpoints",
    discover(company) {
      const url = clean(company.url_string);
      return {
        config: {},
        listUrl: url
      };
    }
  },
  oracle: {
    sourceFamily: "enterprise_api",
    confidence: 0.65,
    parser: () => [],
    officialDocs: "Oracle HCM Candidate Experience public requisitions endpoint",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  paylocity: {
    sourceFamily: "enterprise_api",
    confidence: 0.65,
    parser: () => [],
    officialDocs: "observed Paylocity public recruiting page data",
    discover(company) {
      const parsed = asUrl(company.url_string);
      return {
        config: {
          siteBaseUrl: parsed ? parsed.origin : ""
        },
        listUrl: clean(company.url_string)
      };
    }
  },
  adp_workforcenow: {
    sourceFamily: "enterprise_api",
    confidence: 0.65,
    parser: () => [],
    officialDocs: "observed ADP Workforce Now public recruitment endpoint",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  adp_myjobs: {
    sourceFamily: "enterprise_api",
    confidence: 0.6,
    parser: () => [],
    officialDocs: "observed ADP MyJobs public requisitions endpoint",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  eightfold: {
    sourceFamily: "enterprise_api",
    confidence: 0.55,
    parser: () => [],
    officialDocs: "observed Eightfold careers HTML plus search API",
    discover(company) {
      return {
        config: {},
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
    parser: () => [],
    officialDocs: "observed PageUp public job listing pages",
    discover(company) {
      return {
        config: {},
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
    parser: () => [],
    officialDocs: "observed BrassRing public TGNewUI search API",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  applitrack: {
    sourceFamily: "public_sector",
    confidence: 0.55,
    officialDocs: "observed Applitrack Output.asp list and JobPostings/view.asp detail pages",
    discover(company) {
      return {
        config: {},
        listUrl: ""
      };
    }
  },
  hirebridge: {
    sourceFamily: "html_detail",
    confidence: 0.45,
    parser: () => [],
    officialDocs: "observed Hirebridge public list HTML and detail pages",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  jobvite: {
    sourceFamily: "html_detail",
    confidence: 0.55,
    parser: () => [],
    officialDocs: "observed Jobvite public job-list HTML",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  loxo: {
    sourceFamily: "html_detail",
    confidence: 0.55,
    parser: () => [],
    officialDocs: "observed Loxo public jobs HTML",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  careerspage: {
    sourceFamily: "html_detail",
    confidence: 0.55,
    parser: () => [],
    officialDocs: "observed CareersPage public jobs HTML",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  careerplug: {
    sourceFamily: "html_detail",
    confidence: 0.75,
    parser: () => [],
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
    parser: () => [],
    officialDocs: "observed TalentReef public career-page alias and posting search response",
    discover(company) {
      return {
        config: {},
        listUrl: clean(company.url_string)
      };
    }
  },
  hrmdirect: {
    sourceFamily: "html_detail",
    confidence: 0.75,
    parser: () => [],
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
    payloadShapePolicy: Object.freeze({
      optional_enrichment_prefixes: Object.freeze(["__json"])
    }),
    parser: () => [],
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
    parser: () => [],
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
    payloadShapePolicy: spec.payloadShapePolicy || Object.freeze({}),
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
  getSourceSpec,
  setLegacyCollectPostingsForCompany
};
