const { safeFetch } = require("./safeFetch");
const { decodeHtmlEntities } = require("./parsers/shared/html");
const {
  parseAdpMyjobsCompany,
  parseAdpWorkforcenowCompany,
  parseApplicantAiCompany,
  parseApplicantProCompany,
  parseAshbyCompany,
  parseBrassringCompany,
  parseBreezyCompany,
  parseCareerplugCompany,
  parseCareerpuckCompany,
  parseCareerspageCompany,
  parseEightfoldCompany,
  parseFountainCompany,
  parseFreshteamCompany,
  parseGemCompany,
  parseGetroCompany,
  parseGreenhouseCompany,
  parseHirebridgeCompany,
  parseIcimsCompany,
  parseJobApsCompany,
  parseJobviteCompany,
  parseJoinCompany,
  parseLeverCompany,
  parseLoxoCompany,
  parseManatalCompany,
  parseOracleCompany,
  parsePageupCompany,
  extractPageupRouteConfigFromUrl,
  parsePaylocityCompany,
  parsePeopleforceCompany,
  parsePinpointHqCompany,
  parseRecruitCrmCompany,
  parseRecruiteeCompany,
  parseRipplingCompany,
  parseSagehrCompany,
  parseSapHrCloudCompany,
  parseSimplicantCompany,
  parseTaleoCompany,
  parseTalentreefCompany,
  parseTalentlyftCompany,
  parseTalexioCompany,
  parseTeamtailorCompany,
  parseTheApplicantManagerCompany,
  parseUltiProCompany,
  parseZohoCompany
} = require("./sourceDiscovery");
const { parseAdpMyjobsPostingsFromApi } = require("./sources/adp_myjobs/parse");
const {
  extractAdpWorkforcenowCompanyName,
  parseAdpWorkforcenowPostingsFromApi,
  resolveAdpWorkforcenowCompanyName
} = require("./sources/adp_workforcenow/parse");
const {
  buildApplitrackDetailUrl,
  extractApplitrackDetailFields,
  normalizeApplitrackUrl,
  parseApplitrackPostings
} = require("./sources/applitrack/parse");
const { parseAshbyPostingsFromApi } = require("./sources/ashby/parse");
const { parseBreezyPostingsFromHtml } = require("./sources/breezy/parse");
const {
  extractBrassringCompanyName,
  extractBrassringHiddenInput,
  parseBrassringPostingsFromApi
} = require("./sources/brassring/parse");
const { extractTaleoPostingsFromAjax, extractTaleoPostingsFromRest } = require("./sources/taleo/parse");
const {
  buildTalentreefSearchPayload,
  extractTalentreefAliasData,
  parseTalentreefPostingsFromSearchResponse
} = require("./sources/talentreef/parse");
const { parseCareerplugPostingsFromHtml } = require("./sources/careerplug/parse");
const { parseFountainPostingsFromApi } = require("./sources/fountain/parse");
const { parseGreenhousePostingsFromApi } = require("./sources/greenhouse/parse");
const {
  buildHirebridgeDetailsUrl,
  extractHirebridgeDatePostedFromDetailHtml,
  parseHirebridgePostingsFromHtml
} = require("./sources/hirebridge/parse");
const { parseJobvitePostingsFromHtml } = require("./sources/jobvite/parse");
const { parseLeverPostingsFromApi } = require("./sources/lever/parse");
const { parseOraclePostingsFromApi } = require("./sources/oracle/parse");
const {
  extractManatalPageRuntimeConfig,
  parseManatalPostingsFromApi,
  parseManatalPostingsFromHtml
} = require("./sources/manatal/parse");
const {
  extractPageupCompanyNameFromTitle,
  extractPageupPostingDateFromDetailHtml,
  parsePageupPostingsFromResults
} = require("./sources/pageup/parse");
const {
  extractPaylocityPageDataJson,
  parsePaylocityPostingsFromPageData
} = require("./sources/paylocity/parse");
const { parsePinpointHqPostingsFromApi } = require("./sources/pinpointhq/parse");
const { parseRecruitCrmPostingsFromApi } = require("./sources/recruitcrm/parse");
const {
  extractRecruiteePropsFromHtml,
  parseRecruiteePostingsFromPublicApp
} = require("./sources/recruitee/parse");
const {
  extractIcimsLocationFromHtml,
  extractIcimsLocationFromTitleOrUrl,
  extractIcimsPostingDateFromHtml,
  extractIcimsRemoteTypeFromHtml,
  parseIcimsPostingsFromHtml
} = require("./sources/icims/parse");
const {
  parseSapHrCloudPostingsFromApi,
  parseSapHrCloudPostingsFromHtml
} = require("./sources/saphrcloud/parse");
const { parseSmartRecruitersPostingsFromApi } = require("./sources/smartrecruiters/parse");
const { parseUltiProPostingsFromApi } = require("./sources/ultipro/parse");
const {
  extractWorkdayLocationLabel,
  extractWorkdaySourceJobId,
  inferWorkdayLocationFromJobUrl,
  parseWorkdayPostingsFromApi
} = require("./sources/workday/parse");
const { parseZohoPostingsFromHtml } = require("./sources/zoho/parse");
const { parseTeamtailorPostingsFromHtml } = require("./sources/teamtailor/parse");
const { parseFreshteamPostingsFromHtml } = require("./sources/freshteam/parse");
const {
  extractSagehrCompanyNameFromHtml,
  parseSagehrPostingsFromHtml
} = require("./sources/sagehr/parse");
const { parsePeopleforcePostingsFromHtml } = require("./sources/peopleforce/parse");
const { parseSimplicantPostingsFromHtml } = require("./sources/simplicant/parse");
const { parseLoxoPostingsFromHtml } = require("./sources/loxo/parse");
const { parseCareerspagePostingsFromHtml } = require("./sources/careerspage/parse");
const {
  extractApplicantProDomainId,
  parseApplicantProPostingsFromApi
} = require("./sources/applicantpro/parse");
const {
  buildEightfoldApiUrl,
  extractEightfoldDomainFromHtml,
  parseEightfoldPostingsFromApi
} = require("./sources/eightfold/parse");
const { parseCareerpuckPostingsFromApi } = require("./sources/careerpuck/parse");
const { parseRipplingPostingsFromApi } = require("./sources/rippling/parse");
const { parseTalexioPostingsFromApi } = require("./sources/talexio/parse");
const { parseGemPostingsFromBatchResponse } = require("./sources/gem/parse");
const { parseJobApsPostingsFromHtml } = require("./sources/jobaps/parse");
const {
  extractJoinNextDataJsonFromHtml,
  parseJoinPostingsFromNextData
} = require("./sources/join/parse");
const { parseGetroPostingsFromHtml } = require("./sources/getro/parse");
const {
  extractTalentlyftInitialConfig,
  extractTalentlyftTotalPages,
  parseTalentlyftPostingsFromFragment
} = require("./sources/talentlyft/parse");
const { parseTheApplicantManagerPostingsFromHtml } = require("./sources/theapplicantmanager/parse");
const { parseApplicantAiPostingsFromHtml } = require("./sources/applicantai/parse");
const { parseHibobPostingsFromApi } = require("./sources/hibob/parse");
const {
  extractIsolvisolvedhireDomainId,
  parseIsolvisolvedhirePostingsFromApi
} = require("./sources/isolvisolvedhire/parse");
const {
  extractGovernmentJobsLastPage,
  extractGovernmentJobsViewHtmlFromResponse,
  parseGovernmentJobsPostingsFromViewHtml
} = require("./sources/governmentjobs/parse");
const {
  normalizePoliceappJobUrl,
  parsePoliceappPostingsFromHtml
} = require("./sources/policeapp/parse");
const {
  parseUsajobsOfficialSearchPayload,
  parseUsajobsPostingsFromPayload
} = require("./sources/usajobs/parse");
const { parseK12jobspotPostingsFromPayload } = require("./sources/k12jobspot/parse");
const { parseSchoolspringPostingsFromPayload } = require("./sources/schoolspring/parse");
const {
  buildCalcareersPostPayload,
  extractCalcareersHiddenInputs,
  extractCalcareersPagerTargets,
  parseCalcareersPostingsFromHtml
} = require("./sources/calcareers/parse");
const {
  extractCaloppsNextPageUrl,
  parseCaloppsPostingsFromHtml
} = require("./sources/calopps/parse");
const {
  buildStatejobsnyWindowUrl,
  parseStatejobsnyPostingsFromHtml
} = require("./sources/statejobsny/parse");
const { getRegistrySourceModule, isRegistryPilotSource } = require("./sourceRegistry");
const { validateSourceContract } = require("./sourceContracts");

const WORKDAY_PAGE_SIZE = 20;
const ULTIPRO_PAGE_SIZE = 50;
const MAX_PAGES_PER_COMPANY = 25;
const LOCALE_SEGMENT_REGEX = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const POSTING_VISIBLE_RETENTION_DAYS = Math.max(1, Number(process.env.OPENJOBSLOTS_POSTING_HOT_DAYS || 30));
const DEFAULT_POSTING_TTL_SECONDS = Number(process.env.POSTING_TTL_SECONDS || POSTING_VISIBLE_RETENTION_DAYS * 24 * 60 * 60);
const DEFAULT_BROWSER_USER_AGENT =
  process.env.OPENJOBSLOTS_BROWSER_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const WORKDAY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ASHBY_API_URL = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams";
const ASHBY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GREENHOUSE_API_URL_BASE = "https://boards-api.greenhouse.io/v1/boards";
const GREENHOUSE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const LEVER_API_URL_BASE = "https://api.lever.co/v0/postings";
const LEVER_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RECRUITEE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ULTIPRO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALEO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOBVITE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLICANTPRO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLYTOJOB_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ICIMS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const THEAPPLICANTMANAGER_RATE_LIMIT_WAIT_MS = 60 * 1000;
const BREEZY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ZOHO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLICANTAI_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CAREERPLUG_RATE_LIMIT_WAIT_MS = 60 * 1000;
const BAMBOOHR_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CAREERPUCK_RATE_LIMIT_WAIT_MS = 60 * 1000;
const FOUNTAIN_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GETRO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const HRMDIRECT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALENTLYFT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALEXIO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TEAMTAILOR_RATE_LIMIT_WAIT_MS = 60 * 1000;
const FRESHTEAM_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SAGEHR_RATE_LIMIT_WAIT_MS = 60 * 1000;
const LOXO_RATE_LIMIT_WAIT_MS = 5 * 1000;
const SIMPLICANT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const PINPOINTHQ_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RECRUITCRM_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RIPPLING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const MANATAL_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GEM_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOBAPS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOIN_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALENTREEF_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SAPHRCLOUD_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ADP_MYJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ADP_WORKFORCENOW_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CAREERSPAGE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ORACLE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const HIREBRIDGE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const PAGEUP_RATE_LIMIT_WAIT_MS = 60 * 1000;
const PAYLOCITY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const EIGHTFOLD_RATE_LIMIT_WAIT_MS = 60 * 1000;
const BRASSRING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLITRACK_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY = Math.max(0, Number(process.env.OPENJOBSLOTS_ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY || 5));
const APPLITRACK_DETAIL_FETCH_LIMIT_PER_COMPANY = Math.max(0, Number(process.env.OPENJOBSLOTS_APPLITRACK_DETAIL_FETCH_LIMIT_PER_COMPANY || 5));
const POLICEAPP_RATE_LIMIT_WAIT_MS = 60 * 1000;
const USAJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const USAJOBS_SEARCH_API_URL = "https://data.usajobs.gov/api/Search";
const K12JOBSPOT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SCHOOLSPRING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CALCAREERS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CALOPPS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const STATEJOBSNY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const HIBOB_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ISOLVISOLVEDHIRE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SMARTRECRUITERS_RATE_LIMIT_WAIT_MS = 1000;
const REGISTRY_PILOT_RATE_LIMIT_WAIT_MS = Object.freeze({
  applytojob: APPLYTOJOB_RATE_LIMIT_WAIT_MS,
  bamboohr: BAMBOOHR_RATE_LIMIT_WAIT_MS,
  greenhouse: GREENHOUSE_RATE_LIMIT_WAIT_MS,
  hrmdirect: HRMDIRECT_RATE_LIMIT_WAIT_MS,
  icims: ICIMS_RATE_LIMIT_WAIT_MS
});
const SAPHRCLOUD_LOCALE_CANDIDATES = Object.freeze(["en_US", "en_GB"]);
const ORACLE_EXPAND_VALUE = [
  "requisitionList.workLocation",
  "requisitionList.otherWorkLocations",
  "requisitionList.secondaryLocations",
  "flexFieldsFacet.values",
  "requisitionList.requisitionFlexFields"
].join(",");
const ORACLE_FACETS_VALUE =
  "LOCATIONS;WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS";
const ASHBY_QUERY = `
  query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
    jobBoard: jobBoardWithTeams(
      organizationHostedJobsPageName: $organizationHostedJobsPageName
    ) {
      teams {
        id
        name
        externalName
        parentTeamId
        __typename
      }
      jobPostings {
        id
        title
        teamId
        locationId
        locationName
        workplaceType
        employmentType
        secondaryLocations {
          ...JobPostingSecondaryLocationParts
          __typename
        }
        compensationTierSummary
        __typename
      }
      __typename
    }
  }

  fragment JobPostingSecondaryLocationParts on JobPostingSecondaryLocation {
    locationId
    locationName
    __typename
  }
`;

function defaultNowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function createSourceCollectorRuntime(dependencies = {}) {
  const fetchWithAtsRateLimit = dependencies.fetchWithAtsRateLimit;
  if (typeof fetchWithAtsRateLimit !== "function") {
    throw new Error("createSourceCollectorRuntime requires fetchWithAtsRateLimit");
  }
  const getRegistrySourceModuleForRuntime = typeof dependencies.getRegistrySourceModule === "function"
    ? dependencies.getRegistrySourceModule
    : getRegistrySourceModule;
  const isRegistryPilotSourceForRuntime = typeof dependencies.isRegistryPilotSource === "function"
    ? dependencies.isRegistryPilotSource
    : isRegistryPilotSource;

  const getPostingLocationByJobUrl = typeof dependencies.getPostingLocationByJobUrl === "function"
    ? dependencies.getPostingLocationByJobUrl
    : () => new Map();
  const nowEpochSeconds = typeof dependencies.nowEpochSeconds === "function"
    ? dependencies.nowEpochSeconds
    : defaultNowEpochSeconds;
  const postingTtlSeconds = Number(dependencies.postingTtlSeconds);
  const POSTING_TTL_SECONDS = Number.isFinite(postingTtlSeconds)
    ? postingTtlSeconds
    : DEFAULT_POSTING_TTL_SECONDS;

  function getCurrentPostingLocationByJobUrl() {
    const value = getPostingLocationByJobUrl();
    return value && typeof value.get === "function" ? value : new Map();
  }

  function parseUrl(urlString) {
    if (!urlString) return null;
    try {
      return new URL(urlString);
    } catch {
      return null;
    }
  }
  
  function pickCompanyId(pathParts, subdomain) {
    if (!Array.isArray(pathParts) || pathParts.length === 0) return subdomain;
  
    const [first = "", second = ""] = pathParts;
    if (first && LOCALE_SEGMENT_REGEX.test(first) && second) {
      return second;
    }
  
    return first || subdomain;
  }
  
  function parseWorkdayCompany(urlString) {
    const parsed = parseUrl(urlString);
    if (!parsed) return null;
  
    const [subdomain = ""] = parsed.hostname.split(".");
    const pathParts = parsed.pathname
      .split("/")
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    const companyIdRaw = pickCompanyId(pathParts, subdomain);
    const companyIdApi = companyIdRaw.toLowerCase();
  
    if (!subdomain || !companyIdApi) return null;
  
    return {
      subdomain: subdomain.toLowerCase(),
      companyIdRaw,
      companyIdApi,
      companyBaseUrl: `${parsed.origin}/${companyIdRaw}`,
      cxsUrl: `${parsed.origin}/wday/cxs/${subdomain.toLowerCase()}/${companyIdApi}/jobs`
    };
  }
  
  function isPostedToday(postedOn) {
    if (typeof postedOn !== "string") return false;
    return postedOn.trim().toLowerCase() === "posted today";
  }
  
  function parsePostingDateToEpochSeconds(postingDate, referenceEpoch = nowEpochSeconds()) {
    const raw = String(postingDate ?? "").trim();
    if (!raw) return null;
  
    const normalizedLower = raw.toLowerCase();
    if (normalizedLower === "posted today" || normalizedLower === "today") {
      return Number(referenceEpoch);
    }
    if (normalizedLower === "posted yesterday" || normalizedLower === "yesterday") {
      return Number(referenceEpoch) - 24 * 60 * 60;
    }
  
    const daysAgoMatch = normalizedLower.match(/^(\d+)\s+day(?:s)?\s+ago$/i);
    if (daysAgoMatch?.[1]) {
      return Number(referenceEpoch) - Number(daysAgoMatch[1]) * 24 * 60 * 60;
    }
  
    const hoursAgoMatch = normalizedLower.match(/^(\d+)\s+hour(?:s)?\s+ago$/i);
    if (hoursAgoMatch?.[1]) {
      return Number(referenceEpoch) - Number(hoursAgoMatch[1]) * 60 * 60;
    }
  
    let normalized = raw
      .replace(/^posted\s+/i, "")
      .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
      .replace(/\s+/g, " ")
      .trim();
  
    if (/^\d{10,13}$/.test(normalized)) {
      const numericEpoch = Number(normalized.length === 13 ? Math.floor(Number(normalized) / 1000) : normalized);
      if (Number.isFinite(numericEpoch) && numericEpoch > 0) {
        return numericEpoch;
      }
    }
  
    const parsedMs = Date.parse(normalized);
    if (Number.isFinite(parsedMs)) return Math.floor(parsedMs / 1000);
  
    normalized = normalized.replace(/,\s*/g, " ").trim();
    const fallbackParsedMs = Date.parse(normalized);
    if (Number.isFinite(fallbackParsedMs)) return Math.floor(fallbackParsedMs / 1000);
  
    return null;
  }
  
  function shouldStorePostingByDate(postingDate, referenceEpoch = nowEpochSeconds()) {
    const raw = String(postingDate ?? "").trim();
    if (!raw) return true;
  
    const parsedEpoch = parsePostingDateToEpochSeconds(raw, referenceEpoch);
    if (!parsedEpoch) return false;
    return parsedEpoch >= Number(referenceEpoch) - POSTING_TTL_SECONDS;
  }
  
  function inferPostingLocationFromJobUrl(jobPostingUrl) {
    const url = String(jobPostingUrl || "").trim();
    if (!url) return null;
  
    try {
      const parsed = new URL(url);
      if (parsed.hostname.endsWith("myworkdayjobs.com")) {
        return inferWorkdayLocationFromJobUrl(url);
      }
      if (parsed.hostname === "jobs.ashbyhq.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "job-boards.greenhouse.io" || parsed.hostname === "boards.greenhouse.io") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "jobs.lever.co") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".recruitee.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "recruiting.ultipro.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".taleo.net")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "jobs.jobvite.com" || parsed.hostname === "careers.jobvite.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".applicantpro.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".applytojob.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".icims.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith("theapplicantmanager.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".breezy.hr")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".zohorecruit.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".bamboohr.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "applicantai.com" || parsed.hostname === "www.applicantai.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".careerplug.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "www.careers-page.com" || parsed.hostname.endsWith(".careers-page.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "app.careerpuck.com" || parsed.hostname === "www.app.careerpuck.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "careers.dayforcehcm.com" || parsed.hostname.endsWith(".dayforcehcm.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "web.fountain.com" || parsed.hostname === "www.web.fountain.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".getro.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "www.governmentjobs.com" || parsed.hostname === "governmentjobs.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "jobs.smartrecruiters.com" || parsed.hostname === "www.jobs.smartrecruiters.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "www.policeapp.com" || parsed.hostname === "policeapp.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "www.usajobs.gov" || parsed.hostname === "usajobs.gov") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "www.k12jobspot.com" || parsed.hostname === "k12jobspot.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "www.schoolspring.com" || parsed.hostname === "schoolspring.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "calcareers.ca.gov" || parsed.hostname === "www.calcareers.ca.gov") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "calopps.org" || parsed.hostname === "www.calopps.org") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "statejobsny.com" || parsed.hostname === "www.statejobsny.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".hrmdirect.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".talentlyft.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".talexio.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".teamtailor.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".freshteam.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "talent.sage.hr" || parsed.hostname === "www.talent.sage.hr") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "app.loxo.co" || parsed.hostname === "www.app.loxo.co") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "jobs.gem.com" || parsed.hostname === "www.jobs.gem.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".jobapscloud.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "join.com" || parsed.hostname === "www.join.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "apply.jobappnetwork.com" || parsed.hostname === "www.apply.jobappnetwork.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".jobs.hr.cloud.sap")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "myjobs.adp.com" || parsed.hostname === "www.myjobs.adp.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "workforcenow.adp.com" || parsed.hostname === "www.workforcenow.adp.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "careerspage.io" || parsed.hostname === "www.careerspage.io") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "recruiting.paylocity.com" || parsed.hostname === "www.recruiting.paylocity.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (
        parsed.hostname === "eightfold.ai" ||
        parsed.hostname === "www.eightfold.ai" ||
        parsed.hostname.endsWith(".eightfold.ai")
      ) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "careers.pageuppeople.com" || parsed.hostname === "www.careers.pageuppeople.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".oraclecloud.com") && parsed.pathname.toLowerCase().includes("/hcmui/candidateexperience/")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "recruit.hirebridge.com" || parsed.hostname === "www.recruit.hirebridge.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname === "sjobs.brassring.com" || parsed.hostname === "www.sjobs.brassring.com") {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      if (parsed.hostname.endsWith(".applitrack.com")) {
        return currentPostingLocationByJobUrl.get(url) || null;
      }
      return null;
    } catch {
      return null;
    }
  }
  
  function extractTaleoRestConfig(pageHtml) {
    const source = String(pageHtml || "");
    const portalMatch = source.match(/portal=([0-9]{6,})/i);
    const portal = String(portalMatch?.[1] || "").trim();
  
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
      tokenName = String(match[1] || "").trim();
      if (tokenName) break;
    }
  
    for (const pattern of tokenValuePatterns) {
      const match = source.match(pattern);
      if (!match?.[1]) continue;
      tokenValue = String(match[1] || "").trim();
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
      lang: String(lang || "en").trim() || "en",
      isExternal: "true",
      "rlPager.currentPage": "1",
      "listRequisition.size": "25",
      dropListSize: "25"
    };
  
    if (csrfToken) {
      payload.csrftoken = String(csrfToken || "").trim();
    }
  
    return payload;
  }
  
  function ensureIcimsIframeUrl(urlString) {
    const parsed = parseUrl(urlString);
    if (!parsed) return String(urlString || "").trim();
    parsed.searchParams.set("in_iframe", "1");
    return parsed.toString();
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
      const rawValue = String(match?.[1] || "").trim();
      if (!rawValue) continue;
  
      let candidate = decodeHtmlEntities(rawValue).replace(/\\\//g, "/");
      if (!candidate) continue;
  
      if (candidate.startsWith("//")) {
        const parsedBase = parseUrl(baseUrl);
        const protocol = String(parsedBase?.protocol || "https:");
        candidate = `${protocol}${candidate}`;
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
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']next["'][^>]*>/i
    ];
  
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const rawValue = String(match?.[1] || "").trim();
      if (!rawValue) continue;
  
      let candidate = decodeHtmlEntities(rawValue).replace(/\\\//g, "/");
      if (!candidate) continue;
  
      if (candidate.startsWith("//")) {
        const parsedCurrent = parseUrl(currentUrl);
        const protocol = String(parsedCurrent?.protocol || "https:");
        candidate = `${protocol}${candidate}`;
      } else if (!/^https?:\/\//i.test(candidate)) {
        try {
          candidate = new URL(candidate, currentUrl).toString();
        } catch {
          continue;
        }
      }
  
      const normalizedCandidate = ensureIcimsIframeUrl(candidate);
      if (normalizedCandidate && normalizedCandidate !== String(currentUrl || "").trim()) {
        return normalizedCandidate;
      }
    }
  
    return null;
  }
  
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  
  async function fetchWorkdayPage(cxsUrl, limit, offset) {
    const res = await fetchWithAtsRateLimit("workday", WORKDAY_RATE_LIMIT_WAIT_MS, cxsUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        appliedFacets: {},
        limit,
        offset,
        searchText: ""
      })
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Workday request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchAshbyJobBoard(organizationHostedJobsPageName) {
    const res = await fetchWithAtsRateLimit("ashby", ASHBY_RATE_LIMIT_WAIT_MS, ASHBY_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        operationName: "ApiJobBoardWithTeams",
        variables: {
          organizationHostedJobsPageName
        },
        query: ASHBY_QUERY
      })
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ashby request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const data = await res.json();
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      const firstError = String(data.errors[0]?.message || "Unknown Ashby GraphQL error");
      throw new Error(`Ashby GraphQL error: ${firstError}`);
    }
  
    return data;
  }
  
  async function fetchGreenhouseJobBoard(boardToken) {
    const encodedBoardToken = encodeURIComponent(boardToken);
    const res = await fetchWithAtsRateLimit(
      "greenhouse",
      GREENHOUSE_RATE_LIMIT_WAIT_MS,
      `${GREENHOUSE_API_URL_BASE}/${encodedBoardToken}/jobs?content=true`,
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      }
    );
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Greenhouse request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchLeverJobBoard(organization) {
    const encodedOrganization = encodeURIComponent(organization);
    const res = await fetchWithAtsRateLimit(
      "lever",
      LEVER_RATE_LIMIT_WAIT_MS,
      `${LEVER_API_URL_BASE}/${encodedOrganization}?mode=json`,
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      }
    );
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Lever request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchRecruiteePublicApp(baseUrl) {
    const res = await fetchWithAtsRateLimit("recruitee", RECRUITEE_RATE_LIMIT_WAIT_MS, baseUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Recruitee request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const pageHtml = await res.text();
    const props = extractRecruiteePropsFromHtml(pageHtml);
    if (!props) {
      throw new Error("Recruitee payload not found in PublicApp data-props");
    }
    return props;
  }
  
  async function fetchJobviteJobsPage(jobsUrl) {
    const res = await fetchWithAtsRateLimit("jobvite", JOBVITE_RATE_LIMIT_WAIT_MS, jobsUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Jobvite request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function fetchApplicantProJobsPage(jobsUrl) {
    const res = await fetchWithAtsRateLimit("applicantpro", APPLICANTPRO_RATE_LIMIT_WAIT_MS, jobsUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ApplicantPro page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function fetchApplicantProJobsList(config, domainId) {
    const apiUrl = new URL(`${String(config?.origin || "").replace(/\/+$/, "")}/core/jobs/${encodeURIComponent(domainId)}`);
    apiUrl.searchParams.set("getParams", "{}");
  
    const res = await fetchWithAtsRateLimit("applicantpro", APPLICANTPRO_RATE_LIMIT_WAIT_MS, apiUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ApplicantPro jobs request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const payload = await res.json();
    if (payload && typeof payload === "object" && payload.success === false) {
      const message = String(payload?.message || "Unknown ApplicantPro API error");
      throw new Error(`ApplicantPro jobs API returned success=false: ${message}`);
    }
    return payload;
  }
  
  async function fetchTheApplicantManagerPage(careersUrl) {
    const res = await fetchWithAtsRateLimit(
      "theapplicantmanager",
      THEAPPLICANTMANAGER_RATE_LIMIT_WAIT_MS,
      careersUrl,
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml"
        }
      }
    );
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TheApplicantManager page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function fetchBreezyPortalPage(urlString) {
    const res = await fetchWithAtsRateLimit("breezy", BREEZY_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Breezy page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || urlString || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost === "breezy.hr" || finalHost === "www.breezy.hr") {
      throw new Error(`Breezy URL redirected to main page: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchIcimsPage(urlString) {
    const res = await fetchWithAtsRateLimit("icims", ICIMS_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`iCIMS page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }

  async function fetchRegistryPilotPayload(atsKey, urlString, target = {}) {
    const headers = String(target.source_family || "").includes("html")
      ? { Accept: "text/html,application/xhtml+xml,application/json;q=0.7,*/*;q=0.5" }
      : { Accept: "application/json,text/html;q=0.8,*/*;q=0.5" };
    const res = await fetchWithAtsRateLimit(
      atsKey,
      REGISTRY_PILOT_RATE_LIMIT_WAIT_MS[atsKey] || 60 * 1000,
      urlString,
      {
        method: "GET",
        headers
      }
    );

    if (!res.ok) {
      const body = await res.text();
      const error = new Error(`${atsKey} registry source request failed (${res.status}): ${body.slice(0, 180)}`);
      error.status = res.status;
      error.url = res.url || urlString;
      throw error;
    }

    const body = await res.text();
    const contentType = String(res.headers?.get?.("content-type") || "").toLowerCase();
    if (contentType.includes("json") || /^[\s\r\n]*[\[{]/.test(body)) {
      try {
        const parsedJson = JSON.parse(body);
        if (parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)) {
          return {
            ...parsedJson,
            __sourceFetchFinalUrl: res.url || urlString
          };
        }
        return parsedJson;
      } catch {
        return body;
      }
    }
    return {
      body,
      url: res.url || urlString,
      status: Number(res.status || 200)
    };
  }

  async function collectPostingsForRegistryPilotCompany(company, atsKey) {
    const sourceModule = getRegistrySourceModuleForRuntime(atsKey);
    const contract = validateSourceContract(sourceModule);
    if (!contract.ok) {
      throw new Error(`${atsKey} registry source contract failed: ${contract.failures.join(", ")}`);
    }

    const rawPayload = await sourceModule.fetchList(company, {
      fetcher: (urlString, target) => fetchRegistryPilotPayload(atsKey, urlString, target)
    });
    return sourceModule.parse(rawPayload, company);
  }

  async function fetchZohoCareersPage(urlString) {
    const res = await fetchWithAtsRateLimit("zoho", ZOHO_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Zoho Recruit page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function fetchApplicantAiCareersPage(urlString) {
    const res = await fetchWithAtsRateLimit("applicantai", APPLICANTAI_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ApplicantAI page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function fetchCareerplugJobsPage(urlString) {
    const res = await fetchWithAtsRateLimit("careerplug", CAREERPLUG_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`CareerPlug page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function fetchGemJobBoard(config) {
    const payload = [
      {
        operationName: "JobBoardTheme",
        variables: {
          boardId: config.boardId
        },
        query:
          "query JobBoardTheme($boardId: String!) { publicBrandingTheme(externalId: $boardId) { id theme __typename } }"
      },
      {
        operationName: "JobBoardList",
        variables: {
          boardId: config.boardId
        },
        query:
          "query JobBoardList($boardId: String!) { oatsExternalJobPostings(boardId: $boardId) { jobPostings { id extId title locations { id name city isoCountry isRemote extId __typename } job { id department { id name extId __typename } locationType employmentType __typename } __typename } __typename } jobBoardExternal(vanityUrlPath: $boardId) { id teamDisplayName descriptionHtml pageTitle __typename } }"
      }
    ];
  
    const res = await fetchWithAtsRateLimit("gem", GEM_RATE_LIMIT_WAIT_MS, config.apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gem API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const responseJson = await res.json();
    if (!Array.isArray(responseJson)) {
      throw new Error("Gem API response is not a JSON array");
    }
  
    return responseJson;
  }
  
  async function fetchJobApsCareersPage(urlString) {
    const res = await fetchWithAtsRateLimit("jobaps", JOBAPS_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`JobAps page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || urlString || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (!finalHost.endsWith(".jobapscloud.com")) {
      throw new Error(`JobAps URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchJoinCompanyPage(urlString) {
    const res = await fetchWithAtsRateLimit("join", JOIN_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`JOIN page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || urlString || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "join.com" && finalHost !== "www.join.com") {
      throw new Error(`JOIN URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchTalentreefAlias(config) {
    const res = await fetchWithAtsRateLimit("talentreef", TALENTREEF_RATE_LIMIT_WAIT_MS, config.aliasApiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TalentReef alias request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchTalentreefSearchResults(config, clientId, brand, from = 0, size = 100) {
    const payload = buildTalentreefSearchPayload(clientId, brand, from, size);
    const res = await fetchWithAtsRateLimit("talentreef", TALENTREEF_RATE_LIMIT_WAIT_MS, config.searchApiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TalentReef search request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchManatalCareersPage(urlString) {
    const res = await fetchWithAtsRateLimit("manatal", MANATAL_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    const finalUrl = String(res.url || urlString || "").trim();
    const pageHtml = await res.text();
    return {
      status: Number(res.status || 0),
      finalUrl,
      pageHtml
    };
  }
  
  async function fetchCareerspageBoardPage(urlString) {
    const res = await fetchWithAtsRateLimit("careerspage", CAREERSPAGE_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`CareersPage request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || urlString || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "careerspage.io" && finalHost !== "www.careerspage.io") {
      throw new Error(`CareersPage URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchOracleJobRequisitionsPage(config, offset = 0, limit = 25) {
    const safeOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
    const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 25;
    const finder = String(config?.finder || "").replace(/limit=\d+/i, `limit=${safeLimit}`);
    const url = new URL(String(config?.apiUrl || "").trim());
    url.searchParams.set("onlyData", "true");
    url.searchParams.set("expand", ORACLE_EXPAND_VALUE);
    if (finder) {
      url.searchParams.set("finder", finder);
    }
    url.searchParams.set("offset", String(safeOffset));
    url.searchParams.set("limit", String(safeLimit));
  
    const res = await fetchWithAtsRateLimit("oracle", ORACLE_RATE_LIMIT_WAIT_MS, url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Oracle job requisitions request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || url.toString()).trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (!finalHost.endsWith(".oraclecloud.com")) {
      throw new Error(`Oracle API URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return res.json();
  }
  
  async function fetchPaylocityBoardPage(config) {
    const res = await fetchWithAtsRateLimit("paylocity", PAYLOCITY_RATE_LIMIT_WAIT_MS, config.boardUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Paylocity board request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || config.boardUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "recruiting.paylocity.com" && finalHost !== "www.recruiting.paylocity.com") {
      throw new Error(`Paylocity URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return {
      pageHtml: await res.text(),
      finalUrl
    };
  }
  
  async function fetchEightfoldCareersPage(config) {
    const res = await fetchWithAtsRateLimit("eightfold", EIGHTFOLD_RATE_LIMIT_WAIT_MS, config.boardUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Eightfold careers page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || config.boardUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (!(finalHost.endsWith(".eightfold.ai") || finalHost === "eightfold.ai" || finalHost === "www.eightfold.ai")) {
      throw new Error(`Eightfold URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return {
      pageHtml: await res.text(),
      finalUrl
    };
  }
  
  async function fetchEightfoldJobsApi(config, domainValue) {
    const apiUrl = buildEightfoldApiUrl(config, domainValue);
    if (!apiUrl) {
      throw new Error("Eightfold API URL could not be built from careers page metadata");
    }
  
    const res = await fetchWithAtsRateLimit("eightfold", EIGHTFOLD_RATE_LIMIT_WAIT_MS, apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Eightfold jobs API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || apiUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (!(finalHost.endsWith(".eightfold.ai") || finalHost === "eightfold.ai" || finalHost === "www.eightfold.ai")) {
      throw new Error(`Eightfold API URL redirected to unexpected host: ${finalUrl}`);
    }
  
    const bodyText = await res.text();
    let responseJson = {};
    try {
      responseJson = JSON.parse(bodyText);
    } catch {
      throw new Error(`Eightfold jobs API response was not JSON: ${bodyText.slice(0, 180)}`);
    }
  
    return {
      responseJson,
      finalUrl
    };
  }
  
  async function fetchPageupBoardPage(config) {
    const res = await fetchWithAtsRateLimit("pageup", PAGEUP_RATE_LIMIT_WAIT_MS, config.boardUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PageUp board request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || config.boardUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "careers.pageuppeople.com" && finalHost !== "www.careers.pageuppeople.com") {
      throw new Error(`PageUp URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return {
      pageHtml: await res.text(),
      finalUrl
    };
  }
  
  async function fetchPageupSearchResults(config) {
    const res = await fetchWithAtsRateLimit("pageup", PAGEUP_RATE_LIMIT_WAIT_MS, config.searchUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: String(config?.boardUrl || ""),
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PageUp search request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || config.searchUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "careers.pageuppeople.com" && finalHost !== "www.careers.pageuppeople.com") {
      throw new Error(`PageUp search URL redirected to unexpected host: ${finalUrl}`);
    }
  
    const bodyText = await res.text();
    let responseJson = {};
    try {
      responseJson = JSON.parse(bodyText);
    } catch {
      throw new Error(`PageUp search response was not JSON: ${bodyText.slice(0, 180)}`);
    }
  
    return {
      responseJson,
      finalUrl
    };
  }
  
  async function fetchPageupDetailsPage(jobPostingUrl) {
    const res = await fetchWithAtsRateLimit("pageup", PAGEUP_RATE_LIMIT_WAIT_MS, jobPostingUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PageUp details request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || jobPostingUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "careers.pageuppeople.com" && finalHost !== "www.careers.pageuppeople.com") {
      throw new Error(`PageUp details URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return res.text();
  }
  
  async function fetchHirebridgeJobsPage(config) {
    const res = await fetchWithAtsRateLimit("hirebridge", HIREBRIDGE_RATE_LIMIT_WAIT_MS, config.boardUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hirebridge page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || config.boardUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "recruit.hirebridge.com" && finalHost !== "www.recruit.hirebridge.com") {
      throw new Error(`Hirebridge URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchHirebridgeDetailsPage(config, jobPostingUrl) {
    const detailsUrl = buildHirebridgeDetailsUrl(config, jobPostingUrl);
    if (!detailsUrl) return "";
  
    const res = await fetchWithAtsRateLimit("hirebridge", HIREBRIDGE_RATE_LIMIT_WAIT_MS, detailsUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hirebridge details request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || detailsUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "recruit.hirebridge.com" && finalHost !== "www.recruit.hirebridge.com") {
      throw new Error(`Hirebridge details URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return res.text();
  }
  
  async function fetchManatalJobsApiPage(config, page = 1, pageSize = 50) {
    const jobsApiUrl = String(config?.jobsApiUrl || "").trim();
    if (!jobsApiUrl) {
      throw new Error("Manatal API URL is missing");
    }
  
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      ordering: "-is_pinned_in_career_page,-last_published_at"
    }).toString();
    const url = `${jobsApiUrl}${jobsApiUrl.includes("?") ? "&" : "?"}${query}`;
  
    const res = await fetchWithAtsRateLimit("manatal", MANATAL_RATE_LIMIT_WAIT_MS, url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: String(config?.boardUrl || ""),
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      const error = new Error(`Manatal API request failed (${res.status}): ${body.slice(0, 180)}`);
      error.status = Number(res.status || 0);
      throw error;
    }
  
    return res.json();
  }
  
  async function fetchTeamtailorJobsPage(config) {
    const res = await fetchWithAtsRateLimit("teamtailor", TEAMTAILOR_RATE_LIMIT_WAIT_MS, config.jobsUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Teamtailor page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || config.jobsUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (!finalHost.endsWith(".teamtailor.com")) {
      throw new Error(`Teamtailor URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchFreshteamJobsPage(config) {
    const res = await fetchWithAtsRateLimit("freshteam", FRESHTEAM_RATE_LIMIT_WAIT_MS, config.jobsUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Freshteam page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || config.jobsUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (!finalHost.endsWith(".freshteam.com")) {
      throw new Error(`Freshteam URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchSagehrJobsPage(config) {
    const headers = {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };
  
    const res = await fetchWithAtsRateLimit("sagehr", SAGEHR_RATE_LIMIT_WAIT_MS, config.boardUrl, {
      method: "GET",
      headers
    });
  
    let statusCode = Number(res.status || 0);
    let finalUrl = String(res.url || config.boardUrl || "").trim();
    let pageHtml = await res.text();
  
    // Disabled curl fallback to prevent external console process launches on Windows MSI runtime.
  
    if (statusCode !== 200 && statusCode !== 403) {
      throw new Error(`SageHR page request failed (${statusCode})`);
    }
  
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "talent.sage.hr" && finalHost !== "www.talent.sage.hr") {
      throw new Error(`SageHR URL redirected to unexpected host: ${finalUrl}`);
    }
  
    if (!String(pageHtml || "").trim()) {
      throw new Error(`SageHR page response was empty (${statusCode})`);
    }
  
    const loweredPageHtml = String(pageHtml || "").toLowerCase();
    const hasExpectedLayout =
      loweredPageHtml.includes("title-wrap") ||
      loweredPageHtml.includes("other-jobs");
    if (statusCode === 403 && !hasExpectedLayout) {
      throw new Error("SageHR page request failed (403)");
    }
  
    return { pageHtml, finalUrl };
  }
  
  async function fetchPeopleforceJobsPage(config) {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    };
  
    const res = await safeFetch(config.jobsUrl, {
      method: "GET",
      headers
    });
  
    let statusCode = Number(res.status || 0);
    let finalUrl = String(res.url || config.jobsUrl || "").trim();
    let pageHtml = statusCode === 200 ? await res.text() : "";
  
    // Disabled curl fallback to prevent external console process launches on Windows MSI runtime.
  
    if (statusCode !== 200) {
      throw new Error(`Peopleforce page request failed (${statusCode})`);
    }
  
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (!finalHost.endsWith(".peopleforce.io") || finalHost === "peopleforce.io" || finalHost === "www.peopleforce.io") {
      throw new Error(`Peopleforce URL redirected to unexpected host: ${finalUrl}`);
    }
  
    if (/\bclosed career site\b/i.test(pageHtml)) {
      return { pageHtml: "", finalUrl };
    }
  
    return { pageHtml, finalUrl };
  }
  
  async function fetchSimplicantJobsPage(config) {
    const res = await fetchWithAtsRateLimit("simplicant", SIMPLICANT_RATE_LIMIT_WAIT_MS, config.jobsUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Simplicant page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || config.jobsUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (
      !finalHost.endsWith(".simplicant.com") ||
      ["simplicant.com", "www.simplicant.com", "assets.simplicant.com", "app.simplicant.com", "jobs.simplicant.com"].includes(
        finalHost
      )
    ) {
      throw new Error(`Simplicant URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchLoxoJobsPage(config) {
    const headers = {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };
  
    const doRequest = async () =>
      safeFetch(config.boardUrl, {
        method: "GET",
        headers
      });
  
    let res = await doRequest();
    if (Number(res.status || 0) === 429) {
      await sleep(LOXO_RATE_LIMIT_WAIT_MS);
      res = await doRequest();
    }
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Loxo page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || config.boardUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "app.loxo.co" && finalHost !== "www.app.loxo.co") {
      throw new Error(`Loxo URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchPinpointHqJobBoard(config) {
    const timestamp = Date.now().toString();
    const queryGlue = String(config.apiUrl || "").includes("?") ? "&" : "?";
    const requestUrl = `${config.apiUrl}${queryGlue}_=${encodeURIComponent(timestamp)}`;
    const res = await fetchWithAtsRateLimit("pinpointhq", PINPOINTHQ_RATE_LIMIT_WAIT_MS, requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PinpointHQ API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || requestUrl || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (!finalHost.endsWith(".pinpointhq.com") || finalHost === "pinpointhq.com" || finalHost === "www.pinpointhq.com") {
      throw new Error(`PinpointHQ URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return res.json();
  }
  
  async function fetchRecruitCrmJobsPage(config, limit = 100, offset = 0) {
    const payload = {
      limit,
      offset,
      search_data: "",
      onlyJobs: true
    };
    const res = await fetchWithAtsRateLimit("recruitcrm", RECRUITCRM_RATE_LIMIT_WAIT_MS, config.apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: "https://recruitcrm.io",
        Referer: config.publicJobsUrl,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      },
      body: JSON.stringify(payload)
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`RecruitCRM API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchRipplingJobsPage(config, page = 0, pageSize = 100) {
    const res = await fetchWithAtsRateLimit("rippling", RIPPLING_RATE_LIMIT_WAIT_MS, config.apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Rippling API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    // Primary board API currently returns the first page without requiring params,
    // but we still keep page/pageSize inputs for future compatibility.
    const responseJson = await res.json();
    if (page > 0 || pageSize !== 100) {
      const pagedRes = await fetchWithAtsRateLimit(
        "rippling",
        RIPPLING_RATE_LIMIT_WAIT_MS,
        `${config.apiUrl}?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json, text/plain, */*"
          }
        }
      );
      if (!pagedRes.ok) {
        return responseJson;
      }
      return pagedRes.json();
    }
  
    return responseJson;
  }
  
  async function fetchAdpMyjobsCareerSite(config) {
    const res = await fetchWithAtsRateLimit("adp_myjobs", ADP_MYJOBS_RATE_LIMIT_WAIT_MS, config.careerSiteUrl, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ADP MyJobs career-site request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchAdpWorkforcenowContentLinks(config) {
    const url =
      `${config.contentLinksBaseUrl}?cid=${encodeURIComponent(config.cid)}` +
      `&timeStamp=${Date.now()}&ccId=${encodeURIComponent(config.ccId)}&locale=en_US&lang=en_US`;
    const res = await fetchWithAtsRateLimit("adp_workforcenow", ADP_WORKFORCENOW_RATE_LIMIT_WAIT_MS, url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ADP Workforce Now content-links request failed (${res.status}): ${body.slice(0, 180)}`);
    }
    return res.json();
  }
  
  async function fetchAdpWorkforcenowJobsPage(config) {
    const res = await fetchWithAtsRateLimit(
      "adp_workforcenow",
      ADP_WORKFORCENOW_RATE_LIMIT_WAIT_MS,
      config.jobRequisitionsUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*"
        }
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ADP Workforce Now job-requisitions request failed (${res.status}): ${body.slice(0, 180)}`);
    }
    return res.json();
  }
  
  function extractCookieHeaderFromResponse(response) {
    const setCookieValues =
      typeof response?.headers?.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : String(response?.headers?.get("set-cookie") || "")
            .split(/,(?=[^;]+=)/g)
            .map((item) => item.trim())
            .filter(Boolean);
    const cookiePairs = [];
    const seenNames = new Set();
    for (const rawCookie of setCookieValues) {
      const cookie = String(rawCookie || "").trim();
      if (!cookie) continue;
      const firstPart = cookie.split(";")[0]?.trim() || "";
      if (!firstPart || !firstPart.includes("=")) continue;
      const name = firstPart.split("=")[0]?.trim().toLowerCase();
      if (!name || seenNames.has(name)) continue;
      seenNames.add(name);
      cookiePairs.push(firstPart);
    }
    return cookiePairs.join("; ");
  }
  
  async function fetchBrassringMatchedJobs(config) {
    const boardRes = await fetchWithAtsRateLimit("brassring", BRASSRING_RATE_LIMIT_WAIT_MS, config.boardUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
    if (!boardRes.ok) {
      const body = await boardRes.text();
      throw new Error(`BrassRing board request failed (${boardRes.status}): ${body.slice(0, 180)}`);
    }
  
    const finalBoardUrl = String(boardRes.url || config.boardUrl || "").trim();
    const finalHost = String(parseUrl(finalBoardUrl)?.hostname || "").toLowerCase();
    if (finalHost !== "sjobs.brassring.com" && finalHost !== "www.sjobs.brassring.com") {
      throw new Error(`BrassRing URL redirected to unexpected host: ${finalBoardUrl}`);
    }
  
    const pageHtml = await boardRes.text();
    const requestVerificationToken = extractBrassringHiddenInput(pageHtml, "__RequestVerificationToken");
    const encryptedSessionValue = extractBrassringHiddenInput(pageHtml, "CookieValue");
    const rftHeaderValue = requestVerificationToken || extractBrassringHiddenInput(pageHtml, "hdRft");
    const cookieHeader = extractCookieHeaderFromResponse(boardRes);
    const companyName = extractBrassringCompanyName(pageHtml);
  
    const payload = {
      PartnerId: config.partnerId,
      SiteId: config.siteId,
      Keyword: "",
      Location: "",
      LocationCustomSolrFields: "Location",
      FacetFilterFields: null,
      TurnOffHttps: false,
      Latitude: 0,
      Longitude: 0,
      PowerSearchOptions: { PowerSearchOption: [] },
      encryptedsessionvalue: encryptedSessionValue
    };
  
    const headers = {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/json; charset=utf-8",
      Origin: "https://sjobs.brassring.com",
      Referer: config.boardUrl,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };
    if (rftHeaderValue) headers.RFT = rftHeaderValue;
    if (cookieHeader) headers.Cookie = cookieHeader;
  
    const res = await fetchWithAtsRateLimit("brassring", BRASSRING_RATE_LIMIT_WAIT_MS, config.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`BrassRing MatchedJobs request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const responseJson = await res.json();
    return { responseJson, companyName };
  }
  
  async function fetchAdpMyjobsJobsPage(config, careerSiteJson, top = 100, skip = 0) {
    const myJobsToken = String(careerSiteJson?.myJobsToken || "").trim();
    const myadpUrl = String(careerSiteJson?.properties?.myadpUrl || "").trim().replace(/\/+$/, "");
    if (!myJobsToken || !myadpUrl) {
      return { count: 0, jobRequisitions: [] };
    }
  
    const params = new URLSearchParams({
      $select:
        "reqId,jobTitle,publishedJobTitle,type,jobDescription,jobQualifications,workLocations,workLevelCode,clientRequisitionID,postingDate,requisitionLocations,postingLocations,organizationalUnits",
      $top: String(Math.max(1, Number(top || 100))),
      $skip: String(Math.max(0, Number(skip || 0))),
      $filter: "",
      radius: "25",
      tz: "America/Los_Angeles"
    }).toString();
    const apiUrl = `${myadpUrl}/myadp_prefix/mycareer/public/staffing/v1/job-requisitions/apply-custom-filters?${params}`;
  
    const res = await fetchWithAtsRateLimit("adp_myjobs", ADP_MYJOBS_RATE_LIMIT_WAIT_MS, apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        myjobstoken: myJobsToken,
        rolecode: "manager",
        Origin: "https://myjobs.adp.com",
        Referer: config.boardUrl
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ADP MyJobs jobs request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchCareerpuckJobBoard(config) {
    const res = await fetchWithAtsRateLimit("careerpuck", CAREERPUCK_RATE_LIMIT_WAIT_MS, config.apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`CareerPuck API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchFountainJobBoard(config) {
    const res = await fetchWithAtsRateLimit("fountain", FOUNTAIN_RATE_LIMIT_WAIT_MS, config.apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Fountain API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchGetroJobsPage(urlString) {
    const res = await fetchWithAtsRateLimit("getro", GETRO_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Getro page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function fetchTalentlyftLandingPage(urlString) {
    const res = await fetchWithAtsRateLimit("talentlyft", TALENTLYFT_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Talentlyft landing page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const finalUrl = String(res.url || urlString || "").trim();
    const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
    if (!finalHost.endsWith(".talentlyft.com")) {
      throw new Error(`Talentlyft URL redirected to unexpected host: ${finalUrl}`);
    }
  
    return { pageHtml: await res.text(), finalUrl };
  }
  
  async function fetchTalentlyftJobListFragment(config, page = 1, pageSize = 20) {
    const apiUrl = String(config?.apiUrl || "").trim();
    if (!apiUrl) {
      throw new Error("Talentlyft API URL is missing");
    }
  
    const params = new URLSearchParams({
      layoutId: String(config?.layoutId || "Jobs-1"),
      websiteUrl: String(config?.websiteUrl || ""),
      themeId: String(config?.themeId || "2"),
      language: String(config?.language || "en"),
      subdomain: String(config?.subdomain || ""),
      page: String(page),
      pageSize: String(pageSize),
      contains: ""
    }).toString();
    const url = `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}${params}`;
  
    const res = await fetchWithAtsRateLimit("talentlyft", TALENTLYFT_RATE_LIMIT_WAIT_MS, url, {
      method: "GET",
      headers: {
        Accept: "text/html, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        Referer: `${String(config?.websiteUrl || "").replace(/\/+$/, "")}/`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Talentlyft JobList request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function fetchTalexioJobsPage(config, page = 1, limit = 10) {
    const apiUrl = String(config?.apiUrl || "").trim();
    if (!apiUrl) {
      throw new Error("Talexio API URL is missing");
    }
  
    const url = `${apiUrl}?${new URLSearchParams({
      search: "",
      sortBy: "relevance",
      page: String(page),
      limit: String(limit)
    }).toString()}`;
  
    const res = await fetchWithAtsRateLimit("talexio", TALEXIO_RATE_LIMIT_WAIT_MS, url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Talexio API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  function buildSapHrCloudSearchPayload(locale = "en_US", pageNumber = 0) {
    const normalizedPage = Math.max(0, Math.floor(Number(pageNumber || 0)));
    return {
      locale: String(locale || "en_US"),
      pageNumber: normalizedPage,
      sortBy: "",
      keywords: "",
      location: "",
      facetFilters: {},
      brand: "",
      skills: [],
      categoryId: 0,
      alertId: "",
      rcmCandidateId: ""
    };
  }
  
  async function fetchSapHrCloudJobsPage(config, locale = "en_US", pageNumber = 0) {
    const payload = buildSapHrCloudSearchPayload(locale, pageNumber);
    const res = await fetchWithAtsRateLimit("saphrcloud", SAPHRCLOUD_RATE_LIMIT_WAIT_MS, config.apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SAP HR Cloud API request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchSapHrCloudBoardPage(urlString) {
    const res = await fetchWithAtsRateLimit("saphrcloud", SAPHRCLOUD_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SAP HR Cloud page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return {
      pageHtml: await res.text(),
      finalUrl: String(res.url || urlString || "").trim()
    };
  }
  
  function buildUltiProSearchPayload(top, skip) {
    return {
      opportunitySearch: {
        Top: Number(top || ULTIPRO_PAGE_SIZE),
        Skip: Number(skip || 0),
        QueryString: "",
        OrderBy: [
          {
            Value: "postedDateDesc",
            PropertyName: "PostedDate",
            Ascending: false
          }
        ],
        Filters: [
          { t: "TermsSearchFilterDto", fieldName: 4, extra: null, values: [] },
          { t: "TermsSearchFilterDto", fieldName: 5, extra: null, values: [] },
          { t: "TermsSearchFilterDto", fieldName: 6, extra: null, values: [] },
          { t: "TermsSearchFilterDto", fieldName: 37, extra: null, values: [] }
        ]
      },
      matchCriteria: {
        PreferredJobs: [],
        Educations: [],
        LicenseAndCertifications: [],
        Skills: [],
        hasNoLicenses: false,
        SkippedSkills: []
      }
    };
  }
  
  async function fetchUltiProSearchResults(config, top, skip) {
    const tenantEncoded = encodeURIComponent(String(config?.tenant || "").trim());
    const boardIdEncoded = encodeURIComponent(String(config?.boardId || "").trim());
    const apiUrl = `https://recruiting.ultipro.com/${tenantEncoded}/JobBoard/${boardIdEncoded}/JobBoardView/LoadSearchResults`;
    const payload = buildUltiProSearchPayload(top, skip);
  
    const res = await fetchWithAtsRateLimit("ultipro", ULTIPRO_RATE_LIMIT_WAIT_MS, apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`UltiPro request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchTaleoJobSearchPage(urlString) {
    const res = await fetchWithAtsRateLimit("taleo", TALEO_RATE_LIMIT_WAIT_MS, urlString, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Taleo page request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function fetchTaleoRestSearchResults(config, portal, tokenName, tokenValue, pageNo) {
    const apiUrl = `${config.baseOrigin}/careersection/rest/jobboard/searchjobs?lang=${encodeURIComponent(
      config.lang
    )}&portal=${encodeURIComponent(portal)}`;
    const payload = buildTaleoRestPayload(pageNo);
  
    const headers = {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      tz: "GMT-07:00",
      tzname: "America/Los_Angeles"
    };
    if (tokenName && tokenValue) {
      headers[tokenName] = tokenValue;
    }
  
    const res = await fetchWithAtsRateLimit("taleo", TALEO_RATE_LIMIT_WAIT_MS, apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Taleo REST request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.json();
  }
  
  async function fetchTaleoAjaxSearchResults(config, csrfToken = "") {
    const apiUrl = `${config.baseSectionUrl}/jobsearch.ajax`;
    const payload = new URLSearchParams(buildTaleoAjaxPayload(config.lang, csrfToken)).toString();
  
    const res = await fetchWithAtsRateLimit("taleo", TALEO_RATE_LIMIT_WAIT_MS, apiUrl, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
        tz: "GMT-07:00",
        tzname: "America/Los_Angeles"
      },
      body: payload
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Taleo AJAX request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    return res.text();
  }
  
  async function collectTodayPostingsForWorkdayCompany(company) {
    const config = parseWorkdayCompany(company.url_string);
    if (!config) return [];
  
    const collected = [];
    const seenUrls = new Set();
    let offset = 0;
  
    for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
      const response = await fetchWorkdayPage(config.cxsUrl, WORKDAY_PAGE_SIZE, offset);
      const postings = Array.isArray(response?.jobPostings) ? response.jobPostings : [];
      if (postings.length === 0) break;
  
      for (const parsedPosting of parseWorkdayPostingsFromApi(company.company_name, config, response)) {
        if (!parsedPosting.job_posting_url || seenUrls.has(parsedPosting.job_posting_url)) continue;
        collected.push(parsedPosting);
        seenUrls.add(parsedPosting.job_posting_url);
      }
  
      if (postings.length < WORKDAY_PAGE_SIZE) break;
      offset += WORKDAY_PAGE_SIZE;
    }
  
    return collected;
  }
  
  async function collectPostingsForAshbyCompany(company) {
    const config = parseAshbyCompany(company.url_string);
    if (!config) return [];
  
    const response = await fetchAshbyJobBoard(config.organizationHostedJobsPageName);
    return parseAshbyPostingsFromApi(company.company_name, config, response);
  }
  
  async function collectPostingsForGreenhouseCompany(company) {
    const config = parseGreenhouseCompany(company.url_string);
    if (!config) return [];
  
    const response = await fetchGreenhouseJobBoard(config.boardToken);
    return parseGreenhousePostingsFromApi(company.company_name, config, response);
  }
  
  async function collectPostingsForLeverCompany(company) {
    const config = parseLeverCompany(company.url_string);
    if (!config) return [];
  
    const response = await fetchLeverJobBoard(config.organization);
    return parseLeverPostingsFromApi(company.company_name, config, response);
  }
  
  async function collectPostingsForJobviteCompany(company) {
    const config = parseJobviteCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings =
      normalizedCompanyName &&
      normalizedCompanyName.toLowerCase() !== "jobs" &&
      normalizedCompanyName.toLowerCase() !== "careers"
        ? normalizedCompanyName
        : config.companySlugLower;
  
    const pageHtml = await fetchJobviteJobsPage(config.jobsUrl);
    return parseJobvitePostingsFromHtml(companyNameForPostings, config, pageHtml);
  }async function collectPostingsForApplicantProCompany(company) {
    const config = parseApplicantProCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const jobsPageHtml = await fetchApplicantProJobsPage(config.jobsUrl);
    const domainId = extractApplicantProDomainId(jobsPageHtml);
    if (!domainId) {
      throw new Error("ApplicantPro domain_id was not found on the jobs page");
    }
  
    const response = await fetchApplicantProJobsList(config, domainId);
    return parseApplicantProPostingsFromApi(companyNameForPostings, config, response);
  }
  
  async function collectPostingsForTheApplicantManagerCompany(company) {
    const config = parseTheApplicantManagerCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companyCodeLower;
    const pageHtml = await fetchTheApplicantManagerPage(config.careersUrl);
    return parseTheApplicantManagerPostingsFromHtml(companyNameForPostings, config, pageHtml);
  }
  
  async function collectPostingsForBreezyCompany(company) {
    const config = parseBreezyCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const { pageHtml, finalUrl } = await fetchBreezyPortalPage(config.portalUrl);
    const parseConfig = {
      ...config,
      origin: `${parseUrl(finalUrl)?.protocol || "https:"}//${parseUrl(finalUrl)?.host || config.host}`
    };
    return parseBreezyPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
  }
  
  async function collectPostingsForIcimsCompany(company) {
    const config = parseIcimsCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  
    const wrapperHtml = await fetchIcimsPage(config.searchUrl);
    let pageUrl = extractIcimsIframeUrlFromHtml(wrapperHtml, config.searchUrl);
    const collected = [];
    const seenPostingUrls = new Set();
    const seenPageUrls = new Set();
    let detailFetches = 0;
  
    for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
      const normalizedPageUrl = ensureIcimsIframeUrl(pageUrl);
      if (!normalizedPageUrl || seenPageUrls.has(normalizedPageUrl)) break;
      seenPageUrls.add(normalizedPageUrl);
  
      const pageHtml = await fetchIcimsPage(normalizedPageUrl);
      const batch = parseIcimsPostingsFromHtml(companyNameForPostings, config, pageHtml);
      for (let posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenPostingUrls.has(postingUrl)) continue;
        seenPostingUrls.add(postingUrl);
        if (
          detailFetches < ICIMS_DETAIL_FETCH_LIMIT_PER_COMPANY &&
          (
            !String(posting?.location || "").trim() ||
            !String(posting?.posting_date || "").trim() ||
            !String(posting?.remote_type || "").trim()
          )
        ) {
          try {
            const detailHtml = await fetchIcimsPage(postingUrl);
            detailFetches += 1;
            posting = {
              ...posting,
              posting_date: posting.posting_date || extractIcimsPostingDateFromHtml(detailHtml),
              remote_type: posting.remote_type || extractIcimsRemoteTypeFromHtml(detailHtml),
              location:
                posting.location ||
                extractIcimsLocationFromHtml(detailHtml) ||
                extractIcimsLocationFromTitleOrUrl(posting.position_name, postingUrl)
            };
          } catch {
            detailFetches += 1;
          }
        }
        collected.push(posting);
      }
  
      const nextPageUrl = extractIcimsNextPageUrlFromHtml(pageHtml, normalizedPageUrl);
      if (!nextPageUrl) break;
      pageUrl = nextPageUrl;
    }
  
    return collected;
  }
  
  async function collectPostingsForZohoCompany(company) {
    const config = parseZohoCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const pageHtml = await fetchZohoCareersPage(config.careersUrl);
    return parseZohoPostingsFromHtml(companyNameForPostings, config, pageHtml);
  }
  
  async function collectPostingsForApplicantAiCompany(company) {
    const config = parseApplicantAiCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.slugLower;
    const pageHtml = await fetchApplicantAiCareersPage(config.careersUrl);
    return parseApplicantAiPostingsFromHtml(companyNameForPostings, config, pageHtml);
  }
  
  async function collectPostingsForGemCompany(company) {
    const config = parseGemCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.boardIdLower;
    const responseJson = await fetchGemJobBoard(config);
    return parseGemPostingsFromBatchResponse(companyNameForPostings, config, responseJson);
  }
  
  async function collectPostingsForJobApsCompany(company) {
    const config = parseJobApsCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const hostPrefix = String(config.host || "").split(".")[0];
    const companyNameForPostings = normalizedCompanyName || String(hostPrefix || "").toLowerCase();
    const { pageHtml, finalUrl } = await fetchJobApsCareersPage(config.boardUrl);
    return parseJobApsPostingsFromHtml(companyNameForPostings, config, pageHtml, finalUrl || config.boardUrl);
  }
  
  async function collectPostingsForJoinCompany(company) {
    const config = parseJoinCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companySlugLower;
    const { pageHtml, finalUrl } = await fetchJoinCompanyPage(config.boardUrl);
    const finalConfig = parseJoinCompany(finalUrl || config.boardUrl) || config;
    const nextData = extractJoinNextDataJsonFromHtml(pageHtml);
    return parseJoinPostingsFromNextData(companyNameForPostings, finalConfig.companySlug || config.companySlug, nextData);
  }
  
  async function collectPostingsForTalentreefCompany(company) {
    const config = parseTalentreefCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companyNameLower;
    const aliasResponse = await fetchTalentreefAlias(config);
    const { clientId, brand } = extractTalentreefAliasData(aliasResponse);
    if (!clientId) return [];
  
    const collected = [];
    const seenUrls = new Set();
    const pageSize = 100;
    let totalHits = null;
  
    for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
      const from = page * pageSize;
      const responseJson = await fetchTalentreefSearchResults(config, clientId, brand, from, pageSize);
      const batch = parseTalentreefPostingsFromSearchResponse(companyNameForPostings, config, responseJson);
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        seenUrls.add(postingUrl);
        collected.push(posting);
      }
  
      const totalRaw = responseJson?.hits?.total;
      const totalValue =
        typeof totalRaw === "number"
          ? totalRaw
          : totalRaw && typeof totalRaw === "object"
            ? Number(totalRaw?.value || 0)
            : 0;
      if (Number.isFinite(totalValue) && totalValue >= 0) {
        totalHits = totalValue;
      }
      if (batch.length < pageSize) break;
      if (Number.isFinite(totalHits) && from + pageSize >= Number(totalHits)) break;
    }
  
    return collected;
  }
  
  async function collectPostingsForCareerplugCompany(company) {
    const config = parseCareerplugCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const pageHtml = await fetchCareerplugJobsPage(config.jobsUrl);
    return parseCareerplugPostingsFromHtml(companyNameForPostings, config, pageHtml);
  }
  
  async function collectPostingsForAdpMyjobsCompany(company) {
    const config = parseAdpMyjobsCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companyNameLower;
    const careerSiteJson = await fetchAdpMyjobsCareerSite(config);
    const pageSize = 100;
    const seenUrls = new Set();
    const collected = [];
  
    for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
      const skip = page * pageSize;
      const responseJson = await fetchAdpMyjobsJobsPage(config, careerSiteJson, pageSize, skip);
      const batch = parseAdpMyjobsPostingsFromApi(companyNameForPostings, config, responseJson);
  
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        seenUrls.add(postingUrl);
        collected.push(posting);
      }
  
      const totalCount = Number(responseJson?.count);
      if (batch.length < pageSize) break;
      if (Number.isFinite(totalCount) && totalCount >= 0 && skip + pageSize >= totalCount) break;
    }
  
    return collected;
  }
  
  async function collectPostingsForAdpWorkforcenowCompany(company) {
    const config = parseAdpWorkforcenowCompany(company.url_string);
    if (!config) return [];
  
    const contentLinksJson = await fetchAdpWorkforcenowContentLinks(config);
    const companyNameForPostings = resolveAdpWorkforcenowCompanyName(company, config, contentLinksJson);
    const responseJson = await fetchAdpWorkforcenowJobsPage(config);
    return parseAdpWorkforcenowPostingsFromApi(companyNameForPostings, config, responseJson);
  }
  
  async function collectPostingsForPaylocityCompany(company) {
    const config = parsePaylocityCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const { pageHtml, finalUrl } = await fetchPaylocityBoardPage(config);
    const runtimeConfig = parsePaylocityCompany(finalUrl) || config;
    const companyNameForPostings = normalizedCompanyName || `paylocity_${String(runtimeConfig.companyId || "").toLowerCase()}`;
    const pageData = extractPaylocityPageDataJson(pageHtml);
    const rawPostings = parsePaylocityPostingsFromPageData(companyNameForPostings, runtimeConfig, pageData);
    const collected = [];
    const seenUrls = new Set();
  
    for (const posting of rawPostings) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      if (!String(posting?.posting_date || "").trim()) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }
  
    return collected;
  }
  
  async function collectPostingsForEightfoldCompany(company) {
    const config = parseEightfoldCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const { pageHtml, finalUrl } = await fetchEightfoldCareersPage(config);
    const runtimeConfig = parseEightfoldCompany(finalUrl) || config;
    const domainValue = extractEightfoldDomainFromHtml(pageHtml);
    if (!domainValue) {
      throw new Error("Eightfold window._EF_GROUP_ID value not found in careers page");
    }
  
    const { responseJson } = await fetchEightfoldJobsApi(runtimeConfig, domainValue);
    const fallbackCompanyName = `eightfold_${String(runtimeConfig.host || "").split(".")[0] || "board"}`;
    const companyNameForPostings = normalizedCompanyName || fallbackCompanyName;
    const rawPostings = parseEightfoldPostingsFromApi(companyNameForPostings, runtimeConfig, responseJson);
    const collected = [];
    const seenUrls = new Set();
  
    for (const posting of rawPostings) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      if (!String(posting?.posting_date || "").trim()) continue;
      seenUrls.add(postingUrl);
      collected.push(posting);
    }
  
    return collected;
  }
  
  async function collectPostingsForOracleCompany(company) {
    const config = parseOracleCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || "";
    const pageSize = 25;
    const seenUrls = new Set();
    const collected = [];
  
    for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
      const offset = page * pageSize;
      const responseJson = await fetchOracleJobRequisitionsPage(config, offset, pageSize);
      const batch = parseOraclePostingsFromApi(companyNameForPostings, config, responseJson);
  
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        if (!String(posting?.posting_date || "").trim()) continue;
        seenUrls.add(postingUrl);
        collected.push(posting);
      }
  
      if (!Boolean(responseJson?.hasMore)) break;
      if (batch.length === 0) break;
    }
  
    return collected;
  }
  
  async function collectPostingsForBrassringCompany(company) {
    const config = parseBrassringCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const { responseJson, companyName } = await fetchBrassringMatchedJobs(config);
    const companyNameForPostings =
      normalizedCompanyName ||
      String(companyName || "").trim() ||
      `${String(config.partnerId || "").trim()}_${String(config.siteId || "").trim()}`;
    return parseBrassringPostingsFromApi(companyNameForPostings, config, responseJson);
  }
  
  async function fetchApplitrackDetailFields(jobUrl) {
    const res = await fetchWithAtsRateLimit("applitrack", APPLITRACK_RATE_LIMIT_WAIT_MS, jobUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (!res.ok) return {};
    return extractApplitrackDetailFields(await res.text());
  }
  
  async function collectPostingsForApplitrackCompany(company) {
    const siteRoot = normalizeApplitrackUrl(company?.url_string);
    const outputUrl = new URL("jobpostings/Output.asp?all=1", siteRoot).toString();
    const res = await fetchWithAtsRateLimit("applitrack", APPLITRACK_RATE_LIMIT_WAIT_MS, outputUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Applitrack request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const pageHtml = await res.text();
    const companyName = String(company?.company_name || "").trim() || "Unknown Company";
    const postings = parseApplitrackPostings(pageHtml, siteRoot, companyName);
    let detailFetches = 0;
    for (const posting of postings) {
      if (detailFetches >= APPLITRACK_DETAIL_FETCH_LIMIT_PER_COMPANY) break;
      if (String(posting?.location || "").trim() && String(posting?.posting_date || "").trim()) continue;
      try {
        const detailUrl = buildApplitrackDetailUrl(siteRoot, posting.source_job_id, posting.job_posting_url);
        const detail = await fetchApplitrackDetailFields(detailUrl);
        detailFetches += 1;
        posting.location = posting.location || detail.location || null;
        posting.posting_date = posting.posting_date || detail.posting_date || null;
        posting.remote_type = posting.remote_type || detail.remote_type || null;
        posting.department = posting.department || detail.department || null;
      } catch {
        detailFetches += 1;
      }
    }
    return postings;
  }
  
  function parseHibobCompany(url) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) return null;
  
    const parsed = parseUrl(normalizedUrl);
    if (!parsed || !parsed.protocol || !parsed.host) return null;
  
    const host = String(parsed.hostname || "").toLowerCase();
    if (!host.endsWith(".careers.hibob.com")) return null;
  
    const companySubdomain = host.replace(".careers.hibob.com", "").trim();
    if (!companySubdomain) return null;
  
    return {
      baseOrigin: `${parsed.protocol}//${parsed.host}`,
      apiUrl: `${parsed.protocol}//${parsed.host}/api/job-ad`,
      companySubdomain
    };
  }
  
  async function fetchHibobJobBoard(config, boardUrl) {
    const boardResponse = await fetchWithAtsRateLimit("hibob", HIBOB_RATE_LIMIT_WAIT_MS, boardUrl, {
      method: "GET",
      headers: {
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (!boardResponse.ok) {
      const body = await boardResponse.text();
      throw new Error(`HiBob board request failed (${boardResponse.status}): ${body.slice(0, 180)}`);
    }
  
    const apiResponse = await fetchWithAtsRateLimit("hibob", HIBOB_RATE_LIMIT_WAIT_MS, config.apiUrl, {
      method: "GET",
      headers: {
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: boardUrl,
        Origin: config.baseOrigin
      }
    });
  
    if (!apiResponse.ok) {
      const body = await apiResponse.text();
      throw new Error(`HiBob API request failed (${apiResponse.status}): ${body.slice(0, 180)}`);
    }
    return apiResponse.json();
  }
  async function collectPostingsForHibobCompany(company) {
    const config = parseHibobCompany(company?.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companySubdomain;
    const responseJson = await fetchHibobJobBoard(config, company.url_string);
    return parseHibobPostingsFromApi(companyNameForPostings, config, responseJson);
  }
  
  function parseIsolvisolvedhireCompany(url) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) return null;
  
    const parsed = parseUrl(normalizedUrl);
    if (!parsed || !parsed.protocol || !parsed.host) return null;
    const host = String(parsed.hostname || "").toLowerCase();
    if (!host.endsWith(".isolvedhire.com")) return null;
  
    return {
      baseOrigin: `${parsed.protocol}//${parsed.host}`,
      boardUrl: normalizedUrl,
      host
    };
  }
  async function fetchIsolvisolvedhireJobBoard(config) {
    const boardResponse = await fetchWithAtsRateLimit(
      "isolvisolvedhire",
      ISOLVISOLVEDHIRE_RATE_LIMIT_WAIT_MS,
      config.boardUrl,
      {
        method: "GET",
        headers: {
          "User-Agent": DEFAULT_BROWSER_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        }
      }
    );
    if (!boardResponse.ok) {
      const body = await boardResponse.text();
      throw new Error(`isolvedhire board request failed (${boardResponse.status}): ${body.slice(0, 180)}`);
    }
    const boardHtml = await boardResponse.text();
    const domainId = extractIsolvisolvedhireDomainId(boardHtml);
    if (!domainId) throw new Error("isolvedhire domain_id not found in board HTML");
  
    const apiUrl = `${config.baseOrigin}/core/jobs/${encodeURIComponent(domainId)}?getParams=%7B%7D`;
    const apiResponse = await fetchWithAtsRateLimit(
      "isolvisolvedhire",
      ISOLVISOLVEDHIRE_RATE_LIMIT_WAIT_MS,
      apiUrl,
      {
        method: "GET",
        headers: {
          "User-Agent": DEFAULT_BROWSER_USER_AGENT,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: config.boardUrl,
          Origin: config.baseOrigin
        }
      }
    );
    if (!apiResponse.ok) {
      const body = await apiResponse.text();
      throw new Error(`isolvedhire API request failed (${apiResponse.status}): ${body.slice(0, 180)}`);
    }
    return apiResponse.json();
  }
  async function collectPostingsForIsolvisolvedhireCompany(company) {
    const config = parseIsolvisolvedhireCompany(company?.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.host.split(".")[0];
    const responseJson = await fetchIsolvisolvedhireJobBoard(config);
    return parseIsolvisolvedhirePostingsFromApi(companyNameForPostings, responseJson);
  }
  
  async function collectPostingsForManatalCompany(company) {
    const config = parseManatalCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.domainSlugLower;
  
    const landing = await fetchManatalCareersPage(config.careersUrl || company.url_string);
    const pageHtml = String(landing?.pageHtml || "");
    const runtimeConfig = extractManatalPageRuntimeConfig(pageHtml, config, landing?.finalUrl || config.careersUrl);
  
    const collected = [];
    const seenUrls = new Set();
  
    for (let page = 1; page <= MAX_PAGES_PER_COMPANY; page += 1) {
      let responseJson = {};
      try {
        responseJson = await fetchManatalJobsApiPage(runtimeConfig, page, 50);
      } catch (error) {
        const status = Number(error?.status || 0);
        if (status === 404) {
          break;
        }
        if (page > 1) break;
        throw error;
      }
  
      const batch = parseManatalPostingsFromApi(companyNameForPostings, runtimeConfig, responseJson);
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        seenUrls.add(postingUrl);
        collected.push(posting);
      }
  
      const results = Array.isArray(responseJson?.results) ? responseJson.results : [];
      const totalCount = Number(responseJson?.count);
      const nextUrl = String(responseJson?.next || "").trim();
      if (results.length === 0) break;
      if (!nextUrl) break;
      if (Number.isFinite(totalCount) && totalCount >= 0 && collected.length >= totalCount) break;
    }
  
    if (collected.length > 0) return collected;
  
    if (pageHtml) {
      const fallbackPostings = parseManatalPostingsFromHtml(companyNameForPostings, runtimeConfig, pageHtml);
      for (const posting of fallbackPostings) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        seenUrls.add(postingUrl);
        collected.push(posting);
      }
    }
  
    return collected;
  }
  
  async function collectPostingsForCareerspageCompany(company) {
    const config = parseCareerspageCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companySlugLower;
    const { pageHtml } = await fetchCareerspageBoardPage(config.boardUrl);
    return parseCareerspagePostingsFromHtml(companyNameForPostings, config, pageHtml);
  }
  
  async function collectPostingsForPageupCompany(company) {
    const config = parsePageupCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const { pageHtml, finalUrl } = await fetchPageupBoardPage(config);
    const finalParsed = parseUrl(finalUrl);
    const baseOrigin = `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`;
    const routeConfig = extractPageupRouteConfigFromUrl(finalUrl, config.routeType, config.locale);
    const runtimeConfig = {
      ...config,
      baseOrigin,
      boardUrl: finalUrl || config.boardUrl,
      routeType: routeConfig.routeType,
      locale: routeConfig.locale,
      searchUrl: `${baseOrigin}/${encodeURIComponent(config.boardId)}/${routeConfig.routeType}/${routeConfig.locale}/search/`
    };
  
    const inferredCompanyName = extractPageupCompanyNameFromTitle(pageHtml);
    const companyNameForPostings =
      normalizedCompanyName ||
      (inferredCompanyName !== "Unknown Company" ? inferredCompanyName : "") ||
      `pageup_${String(config.boardId || "").toLowerCase()}`;
    const { responseJson } = await fetchPageupSearchResults(runtimeConfig);
    const resultsHtml = String(responseJson?.results || "");
    const rawPostings = parsePageupPostingsFromResults(companyNameForPostings, runtimeConfig, resultsHtml);
    const collected = [];
    const seenUrls = new Set();
  
    for (const posting of rawPostings) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
  
      let postingDate = "";
      try {
        const detailsHtml = await fetchPageupDetailsPage(postingUrl);
        postingDate = String(extractPageupPostingDateFromDetailHtml(detailsHtml) || "").trim();
      } catch {
        continue;
      }
      if (!postingDate) continue;
  
      collected.push({
        ...posting,
        posting_date: postingDate
      });
      seenUrls.add(postingUrl);
    }
  
    return collected;
  }
  
  async function collectPostingsForHirebridgeCompany(company) {
    const config = parseHirebridgeCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || `hirebridge_${config.cid}`;
    const { pageHtml, finalUrl } = await fetchHirebridgeJobsPage(config);
    const finalParsed = parseUrl(finalUrl);
    const parseConfig = {
      ...config,
      baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
      boardUrl: finalUrl || config.boardUrl
    };
  
    const rawPostings = parseHirebridgePostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
    const collected = [];
    const seenUrls = new Set();
  
    for (const posting of rawPostings) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
  
      let postingDate = "";
      try {
        const detailsHtml = await fetchHirebridgeDetailsPage(parseConfig, postingUrl);
        postingDate = String(extractHirebridgeDatePostedFromDetailHtml(detailsHtml) || "").trim();
      } catch {
        continue;
      }
      if (!postingDate) continue;
  
      collected.push({
        ...posting,
        posting_date: postingDate
      });
      seenUrls.add(postingUrl);
    }
  
    return collected;
  }
  
  async function collectPostingsForTeamtailorCompany(company) {
    const config = parseTeamtailorCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const { pageHtml, finalUrl } = await fetchTeamtailorJobsPage(config);
    const finalParsed = parseUrl(finalUrl);
    const parseConfig = {
      ...config,
      baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
      jobsUrl: finalUrl || config.jobsUrl
    };
    return parseTeamtailorPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
  }
  
  async function collectPostingsForFreshteamCompany(company) {
    const config = parseFreshteamCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const { pageHtml, finalUrl } = await fetchFreshteamJobsPage(config);
    const finalParsed = parseUrl(finalUrl);
    const parseConfig = {
      ...config,
      baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
      jobsUrl: finalUrl || config.jobsUrl
    };
    return parseFreshteamPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
  }
  
  async function collectPostingsForSagehrCompany(company) {
    const config = parseSagehrCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const { pageHtml, finalUrl } = await fetchSagehrJobsPage(config);
    const finalParsed = parseUrl(finalUrl);
    const parseConfig = {
      ...config,
      baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
      boardUrl: finalUrl || config.boardUrl
    };
    const inferredCompanyName = extractSagehrCompanyNameFromHtml(pageHtml);
    const companyNameForPostings =
      normalizedCompanyName ||
      (inferredCompanyName !== "Unknown Company" ? inferredCompanyName : "") ||
      `sagehr_${config.companySlugLower}`;
  
    return parseSagehrPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
  }
  
  async function collectPostingsForPeopleforceCompany(company) {
    const config = parsePeopleforceCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const { pageHtml, finalUrl } = await fetchPeopleforceJobsPage(config);
    if (!pageHtml) return [];
  
    const finalParsed = parseUrl(finalUrl);
    const parseConfig = {
      ...config,
      baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
      jobsUrl: finalUrl || config.jobsUrl
    };
    return parsePeopleforcePostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
  }
  
  async function collectPostingsForSimplicantCompany(company) {
    const config = parseSimplicantCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const { pageHtml, finalUrl } = await fetchSimplicantJobsPage(config);
    if (/page you were looking for could not be found/i.test(pageHtml)) return [];
  
    const finalParsed = parseUrl(finalUrl);
    const parseConfig = {
      ...config,
      baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
      jobsUrl: finalUrl || config.jobsUrl
    };
    return parseSimplicantPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
  }
  
  async function collectPostingsForLoxoCompany(company) {
    const config = parseLoxoCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companySlugLower;
    const { pageHtml, finalUrl } = await fetchLoxoJobsPage(config);
    const finalParsed = parseUrl(finalUrl);
    const parseConfig = {
      ...config,
      baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
      boardUrl: finalUrl || config.boardUrl
    };
    return parseLoxoPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
  }
  
  async function collectPostingsForPinpointHqCompany(company) {
    const config = parsePinpointHqCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const responseJson = await fetchPinpointHqJobBoard(config);
    return parsePinpointHqPostingsFromApi(companyNameForPostings, config, responseJson);
  }
  
  async function collectPostingsForRecruitCrmCompany(company) {
    const config = parseRecruitCrmCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.account;
    const limit = 100;
    const seenUrls = new Set();
    const collected = [];
  
    for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
      const offset = page * limit;
      const responseJson = await fetchRecruitCrmJobsPage(config, limit, offset);
      const batch = parseRecruitCrmPostingsFromApi(companyNameForPostings, config, responseJson);
  
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        seenUrls.add(postingUrl);
        collected.push(posting);
      }
  
      if (batch.length < limit) break;
    }
  
    return collected;
  }
  
  async function collectPostingsForRipplingCompany(company) {
    const config = parseRipplingCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companySlug;
    const pageSize = 100;
    const seenUrls = new Set();
    const collected = [];
  
    for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
      const responseJson = await fetchRipplingJobsPage(config, page, pageSize);
      const batch = parseRipplingPostingsFromApi(companyNameForPostings, config, responseJson);
  
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        seenUrls.add(postingUrl);
        collected.push(posting);
      }
  
      const totalPagesRaw = Number(responseJson?.totalPages);
      const totalPages = Number.isFinite(totalPagesRaw) && totalPagesRaw > 0 ? totalPagesRaw : 1;
      if (page + 1 >= totalPages) break;
      if (batch.length < pageSize) break;
    }
  
    return collected;
  }
  
  async function collectPostingsForCareerpuckCompany(company) {
    const config = parseCareerpuckCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.boardSlugLower;
    const responseJson = await fetchCareerpuckJobBoard(config);
    return parseCareerpuckPostingsFromApi(companyNameForPostings, responseJson);
  }
  
  async function collectPostingsForFountainCompany(company) {
    const config = parseFountainCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companySlugLower;
    const responseJson = await fetchFountainJobBoard(config);
    return parseFountainPostingsFromApi(companyNameForPostings, config, responseJson);
  }
  
  async function collectPostingsForGetroCompany(company) {
    const config = parseGetroCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const pageHtml = await fetchGetroJobsPage(config.jobsUrl);
    return parseGetroPostingsFromHtml(companyNameForPostings, config, pageHtml);
  }
  
  async function collectPostingsForTalentlyftCompany(company) {
    const config = parseTalentlyftCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
    const { pageHtml: landingHtml, finalUrl } = await fetchTalentlyftLandingPage(config.careersUrl);
    const initialConfig = extractTalentlyftInitialConfig(landingHtml, finalUrl || config.careersUrl);
  
    const finalParsed = parseUrl(finalUrl);
    const baseOrigin = `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`;
    const runtimeConfig = {
      ...config,
      ...initialConfig,
      baseOrigin,
      websiteUrl: String(initialConfig?.websiteUrl || baseOrigin).replace(/\/+$/, ""),
      apiUrl: String(initialConfig?.apiUrl || `${baseOrigin}/JobList/`).replace(/\/+$/, "") + "/"
    };
  
    const collected = [];
    const seenUrls = new Set();
    let totalPages = 1;
  
    for (let page = 1; page <= Math.min(MAX_PAGES_PER_COMPANY, totalPages); page += 1) {
      const fragmentHtml = await fetchTalentlyftJobListFragment(runtimeConfig, page, 20);
      const batch = parseTalentlyftPostingsFromFragment(companyNameForPostings, runtimeConfig, fragmentHtml);
  
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        seenUrls.add(postingUrl);
        collected.push(posting);
      }
  
      totalPages = Math.max(totalPages, extractTalentlyftTotalPages(fragmentHtml));
      if (batch.length === 0 && page >= totalPages) break;
    }
  
    return collected;
  }
  
  async function collectPostingsForTalexioCompany(company) {
    const config = parseTalexioCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  
    const collected = [];
    const seenUrls = new Set();
    const pageSize = 10;
    let totalVacancies = null;
  
    for (let page = 1; page <= MAX_PAGES_PER_COMPANY; page += 1) {
      const responseJson = await fetchTalexioJobsPage(config, page, pageSize);
      const batch = parseTalexioPostingsFromApi(companyNameForPostings, config, responseJson);
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        seenUrls.add(postingUrl);
        collected.push(posting);
      }
  
      const vacancies = Array.isArray(responseJson?.vacancies) ? responseJson.vacancies : [];
      const totalRaw = Number(responseJson?.totalVacancies);
      if (Number.isFinite(totalRaw) && totalRaw >= 0) {
        totalVacancies = totalRaw;
      }
  
      if (vacancies.length < pageSize) break;
      if (Number.isFinite(totalVacancies) && collected.length >= Number(totalVacancies)) break;
    }
  
    return collected;
  }
  
  async function collectPostingsForSapHrCloudCompany(company) {
    const config = parseSapHrCloudCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companyNameLower;
    const { pageHtml, finalUrl } = await fetchSapHrCloudBoardPage(company.url_string || config.boardUrl);
    return parseSapHrCloudPostingsFromHtml(companyNameForPostings, config, pageHtml, finalUrl);
  }
  
  async function collectPostingsForRecruiteeCompany(company) {
    const config = parseRecruiteeCompany(company.url_string);
    if (!config) return [];
  
    const response = await fetchRecruiteePublicApp(config.baseUrl);
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings =
      normalizedCompanyName && normalizedCompanyName.toLowerCase() !== "recruitee"
        ? normalizedCompanyName
        : config.subdomain;
  
    return parseRecruiteePostingsFromPublicApp(companyNameForPostings, config, response);
  }
  
  async function collectPostingsForUltiProCompany(company) {
    const config = parseUltiProCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.tenantLower;
    const postings = [];
    const seenIds = new Set();
    let skip = 0;
  
    for (let page = 0; page < MAX_PAGES_PER_COMPANY; page += 1) {
      const response = await fetchUltiProSearchResults(config, ULTIPRO_PAGE_SIZE, skip);
      const opportunities = Array.isArray(response?.opportunities) ? response.opportunities : [];
      if (opportunities.length === 0) break;
  
      for (const posting of parseUltiProPostingsFromApi(companyNameForPostings, config, response)) {
        const opportunityId = String(posting?.source_job_id || "").trim();
        if (!opportunityId || seenIds.has(opportunityId)) continue;
        postings.push(posting);
        seenIds.add(opportunityId);
      }
  
      const totalCount = Number(response?.totalCount);
      if (opportunities.length < ULTIPRO_PAGE_SIZE) break;
      if (Number.isFinite(totalCount) && skip + ULTIPRO_PAGE_SIZE >= totalCount) break;
      skip += ULTIPRO_PAGE_SIZE;
    }
  
    return postings;
  }
  
  async function collectPostingsForTaleoCompany(company) {
    const config = parseTaleoCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.careerSectionLower;
    const pageHtml = await fetchTaleoJobSearchPage(company.url_string);
    const { portal, tokenName, tokenValue } = extractTaleoRestConfig(pageHtml);
    const postings = [];
    const seenUrls = new Set();
  
    if (portal) {
      for (let pageNo = 1; pageNo <= MAX_PAGES_PER_COMPANY; pageNo += 1) {
        const response = await fetchTaleoRestSearchResults(config, portal, tokenName, tokenValue, pageNo);
        const requisitions = Array.isArray(response?.requisitionList) ? response.requisitionList : [];
        if (requisitions.length === 0) break;
  
        const batch = extractTaleoPostingsFromRest(companyNameForPostings, config, requisitions);
        for (const posting of batch) {
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
  
    if (postings.length > 0) {
      return postings;
    }
  
    const ajaxText = await fetchTaleoAjaxSearchResults(config, tokenValue);
    const ajaxPostings = extractTaleoPostingsFromAjax(companyNameForPostings, config, ajaxText);
    for (const posting of ajaxPostings) {
      if (seenUrls.has(posting.job_posting_url)) continue;
      seenUrls.add(posting.job_posting_url);
      postings.push(posting);
    }
  
    return postings;
  }async function fetchGovernmentJobsViewHtml(url, params) {
    const requestUrl = new URL(url);
    for (const [key, value] of Object.entries(params || {})) {
      requestUrl.searchParams.set(key, String(value));
    }
  
    const res = await fetchWithAtsRateLimit("governmentjobs", GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS, requestUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GovernmentJobs request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const text = await res.text();
    return extractGovernmentJobsViewHtmlFromResponse(res, text);
  }
  
  async function collectPostingsForGovernmentJobsDynamic() {
    const postings = [];
    const seenUrls = new Set();
    const timestamp = Date.now().toString();
  
    const firstViewHtml = await fetchGovernmentJobsViewHtml("https://www.governmentjobs.com/jobs", {
      keyword: "",
      location: "",
      daysposted: "1",
      isFiltered: "true",
      _: timestamp
    });
  
    const firstBatch = parseGovernmentJobsPostingsFromViewHtml(firstViewHtml);
    for (const posting of firstBatch) {
      if (seenUrls.has(posting.job_posting_url)) continue;
      seenUrls.add(posting.job_posting_url);
      postings.push(posting);
    }
  
    const lastPage = extractGovernmentJobsLastPage(firstViewHtml);
    for (let page = 2; page <= lastPage; page += 1) {
      const pageViewHtml = await fetchGovernmentJobsViewHtml("https://www.governmentjobs.com/jobs", {
        page: String(page),
        daysPosted: "1",
        isTransfer: "False",
        isPromotional: "False",
        _: Date.now().toString()
      });
  
      const batch = parseGovernmentJobsPostingsFromViewHtml(pageViewHtml);
      for (const posting of batch) {
        if (seenUrls.has(posting.job_posting_url)) continue;
        seenUrls.add(posting.job_posting_url);
        postings.push(posting);
      }
    }
  
    return postings;
  }
  
  async function collectPostingsForSmartRecruitersDynamic(limit = 100) {
    const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const endpoint = new URL("https://jobs.smartrecruiters.com/sr-jobs/search");
    endpoint.searchParams.set("limit", String(cappedLimit));
    endpoint.searchParams.set("_", String(Date.now()));
  
    const res = await fetchWithAtsRateLimit(
      "smartrecruiters",
      SMARTRECRUITERS_RATE_LIMIT_WAIT_MS,
      endpoint.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9"
        }
      }
    );
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SmartRecruiters request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const payload = await res.json();
    return parseSmartRecruitersPostingsFromApi("", {}, payload);
  }async function collectPostingsForPoliceappDynamic() {
    const endpoint =
      "https://www.policeapp.com/jobs/urlrewrite_jobpostings/jobResultsAjax.ashx?j=0&r=50&s=0&p=0";
    const res = await fetchWithAtsRateLimit("policeapp", POLICEAPP_RATE_LIMIT_WAIT_MS, endpoint, {
      method: "GET",
      headers: {
        Accept: "text/html, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PoliceApp request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const html = await res.text();
    return parsePoliceappPostingsFromHtml(html);
  }
  
  function getUsajobsApiConfig(env = process.env) {
    const authorizationKey = String(
      env.OPENJOBSLOTS_USAJOBS_AUTHORIZATION_KEY ||
      env.USAJOBS_AUTHORIZATION_KEY ||
      env.USAJOBS_API_KEY ||
      ""
    ).trim();
    if (!authorizationKey) {
      throw new Error("USAJobs official API key is not configured; set OPENJOBSLOTS_USAJOBS_AUTHORIZATION_KEY");
    }
    const userAgent = String(
      env.OPENJOBSLOTS_USAJOBS_USER_AGENT ||
      env.USAJOBS_USER_AGENT ||
      env.OPENJOBSLOTS_CONTACT_EMAIL ||
      "openjobslots.com"
    ).trim();
    return { authorizationKey, userAgent };
  }async function collectPostingsForUsajobsDynamic(maxPages = 2, resultsPerPage = 25) {
    const { authorizationKey, userAgent } = getUsajobsApiConfig(process.env);
    const collected = [];
    const seenUrls = new Set();
    let totalPages = 1;
    const pageLimit = Math.max(1, Math.min(20, Number(maxPages) || 2));
    const perPage = Math.max(1, Math.min(500, Number(resultsPerPage) || 25));
  
    for (let page = 1; page <= pageLimit; page += 1) {
      const url = new URL(USAJOBS_SEARCH_API_URL);
      url.searchParams.set("HiringPath", "public");
      url.searchParams.set("DatePosted", "30");
      url.searchParams.set("SortField", "DatePosted");
      url.searchParams.set("SortDirection", "Desc");
      url.searchParams.set("ResultsPerPage", String(perPage));
      url.searchParams.set("Page", String(page));
  
      const res = await fetchWithAtsRateLimit("usajobs", USAJOBS_RATE_LIMIT_WAIT_MS, url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Host: "data.usajobs.gov",
          "User-Agent": userAgent,
          "Authorization-Key": authorizationKey
        }
      });
  
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`USAJobs official search request failed (${res.status}): ${body.slice(0, 180)}`);
      }
  
      const payload = await res.json();
      const numberOfPagesRaw = Number(payload?.SearchResult?.UserArea?.NumberOfPages || payload?.Pager?.NumberOfPages);
      if (Number.isFinite(numberOfPagesRaw) && numberOfPagesRaw > 0) {
        totalPages = numberOfPagesRaw;
      }
  
      const batch = parseUsajobsPostingsFromPayload(payload);
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        collected.push(posting);
        seenUrls.add(postingUrl);
      }
  
      if (page >= totalPages) break;
    }
  
    return collected;
  }async function fetchK12jobspotSearchPayload(pageStartIndex, pageEndIndex) {
    const endpoint = "https://api.k12jobspot.com/api/Jobs/Search";
    const requestBody = {
      searchPhrase: "",
      filters: [
        { name: "positionAreas", filters: [] },
        { name: "gradeLevels", filters: [] },
        { name: "jobTypes", filters: [] }
      ],
      pageStartIndex,
      pageEndIndex
    };
  
    const res = await fetchWithAtsRateLimit("k12jobspot", K12JOBSPOT_RATE_LIMIT_WAIT_MS, endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        Origin: "https://www.k12jobspot.com",
        Referer: "https://www.k12jobspot.com/"
      },
      body: JSON.stringify(requestBody)
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`K12JobSpot request failed (${res.status}): ${body.slice(0, 180)}`);
    }
    return res.json();
  }
  
  async function collectPostingsForK12jobspotDynamic(pageWindowSize = 25) {
    const windowSize = Math.max(1, Number(pageWindowSize) || 25);
    const postings = [];
    const seenUrls = new Set();
    const referenceEpoch = nowEpochSeconds();
    let pageStartIndex = 1;
  
    while (true) {
      const pageEndIndex = pageStartIndex + windowSize - 1;
      const payload = await fetchK12jobspotSearchPayload(pageStartIndex, pageEndIndex);
      const batch = parseK12jobspotPostingsFromPayload(payload);
      if (batch.length === 0) break;
  
      let hasWithin24h = false;
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;
        hasWithin24h = true;
        postings.push(posting);
        seenUrls.add(postingUrl);
      }
  
      if (!hasWithin24h) break;
      pageStartIndex = pageEndIndex + 1;
    }
  
    return postings;
  }
  async function fetchSchoolspringSearchPayload(page, size = 25) {
    const endpoint = new URL("https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch");
    endpoint.searchParams.set("domainName", "");
    endpoint.searchParams.set("keyword", "");
    endpoint.searchParams.set("location", "");
    endpoint.searchParams.set("category", "");
    endpoint.searchParams.set("gradelevel", "");
    endpoint.searchParams.set("jobtype", "");
    endpoint.searchParams.set("organization", "");
    endpoint.searchParams.set("swLat", "");
    endpoint.searchParams.set("swLon", "");
    endpoint.searchParams.set("neLat", "");
    endpoint.searchParams.set("neLon", "");
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("size", String(size));
    endpoint.searchParams.set("sortDateAscending", "false");
  
    const res = await fetchWithAtsRateLimit("schoolspring", SCHOOLSPRING_RATE_LIMIT_WAIT_MS, endpoint.toString(), {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://www.schoolspring.com",
        Referer: "https://www.schoolspring.com/"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SchoolSpring request failed (${res.status}): ${body.slice(0, 180)}`);
    }
    return res.json();
  }
  
  async function collectPostingsForSchoolspringDynamic(pageSize = 25) {
    const size = Math.max(1, Number(pageSize) || 25);
    const postings = [];
    const seenUrls = new Set();
    const referenceEpoch = nowEpochSeconds();
    let page = 1;
  
    while (true) {
      const payload = await fetchSchoolspringSearchPayload(page, size);
      const batch = parseSchoolspringPostingsFromPayload(payload);
      if (batch.length === 0) break;
  
      let hasWithin24h = false;
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;
        hasWithin24h = true;
        postings.push(posting);
        seenUrls.add(postingUrl);
      }
  
      if (!hasWithin24h) break;
      page += 1;
    }
  
    return postings;
  }async function collectPostingsForCalcareersDynamic() {
    const endpoint = "https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx";
    const headers = {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: endpoint
    };
    const referenceEpoch = nowEpochSeconds();
    const postings = [];
    const seenUrls = new Set();
    const pendingTargets = [];
    const visitedTargets = new Set();
  
    const landing = await fetchWithAtsRateLimit("calcareers", CALCAREERS_RATE_LIMIT_WAIT_MS, endpoint, {
      method: "GET",
      headers
    });
    if (!landing.ok) {
      const body = await landing.text();
      throw new Error(`CalCareers landing request failed (${landing.status}): ${body.slice(0, 180)}`);
    }
  
    let hidden = extractCalcareersHiddenInputs(await landing.text());
    let nextEventTarget = "ctl00$cphMainContent$btnSearch";
    let rowCountApplied = false;
  
    while (true) {
      const payload = buildCalcareersPostPayload(hidden, nextEventTarget);
      if (nextEventTarget === "ctl00$cphMainContent$ddlRowCount") {
        payload["ctl00$cphMainContent$ddlRowCount"] = "100";
      }
  
      const res = await fetchWithAtsRateLimit("calcareers", CALCAREERS_RATE_LIMIT_WAIT_MS, endpoint, {
        method: "POST",
        headers,
        body: new URLSearchParams(payload).toString()
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`CalCareers postback failed (${res.status}): ${body.slice(0, 180)}`);
      }
      const pageHtml = await res.text();
      hidden = extractCalcareersHiddenInputs(pageHtml);
  
      const batch = parseCalcareersPostingsFromHtml(pageHtml);
      let hasWithin24h = false;
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;
        postings.push(posting);
        seenUrls.add(postingUrl);
        hasWithin24h = true;
      }
  
      if (!rowCountApplied) {
        rowCountApplied = true;
        nextEventTarget = "ctl00$cphMainContent$ddlRowCount";
        continue;
      }
  
      if (!hasWithin24h) break;
  
      const pagerTargets = extractCalcareersPagerTargets(pageHtml);
      for (const target of pagerTargets) {
        if (visitedTargets.has(target)) continue;
        if (!pendingTargets.includes(target)) {
          pendingTargets.push(target);
        }
      }
      while (pendingTargets.length > 0 && visitedTargets.has(pendingTargets[0])) {
        pendingTargets.shift();
      }
      if (pendingTargets.length === 0) break;
  
      nextEventTarget = pendingTargets.shift();
      visitedTargets.add(nextEventTarget);
    }
  
    return postings;
  }async function collectPostingsForCaloppsDynamic(maxPages = 25) {
    let nextPageUrl = "https://www.calopps.org/job-search-list";
    let pagesFetched = 0;
    const pageLimit = Math.max(1, Math.min(100, Number(maxPages) || 25));
    const postings = [];
    const seenUrls = new Set();
  
    while (nextPageUrl && pagesFetched < pageLimit) {
      const res = await fetchWithAtsRateLimit("calopps", CALOPPS_RATE_LIMIT_WAIT_MS, nextPageUrl, {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`CalOpps request failed (${res.status}): ${body.slice(0, 180)}`);
      }
      const pageHtml = await res.text();
      const batch = parseCaloppsPostingsFromHtml(pageHtml, nextPageUrl);
      for (const posting of batch) {
        const postingUrl = String(posting?.job_posting_url || "").trim();
        if (!postingUrl || seenUrls.has(postingUrl)) continue;
        postings.push(posting);
        seenUrls.add(postingUrl);
      }
  
      pagesFetched += 1;
      nextPageUrl = extractCaloppsNextPageUrl(pageHtml, nextPageUrl);
    }
  
    return postings;
  }async function collectPostingsForStatejobsnyDynamic() {
    const endpoint = buildStatejobsnyWindowUrl();
    const res = await fetchWithAtsRateLimit("statejobsny", STATEJOBSNY_RATE_LIMIT_WAIT_MS, endpoint, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache"
      }
    });
  
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`StateJobsNY request failed (${res.status}): ${body.slice(0, 180)}`);
    }
  
    const pageHtml = await res.text();
    return parseStatejobsnyPostingsFromHtml(pageHtml, endpoint);
  }
  
  async function collectPostingsForCompany(company) {
    const atsName = String(company?.ATS_name || "").trim().toLowerCase();
    if (atsName === "workday") {
      return collectTodayPostingsForWorkdayCompany(company);
    }
    if (atsName === "ashbyhq") {
      return collectPostingsForAshbyCompany(company);
    }
    if (atsName === "greenhouseio" || atsName === "greenhouse.io" || atsName === "greenhouse") {
      if (isRegistryPilotSourceForRuntime("greenhouse")) return collectPostingsForRegistryPilotCompany(company, "greenhouse");
      return collectPostingsForGreenhouseCompany(company);
    }
    if (atsName === "leverco" || atsName === "lever.co" || atsName === "lever") {
      return collectPostingsForLeverCompany(company);
    }
    if (atsName === "jobvite" || atsName === "jobvite.com" || atsName === "jobvitecom") {
      return collectPostingsForJobviteCompany(company);
    }
    if (atsName === "applicantpro" || atsName === "applicantpro.com" || atsName === "applicantprocom") {
      return collectPostingsForApplicantProCompany(company);
    }
    if (atsName === "applytojob" || atsName === "applytojob.com" || atsName === "applytojobcom") {
      return collectPostingsForRegistryPilotCompany(company, "applytojob");
    }
    if (
      atsName === "theapplicantmanager" ||
      atsName === "theapplicantmanager.com" ||
      atsName === "theapplicantmanagercom"
    ) {
      return collectPostingsForTheApplicantManagerCompany(company);
    }
    if (atsName === "breezy" || atsName === "breezyhr" || atsName === "breezy.hr" || atsName === "breezyhrcom") {
      return collectPostingsForBreezyCompany(company);
    }
    if (atsName === "icims" || atsName === "icims.com" || atsName === "icimscom") {
      if (isRegistryPilotSourceForRuntime("icims")) return collectPostingsForRegistryPilotCompany(company, "icims");
      return collectPostingsForIcimsCompany(company);
    }
    if (atsName === "zoho" || atsName === "zohorecruit" || atsName === "zohorecruit.com" || atsName === "zohorecruitcom") {
      return collectPostingsForZohoCompany(company);
    }
    if (atsName === "applicantai" || atsName === "applicantai.com" || atsName === "applicantaicom") {
      return collectPostingsForApplicantAiCompany(company);
    }
    if (atsName === "gem" || atsName === "jobs.gem.com" || atsName === "gem.com" || atsName === "gemcom") {
      return collectPostingsForGemCompany(company);
    }
    if (atsName === "jobaps" || atsName === "jobapscloud.com" || atsName === "jobapscloudcom") {
      return collectPostingsForJobApsCompany(company);
    }
    if (atsName === "join" || atsName === "join.com" || atsName === "joincom") {
      return collectPostingsForJoinCompany(company);
    }
    if (
      atsName === "talentreef" ||
      atsName === "jobappnetwork.com" ||
      atsName === "jobappnetworkcom" ||
      atsName === "apply.jobappnetwork.com" ||
      atsName === "applyjobappnetworkcom"
    ) {
      return collectPostingsForTalentreefCompany(company);
    }
    if (atsName === "careerplug" || atsName === "careerplug.com" || atsName === "careerplugcom") {
      return collectPostingsForCareerplugCompany(company);
    }
    if (atsName === "bamboohr" || atsName === "bamboohr.com" || atsName === "bamboohrcom") {
      return collectPostingsForRegistryPilotCompany(company, "bamboohr");
    }
    if (atsName === "adp_myjobs" || atsName === "adpmyjobs") {
      return collectPostingsForAdpMyjobsCompany(company);
    }
    if (
      atsName === "adp_workforcenow" ||
      atsName === "adpworkforcenow" ||
      atsName === "workforcenow.adp.com" ||
      atsName === "workforcenowadpcom"
    ) {
      return collectPostingsForAdpWorkforcenowCompany(company);
    }
    if (
      atsName === "paylocity" ||
      atsName === "paylocity.com" ||
      atsName === "paylocitycom" ||
      atsName === "recruiting.paylocity.com" ||
      atsName === "recruitingpaylocitycom"
    ) {
      return collectPostingsForPaylocityCompany(company);
    }
    if (atsName === "eightfold" || atsName === "eightfold.ai" || atsName === "eightfoldai") {
      return collectPostingsForEightfoldCompany(company);
    }
    if (
      atsName === "oracle" ||
      atsName === "oraclecloud" ||
      atsName === "oraclecloud.com" ||
      atsName === "oraclecloudcom"
    ) {
      return collectPostingsForOracleCompany(company);
    }
    if (
      atsName === "brassring" ||
      atsName === "brassring.com" ||
      atsName === "brassringcom" ||
      atsName === "sjobs.brassring.com" ||
      atsName === "sjobsbrassringcom"
    ) {
      return collectPostingsForBrassringCompany(company);
    }
    if (atsName === "applitrack" || atsName === "applitrack.com" || atsName === "applitrackcom") {
      return collectPostingsForApplitrackCompany(company);
    }
    if (atsName === "hibob" || atsName === "hibob.com" || atsName === "hibobcom" || atsName === "careers.hibob.com" || atsName === "careershibobcom") {
      return collectPostingsForHibobCompany(company);
    }
    if (
      atsName === "isolvisolvedhire" ||
      atsName === "isolvedhire" ||
      atsName === "isolvedhire.com" ||
      atsName === "isolvedhirecom"
    ) {
      return collectPostingsForIsolvisolvedhireCompany(company);
    }
    if (
      atsName === "manatal" ||
      atsName === "manatal.com" ||
      atsName === "manatalcom" ||
      atsName === "careers-page.com" ||
      atsName === "careerspagecom"
    ) {
      return collectPostingsForManatalCompany(company);
    }
    if (atsName === "careerspage" || atsName === "careerspage.io" || atsName === "careerspageio") {
      return collectPostingsForCareerspageCompany(company);
    }
    if (
      atsName === "pageup" ||
      atsName === "pageuppeople" ||
      atsName === "pageuppeople.com" ||
      atsName === "pageuppeoplecom" ||
      atsName === "careers.pageuppeople.com" ||
      atsName === "careerspageuppeoplecom"
    ) {
      return collectPostingsForPageupCompany(company);
    }
    if (
      atsName === "hirebridge" ||
      atsName === "hirebridge.com" ||
      atsName === "hirebridgecom" ||
      atsName === "recruit.hirebridge.com" ||
      atsName === "recruithirebridgecom"
    ) {
      return collectPostingsForHirebridgeCompany(company);
    }
    if (atsName === "teamtailor" || atsName === "teamtailor.com" || atsName === "teamtailorcom") {
      return collectPostingsForTeamtailorCompany(company);
    }
    if (atsName === "freshteam" || atsName === "freshteam.com" || atsName === "freshteamcom") {
      return collectPostingsForFreshteamCompany(company);
    }
    if (
      atsName === "sagehr" ||
      atsName === "sage.hr" ||
      atsName === "talent.sage.hr" ||
      atsName === "talentsagehr"
    ) {
      return collectPostingsForSagehrCompany(company);
    }
    if (atsName === "loxo" || atsName === "loxo.co" || atsName === "loxoco") {
      return collectPostingsForLoxoCompany(company);
    }
    if (atsName === "peopleforce" || atsName === "peopleforce.io" || atsName === "peopleforceio") {
      return collectPostingsForPeopleforceCompany(company);
    }
    if (atsName === "simplicant" || atsName === "simplicant.com" || atsName === "simplicantcom") {
      return collectPostingsForSimplicantCompany(company);
    }
    if (atsName === "pinpointhq" || atsName === "pinpointhq.com" || atsName === "pinpointhqcom") {
      return collectPostingsForPinpointHqCompany(company);
    }
    if (atsName === "recruitcrm" || atsName === "recruitcrm.io" || atsName === "recruitcrmiocom" || atsName === "recruitcrmio") {
      return collectPostingsForRecruitCrmCompany(company);
    }
    if (atsName === "rippling" || atsName === "rippling.com" || atsName === "ripplingcom" || atsName === "ats.rippling.com" || atsName === "atsripplingcom") {
      return collectPostingsForRipplingCompany(company);
    }
    if (atsName === "careerpuck" || atsName === "careerpuck.com" || atsName === "careerpuckcom") {
      return collectPostingsForCareerpuckCompany(company);
    }
    if (atsName === "fountain" || atsName === "fountain.com" || atsName === "fountaincom") {
      return collectPostingsForFountainCompany(company);
    }
    if (atsName === "getro" || atsName === "getro.com" || atsName === "getrocom") {
      return collectPostingsForGetroCompany(company);
    }
    if (atsName === "governmentjobs" || atsName === "governmentjobs.com" || atsName === "governmentjobscom") {
      return collectPostingsForGovernmentJobsDynamic();
    }
    if (
      atsName === "smartrecruiters" ||
      atsName === "smartrecruiters.com" ||
      atsName === "smartrecruiterscom" ||
      atsName === "jobs.smartrecruiters.com" ||
      atsName === "jobssmartrecruiterscom"
    ) {
      return collectPostingsForSmartRecruitersDynamic();
    }
    if (atsName === "policeapp" || atsName === "policeapp.com" || atsName === "policeappcom" || atsName === "www.policeapp.com" || atsName === "wwwpoliceappcom") {
      return collectPostingsForPoliceappDynamic();
    }
    if (atsName === "usajobs" || atsName === "usajobs.gov" || atsName === "usajobsgov" || atsName === "www.usajobs.gov" || atsName === "wwwusajobsgov") {
      return collectPostingsForUsajobsDynamic();
    }
    if (atsName === "k12jobspot" || atsName === "k12jobspot.com" || atsName === "k12jobspotcom" || atsName === "www.k12jobspot.com" || atsName === "wwwk12jobspotcom" || atsName === "api.k12jobspot.com" || atsName === "apik12jobspotcom") {
      return collectPostingsForK12jobspotDynamic();
    }
    if (atsName === "schoolspring" || atsName === "schoolspring.com" || atsName === "schoolspringcom" || atsName === "api.schoolspring.com" || atsName === "apischoolspringcom" || atsName === "www.schoolspring.com" || atsName === "wwwschoolspringcom") {
      return collectPostingsForSchoolspringDynamic();
    }
    if (
      atsName === "calcareers" ||
      atsName === "calcareers.ca.gov" ||
      atsName === "calcareerscagov" ||
      atsName === "www.calcareers.ca.gov" ||
      atsName === "wwwcalcareerscagov"
    ) {
      return collectPostingsForCalcareersDynamic();
    }
    if (
      atsName === "calopps" ||
      atsName === "calopps.org" ||
      atsName === "caloppsorg" ||
      atsName === "www.calopps.org" ||
      atsName === "wwwcaloppsorg"
    ) {
      return collectPostingsForCaloppsDynamic();
    }
    if (
      atsName === "statejobsny" ||
      atsName === "statejobsny.com" ||
      atsName === "statejobsnycom" ||
      atsName === "www.statejobsny.com" ||
      atsName === "wwwstatejobsnycom"
    ) {
      return collectPostingsForStatejobsnyDynamic();
    }
    if (atsName === "hrmdirect" || atsName === "hrmdirect.com" || atsName === "hrmdirectcom") {
      return collectPostingsForRegistryPilotCompany(company, "hrmdirect");
    }
    if (atsName === "talentlyft" || atsName === "talentlyft.com" || atsName === "talentlyftcom") {
      return collectPostingsForTalentlyftCompany(company);
    }
    if (atsName === "talexio" || atsName === "talexio.com" || atsName === "talexiocom") {
      return collectPostingsForTalexioCompany(company);
    }
    if (
      atsName === "saphrcloud" ||
      atsName === "saphrcloud.com" ||
      atsName === "saphrcloudcom" ||
      atsName === "jobs.hr.cloud.sap" ||
      atsName === "jobshrcloudsap"
    ) {
      return collectPostingsForSapHrCloudCompany(company);
    }
    if (atsName === "recruiteecom" || atsName === "recruitee.com" || atsName === "recruitee") {
      return collectPostingsForRecruiteeCompany(company);
    }
    if (atsName === "ultipro" || atsName === "ukg") {
      return collectPostingsForUltiProCompany(company);
    }
    if (atsName === "taleo" || atsName === "taleo.net" || atsName === "taleonet") {
      return collectPostingsForTaleoCompany(company);
    }
    return [];
  }

  return {
    collectPostingsForCompany,
    getUsajobsApiConfig,
    inferPostingLocationFromJobUrl,
    parsePostingDateToEpochSeconds,
    shouldStorePostingByDate
  };
}

module.exports = {
  createSourceCollectorRuntime
};
