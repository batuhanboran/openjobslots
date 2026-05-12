const {
  collectPostingsForCompany,
  parseAshbyPostingsFromApi,
  parseBambooHrPostingsFromApi,
  parseFountainPostingsFromApi,
  parseGreenhousePostingsFromApi,
  parseLeverPostingsFromApi,
  parseManatalPostingsFromApi,
  parsePinpointHqPostingsFromApi,
  parseRecruitCrmPostingsFromApi,
  parseRecruiteePostingsFromPublicApp,
  parseSmartRecruitersPostingsFromApi,
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
    parser: parseZohoPostingsFromHtml,
    officialDocs: "observed Zoho Recruit public careers page embedded payload",
    discover(company) {
      const careersUrl = clean(company.url_string).replace(/\/$/, "");
      return {
        config: { careersUrl },
        listUrl: careersUrl
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
      source_family: key === "zoho" ? "embedded_json" : "direct_json",
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
      confidence: options.confidence || DEFAULT_PARSER_CONFIDENCE,
      ...options
    });
    normalized.parser_key = key;
    normalized.parser_version = parserVersion;
    normalized.parser_confidence = Number(normalized.parser_confidence || DEFAULT_PARSER_CONFIDENCE);
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
    return DEFAULT_RATE_LIMIT;
  }

  function qualityThreshold() {
    return {
      parse_success_minimum_pct: 95,
      max_batch_bad_row_pct: 5,
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
