function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}
function parseAshbyCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;
  const [organizationHostedJobsPageName = ""] = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (!organizationHostedJobsPageName) return null;

  return {
    organizationHostedJobsPageName,
    organizationHostedJobsPageNameLower: organizationHostedJobsPageName.toLowerCase()
  };
}

function parseGreenhouseCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;
  const [boardToken = ""] = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (!boardToken) return null;

  return {
    boardToken,
    boardTokenLower: boardToken.toLowerCase()
  };
}

function parseLeverCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;
  const [organization = ""] = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (!organization) return null;

  return {
    organization,
    organizationLower: organization.toLowerCase()
  };
}

function parseJobviteCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "jobs.jobvite.com" && host !== "careers.jobvite.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: `${parsed.protocol}//${parsed.host}/${companySlug}/jobs`
  };
}

function parseCareerplugCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".careerplug.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: `${parsed.protocol}//${parsed.host}/jobs`
  };
}

function parseBambooHrCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  const suffix = ".bamboohr.com";
  if (!host.endsWith(suffix)) return null;

  const companySubdomain = String(host.slice(0, -suffix.length) || "").trim();
  if (!companySubdomain || companySubdomain.includes(".") || companySubdomain === "www") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "careers") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companySubdomain,
    companySubdomainLower: companySubdomain.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/careers`,
    apiUrl: `${baseOrigin}/careers/list`
  };
}

function parseAdpMyjobsCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "myjobs.adp.com" && host !== "www.myjobs.adp.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companyName = String(pathParts[0] || "").trim();
  if (!companyName) return null;

  return {
    host,
    companyName,
    companyNameLower: companyName.toLowerCase(),
    boardUrl: `https://myjobs.adp.com/${companyName}/cx/job-listing`,
    careerSiteUrl: `https://myjobs.adp.com/public/staffing/v1/career-site/${encodeURIComponent(companyName)}`
  };
}

function parseCareerspageCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "careerspage.io" && host !== "www.careerspage.io") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl: `https://careerspage.io/${companySlug}`
  };
}

function parseCareerpuckCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "app.careerpuck.com" && host !== "www.app.careerpuck.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length < 2 || pathParts[0].toLowerCase() !== "job-board") return null;

  const boardSlug = String(pathParts[1] || "").trim();
  if (!boardSlug) return null;

  return {
    host,
    boardSlug,
    boardSlugLower: boardSlug.toLowerCase(),
    boardUrl: `${parsed.protocol}//${parsed.host}/job-board/${boardSlug}`,
    apiUrl: `https://api.careerpuck.com/v1/public/job-boards/${encodeURIComponent(boardSlug)}`
  };
}

function parseFountainCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "web.fountain.com" && host !== "www.web.fountain.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length < 4 || pathParts[0].toLowerCase() !== "c") return null;

  const companyPath = pathParts.slice(0, 4);
  const companySlug = String(pathParts[1] || "").trim();
  if (!companySlug) return null;

  const boardPath = companyPath.join("/");
  const boardUrl = `${parsed.protocol}//${parsed.host}/${boardPath}`;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl,
    apiUrl: `${boardUrl}.json`
  };
}

function parseGetroCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host === "www.getro.com") return null;
  if (!host.endsWith(".getro.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    jobsUrl: `${parsed.protocol}//${parsed.host}/jobs`
  };
}

function parseHrmDirectCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".hrmdirect.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const jobsUrl = new URL(parsed.toString());
  if (!/\/employment\/job-openings\.php$/i.test(String(jobsUrl.pathname || ""))) {
    jobsUrl.pathname = "/employment/job-openings.php";
  }
  if (!jobsUrl.searchParams.has("search")) {
    jobsUrl.searchParams.set("search", "true");
  }
  jobsUrl.hash = "";

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: jobsUrl.toString()
  };
}

function parseTalentlyftCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".talentlyft.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    careersUrl: `${parsed.protocol}//${parsed.host}/`
  };
}

function parseTalexioCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".talexio.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/jobs/`,
    apiUrl: `${baseOrigin}/api/jobs`
  };
}

function parseSapHrCloudCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  const suffix = ".jobs.hr.cloud.sap";
  if (!host.endsWith(suffix)) return null;

  const companyName = String(host.slice(0, -suffix.length) || "").trim();
  if (!companyName) return null;

  const localeFromUrl = String(parsed.searchParams.get("locale") || "").trim();
  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companyName,
    companyNameLower: companyName.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/search/?createNewAlert=false&q=`,
    apiUrl: `${baseOrigin}/services/recruiting/v1/jobs`,
    localeFromUrl: localeFromUrl || ""
  };
}

function parseTeamtailorCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".teamtailor.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/jobs`
  };
}

function parseFreshteamCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".freshteam.com")) return null;
  if (host === "freshteam.com" || host === "www.freshteam.com" || host === "assets.freshteam.com") return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/jobs`
  };
}

function parseSagehrCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "talent.sage.hr" && host !== "www.talent.sage.hr") return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;
  if (companySlug.toLowerCase() === "embed" || companySlug.toLowerCase() === "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/${encodeURIComponent(companySlug)}/vacancies`
  };
}

function parsePeopleforceCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".peopleforce.io")) return null;
  if (host === "peopleforce.io" || host === "www.peopleforce.io") return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "careers") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/careers`
  };
}

function parseSimplicantCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".simplicant.com")) return null;
  if (
    host === "simplicant.com" ||
    host === "www.simplicant.com" ||
    host === "assets.simplicant.com" ||
    host === "app.simplicant.com" ||
    host === "jobs.simplicant.com"
  ) {
    return null;
  }

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && !["jobs", "leads"].includes(String(pathParts[0] || "").toLowerCase())) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/`
  };
}

function parseLoxoCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "app.loxo.co" && host !== "www.app.loxo.co") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;
  if (String(pathParts[0] || "").toLowerCase() === "job") return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;

  const boardUrl = new URL(`${parsed.protocol}//${parsed.host}/${companySlug}`);
  boardUrl.search = "";
  boardUrl.hash = "";

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    boardUrl: boardUrl.toString()
  };
}

function parsePinpointHqCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".pinpointhq.com")) return null;
  if (host === "pinpointhq.com" || host === "www.pinpointhq.com") return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    boardUrl: `${baseOrigin}/`,
    apiUrl: `${baseOrigin}/postings.json`
  };
}

function parseRecruitCrmCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruitcrm.io" && !host.endsWith(".recruitcrm.io")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  let account = "";
  if (pathParts.length >= 2 && String(pathParts[0] || "").toLowerCase() === "jobs") {
    account = String(pathParts[1] || "").trim();
  } else {
    const queryAccount = String(parsed.searchParams?.get("account") || "").trim();
    account = queryAccount;
  }

  if (!account) return null;

  return {
    host,
    account,
    accountLower: account.toLowerCase(),
    publicJobsUrl: `https://recruitcrm.io/jobs/${encodeURIComponent(account)}`,
    apiUrl:
      `https://albatross.recruitcrm.io/v1/external-pages/jobs-by-account/get?account=${encodeURIComponent(account)}&batch=true`
  };
}

function parseRipplingCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "ats.rippling.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  let companySlug = "";
  if (pathParts.length > 0) {
    if (String(pathParts[0] || "").toLowerCase() === "api" && pathParts.length >= 5) {
      companySlug = String(pathParts[4] || "").trim();
    } else {
      companySlug = String(pathParts[0] || "").trim();
    }
  }

  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl: `https://ats.rippling.com/${companySlug}/jobs`,
    apiUrl: `https://ats.rippling.com/api/v2/board/${companySlug}/jobs`
  };
}

function parseManatalCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "www.careers-page.com" && !host.endsWith(".careers-page.com")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  const hostSubdomain =
    host.endsWith(".careers-page.com") && host !== "www.careers-page.com"
      ? String(host.split(".")[0] || "").trim()
      : "";

  let domainSlug = hostSubdomain || String(pathParts[0] || "").trim();
  if (!domainSlug) return null;
  domainSlug = domainSlug.toLowerCase();
  if (!domainSlug || domainSlug === "job" || domainSlug === "jobs") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  const publicBaseUrl = "https://www.careers-page.com";
  const boardUrl =
    host === "www.careers-page.com" ? `${baseOrigin}/${domainSlug}/` : `${baseOrigin}/`;

  return {
    host,
    domainSlug,
    domainSlugLower: domainSlug.toLowerCase(),
    baseOrigin,
    publicBaseUrl,
    boardUrl,
    careersUrl: boardUrl,
    jobsApiUrl: `${publicBaseUrl}/api/v1.0/c/${encodeURIComponent(domainSlug)}/jobs/`
  };
}

function parseJobApsCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".jobapscloud.com")) return null;

  const boardUrl = parsed.toString();
  return {
    host,
    boardUrl
  };
}

function parseJoinCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "join.com" && host !== "www.join.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length < 2 || String(pathParts[0] || "").toLowerCase() !== "companies") return null;

  const companySlug = String(pathParts[1] || "").trim();
  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    boardUrl: `${parsed.protocol}//${parsed.host}/companies/${companySlug}`
  };
}

function parseApplicantProCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".applicantpro.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const jobsUrl = `${parsed.protocol}//${parsed.host}/jobs/`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl
  };
}

function parseApplyToJobCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".applytojob.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    applyUrl: `${parsed.protocol}//${parsed.host}/apply`
  };
}

function parseTheApplicantManagerCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "theapplicantmanager.com" && host !== "www.theapplicantmanager.com") return null;

  const companyCode = String(parsed.searchParams.get("co") || "").trim().toLowerCase();
  if (!companyCode) return null;

  return {
    host,
    companyCode,
    companyCodeLower: companyCode.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    careersUrl: `${parsed.protocol}//${parsed.host}/careers?co=${encodeURIComponent(companyCode)}`
  };
}

function parseIcimsCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".icims.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const searchUrl = new URL(parsed.toString());
  searchUrl.pathname = "/jobs/search";
  if (!searchUrl.searchParams.has("ss")) {
    searchUrl.searchParams.set("ss", "1");
  }
  searchUrl.searchParams.delete("in_iframe");

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    searchUrl: searchUrl.toString()
  };
}

function parseBreezyCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host === "breezy.hr" || host === "www.breezy.hr") return null;
  if (!host.endsWith(".breezy.hr")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    portalUrl: `${parsed.protocol}//${parsed.host}/`
  };
}

function parseZohoCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".zohorecruit.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const careersUrl = new URL(parsed.toString());
  careersUrl.pathname = "/jobs/Careers";
  careersUrl.search = "";
  careersUrl.hash = "";

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    careersUrl: careersUrl.toString()
  };
}

function parseApplicantAiCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "applicantai.com" && host !== "www.applicantai.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const slug = String(pathParts[0] || "").trim();
  if (!slug) return null;

  return {
    host,
    slug,
    slugLower: slug.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    careersUrl: `${parsed.protocol}//${parsed.host}/${slug}`
  };
}

function parseRecruiteeCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;
  if (!String(parsed.hostname || "").toLowerCase().endsWith(".recruitee.com")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const normalizedPathParts = pathParts[0]?.toLowerCase() === "o" ? [] : pathParts;
  const basePath = normalizedPathParts.length > 0 ? `/${normalizedPathParts.join("/")}` : "";
  const baseUrl = `${parsed.origin}${basePath}`.replace(/\/+$/, "");
  const [subdomain = ""] = parsed.hostname.split(".");

  return {
    baseUrl: baseUrl || parsed.origin,
    subdomain: String(subdomain || "").toLowerCase()
  };
}

function parseUltiProCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "recruiting.ultipro.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  const jobBoardIndex = pathParts.findIndex((part) => part.toLowerCase() === "jobboard");
  if (jobBoardIndex <= 0 || jobBoardIndex + 1 >= pathParts.length) return null;

  const tenant = pathParts[jobBoardIndex - 1];
  const boardId = pathParts[jobBoardIndex + 1];
  if (!tenant || !boardId) return null;

  return {
    tenant,
    tenantLower: tenant.toLowerCase(),
    boardId,
    baseBoardUrl: `${parsed.protocol}//${parsed.host}/${tenant}/JobBoard/${boardId}`
  };
}

function parseTaleoCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".taleo.net")) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (pathParts.length < 2 || pathParts[0].toLowerCase() !== "careersection") return null;

  const careerSection = pathParts[1];
  if (!careerSection) return null;

  const lang = String(parsed.searchParams.get("lang") || "en").trim() || "en";

  return {
    careerSection,
    careerSectionLower: careerSection.toLowerCase(),
    lang,
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    baseSectionUrl: `${parsed.protocol}//${parsed.host}/careersection/${careerSection}`
  };
}


const COMPANY_SOURCE_PARSERS = Object.freeze({
  adp_myjobs: parseAdpMyjobsCompany,
  applicantai: parseApplicantAiCompany,
  applicantpro: parseApplicantProCompany,
  applytojob: parseApplyToJobCompany,
  ashby: parseAshbyCompany,
  bamboohr: parseBambooHrCompany,
  breezy: parseBreezyCompany,
  careerplug: parseCareerplugCompany,
  careerpuck: parseCareerpuckCompany,
  careerspage: parseCareerspageCompany,
  fountain: parseFountainCompany,
  freshteam: parseFreshteamCompany,
  getro: parseGetroCompany,
  greenhouse: parseGreenhouseCompany,
  hrmdirect: parseHrmDirectCompany,
  icims: parseIcimsCompany,
  jobaps: parseJobApsCompany,
  jobvite: parseJobviteCompany,
  join: parseJoinCompany,
  lever: parseLeverCompany,
  loxo: parseLoxoCompany,
  manatal: parseManatalCompany,
  peopleforce: parsePeopleforceCompany,
  pinpointhq: parsePinpointHqCompany,
  recruitcrm: parseRecruitCrmCompany,
  recruitee: parseRecruiteeCompany,
  rippling: parseRipplingCompany,
  sagehr: parseSagehrCompany,
  saphrcloud: parseSapHrCloudCompany,
  simplicant: parseSimplicantCompany,
  taleo: parseTaleoCompany,
  talentlyft: parseTalentlyftCompany,
  talexio: parseTalexioCompany,
  teamtailor: parseTeamtailorCompany,
  theapplicantmanager: parseTheApplicantManagerCompany,
  ultipro: parseUltiProCompany,
  zoho: parseZohoCompany
});

function parseCompanySourceConfig(atsKey, urlString) {
  const parser = COMPANY_SOURCE_PARSERS[String(atsKey || "").trim().toLowerCase()];
  return typeof parser === "function" ? parser(urlString) : null;
}

module.exports = {
  parseAdpMyjobsCompany,
  parseApplicantAiCompany,
  parseApplicantProCompany,
  parseApplyToJobCompany,
  parseAshbyCompany,
  parseBambooHrCompany,
  parseBreezyCompany,
  parseCareerplugCompany,
  parseCareerpuckCompany,
  parseCareerspageCompany,
  parseCompanySourceConfig,
  parseFountainCompany,
  parseFreshteamCompany,
  parseGetroCompany,
  parseGreenhouseCompany,
  parseHrmDirectCompany,
  parseIcimsCompany,
  parseJobApsCompany,
  parseJobviteCompany,
  parseJoinCompany,
  parseLeverCompany,
  parseLoxoCompany,
  parseManatalCompany,
  parsePeopleforceCompany,
  parsePinpointHqCompany,
  parseRecruitCrmCompany,
  parseRecruiteeCompany,
  parseRipplingCompany,
  parseSagehrCompany,
  parseSapHrCloudCompany,
  parseSimplicantCompany,
  parseTaleoCompany,
  parseTalentlyftCompany,
  parseTalexioCompany,
  parseTeamtailorCompany,
  parseTheApplicantManagerCompany,
  parseUltiProCompany,
  parseZohoCompany
};
