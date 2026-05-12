const {
  collectPostingsForCompany,
  extractTaleoPostingsFromRest,
  parseAshbyPostingsFromApi,
  parseBambooHrPostingsFromApi,
  parseAdpMyjobsPostingsFromApi,
  parseAdpWorkforcenowPostingsFromApi,
  parseBrassringPostingsFromApi,
  parseFountainPostingsFromApi,
  parseGreenhousePostingsFromApi,
  parseIcimsPostingsFromHtml,
  parseLeverPostingsFromApi,
  parseManatalPostingsFromApi,
  parseOraclePostingsFromApi,
  parsePageupPostingsFromResults,
  parsePaylocityPostingsFromPageData,
  parsePinpointHqPostingsFromApi,
  parseRecruitCrmPostingsFromApi,
  parseRecruiteePostingsFromPublicApp,
  parseSapHrCloudPostingsFromApi,
  parseSmartRecruitersPostingsFromApi,
  parseUltiProPostingsFromApi,
  parseWorkdayPostingsFromApi,
  parseZohoPostingsFromHtml
} = require("../../index");
const { validateNormalizedPostingContract } = require("../parserContract");
const { buildEvidenceMetadata, evaluatePublicPosting } = require("../publicPostingGate");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../posting");

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

function fetchJson(url, init = {}) {
  if (typeof fetch !== "function") {
    throw new Error("global fetch is unavailable for source fetch");
  }
  return fetch(url, {
    headers: {
      accept: "application/json,text/html;q=0.8,*/*;q=0.5",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)"
    },
    ...init
  }).then(async (response) => {
    if (!response.ok) {
      const error = new Error(`source fetch failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) return response.json();
    return response.text();
  });
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
      const publicJobsUrl = clean(company.url_string).replace(/\/$/, "");
      return {
        config: { publicJobsUrl },
        listUrl: publicJobsUrl ? `${publicJobsUrl}/api/jobs` : ""
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
    discover(company) {
      const parsed = asUrl(company.url_string);
      const origin = parsed ? parsed.origin : "";
      return {
        config: { origin },
        listUrl: clean(company.url_string)
      };
    }
  },
  taleo: {
    sourceFamily: "brittle",
    confidence: 0.35,
    parser: (companyName, config, payload) =>
      extractTaleoPostingsFromRest(companyName, config, Array.isArray(payload) ? payload : payload?.requisitionList || []),
    officialDocs: "observed Taleo careersection REST/AJAX public endpoints",
    discover(company) {
      const url = clean(company.url_string);
      const parsed = asUrl(url);
      const lang = parsed?.searchParams?.get("lang") || "en";
      const baseSectionUrl = url.replace(/\/(?:jobsearch|jobdetail)\.ftl.*$/i, "");
      return {
        config: { baseSectionUrl, lang },
        listUrl: url
      };
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
    normalized.evidence = buildEvidenceMetadata(normalized, { parserVersion });
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
    return ["enterprise_api", "html_detail", "brittle"].includes(spec.sourceFamily)
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
