const { safeFetch } = require("./safeFetch");
const {
  parseApplicantAiCompany,
  parseCareerpuckCompany,
  parseGetroCompany,
  parseJobApsCompany,
  parsePeopleforceCompany,
  parseSagehrCompany,
  parseSapHrCloudCompany,
  parseSimplicantCompany,
  parseTalentlyftCompany,
  parseTalexioCompany,
  parseTheApplicantManagerCompany
} = require("./sourceDiscovery");
const {
  parseSapHrCloudPostingsFromApi,
  parseSapHrCloudPostingsFromHtml
} = require("./sources/saphrcloud/parse");
const {
  inferWorkdayLocationFromJobUrl
} = require("./sources/workday/parse");
const {
  extractSagehrCompanyNameFromHtml,
  parseSagehrPostingsFromHtml
} = require("./sources/sagehr/parse");
const { parsePeopleforcePostingsFromHtml } = require("./sources/peopleforce/parse");
const { parseSimplicantPostingsFromHtml } = require("./sources/simplicant/parse");
const { parseCareerpuckPostingsFromApi } = require("./sources/careerpuck/parse");
const { parseTalexioPostingsFromApi } = require("./sources/talexio/parse");
const { parseJobApsPostingsFromHtml } = require("./sources/jobaps/parse");
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
const { SOURCE_STATUSES, validateSourceContract } = require("./sourceContracts");

const MAX_PAGES_PER_COMPANY = 25;
const POSTING_VISIBLE_RETENTION_DAYS = Math.max(1, Number(process.env.OPENJOBSLOTS_POSTING_HOT_DAYS || 30));
const DEFAULT_POSTING_TTL_SECONDS = Number(process.env.POSTING_TTL_SECONDS || POSTING_VISIBLE_RETENTION_DAYS * 24 * 60 * 60);
const DEFAULT_BROWSER_USER_AGENT =
  process.env.OPENJOBSLOTS_BROWSER_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const WORKDAY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ASHBY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const LEVER_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RECRUITEE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ULTIPRO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TALEO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOBVITE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLICANTPRO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLYTOJOB_RATE_LIMIT_WAIT_MS = 60 * 1000;
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
const SIMPLICANT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const PINPOINTHQ_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RECRUITCRM_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RIPPLING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const MANATAL_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOBAPS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOIN_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SAPHRCLOUD_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ADP_MYJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CAREERSPAGE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLITRACK_RATE_LIMIT_WAIT_MS = 60 * 1000;
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
const REGISTRY_PILOT_RATE_LIMIT_WAIT_MS = Object.freeze({
  adp_myjobs: ADP_MYJOBS_RATE_LIMIT_WAIT_MS,
  adp_workforcenow: 60 * 1000,
  applicantpro: APPLICANTPRO_RATE_LIMIT_WAIT_MS,
  applitrack: APPLITRACK_RATE_LIMIT_WAIT_MS,
  applytojob: APPLYTOJOB_RATE_LIMIT_WAIT_MS,
  ashby: ASHBY_RATE_LIMIT_WAIT_MS,
  bamboohr: BAMBOOHR_RATE_LIMIT_WAIT_MS,
  breezy: BREEZY_RATE_LIMIT_WAIT_MS,
  careerplug: CAREERPLUG_RATE_LIMIT_WAIT_MS,
  careerspage: CAREERSPAGE_RATE_LIMIT_WAIT_MS,
  eightfold: 60 * 1000,
  fountain: FOUNTAIN_RATE_LIMIT_WAIT_MS,
  freshteam: FRESHTEAM_RATE_LIMIT_WAIT_MS,
  greenhouse: 60 * 1000,
  hrmdirect: HRMDIRECT_RATE_LIMIT_WAIT_MS,
  icims: 60 * 1000,
  isolvisolvedhire: ISOLVISOLVEDHIRE_RATE_LIMIT_WAIT_MS,
  jobvite: JOBVITE_RATE_LIMIT_WAIT_MS,
  join: JOIN_RATE_LIMIT_WAIT_MS,
  lever: LEVER_RATE_LIMIT_WAIT_MS,
  loxo: 5 * 1000,
  smartrecruiters: 1000,
  manatal: MANATAL_RATE_LIMIT_WAIT_MS,
  oracle: 60 * 1000,
  pinpointhq: PINPOINTHQ_RATE_LIMIT_WAIT_MS,
  recruitcrm: RECRUITCRM_RATE_LIMIT_WAIT_MS,
  recruitee: RECRUITEE_RATE_LIMIT_WAIT_MS,
  rippling: RIPPLING_RATE_LIMIT_WAIT_MS,
  taleo: TALEO_RATE_LIMIT_WAIT_MS,
  talentreef: 60 * 1000,
  teamtailor: TEAMTAILOR_RATE_LIMIT_WAIT_MS,
  ultipro: ULTIPRO_RATE_LIMIT_WAIT_MS,
  workday: WORKDAY_RATE_LIMIT_WAIT_MS,
  zoho: ZOHO_RATE_LIMIT_WAIT_MS
});
const SAPHRCLOUD_LOCALE_CANDIDATES = Object.freeze(["en_US", "en_GB"]);
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
      if (parsed.hostname.endsWith(".oraclecloud.com") && parsed.pathname.toLowerCase().includes("/hcmui/candidateexperience/")) {
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
  
  
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
  
  async function fetchRegistryPilotPayload(atsKey, urlString, target = {}) {
    const headers = String(target.source_family || "").includes("html")
      ? { Accept: "text/html,application/xhtml+xml,application/json;q=0.7,*/*;q=0.5" }
      : { Accept: "application/json,text/html;q=0.8,*/*;q=0.5" };
    if (target.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetchWithAtsRateLimit(
      atsKey,
      REGISTRY_PILOT_RATE_LIMIT_WAIT_MS[atsKey] || 60 * 1000,
      urlString,
      {
        method: target.method || "GET",
        headers: {
          ...headers,
          ...(target.headers || {})
        },
        body: target.body
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
        if (Array.isArray(parsedJson)) {
          Object.defineProperty(parsedJson, "__sourceFetchFinalUrl", {
            value: res.url || urlString,
            enumerable: false,
            configurable: true
          });
        }
        return parsedJson;
      } catch {
        return body;
      }
    }
    return {
      body,
      url: res.url || urlString,
      status: Number(res.status || 200),
      headers: res.headers
    };
  }

  async function collectPostingsForRegistryPilotCompany(company, atsKey) {
    const sourceModule = getRegistrySourceModuleForRuntime(atsKey);
    const contract = validateSourceContract(sourceModule);
    if (!contract.ok) {
      throw new Error(`${atsKey} registry source contract failed: ${contract.failures.join(", ")}`);
    }
    if (
      sourceModule.status === SOURCE_STATUSES.disabled &&
      sourceModule.collectWhenDisabled === false
    ) {
      return [];
    }

    const rawPayload = await sourceModule.fetchList(company, {
      fetcher: (urlString, target) => fetchRegistryPilotPayload(atsKey, urlString, target)
    });
    return sourceModule.parse(rawPayload, company);
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
  
  async function collectPostingsForTheApplicantManagerCompany(company) {
    const config = parseTheApplicantManagerCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.companyCodeLower;
    const pageHtml = await fetchTheApplicantManagerPage(config.careersUrl);
    return parseTheApplicantManagerPostingsFromHtml(companyNameForPostings, config, pageHtml);
  }
  
  async function collectPostingsForApplicantAiCompany(company) {
    const config = parseApplicantAiCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.slugLower;
    const pageHtml = await fetchApplicantAiCareersPage(config.careersUrl);
    return parseApplicantAiPostingsFromHtml(companyNameForPostings, config, pageHtml);
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
  
  async function collectPostingsForCareerpuckCompany(company) {
    const config = parseCareerpuckCompany(company.url_string);
    if (!config) return [];
  
    const normalizedCompanyName = String(company?.company_name || "").trim();
    const companyNameForPostings = normalizedCompanyName || config.boardSlugLower;
    const responseJson = await fetchCareerpuckJobBoard(config);
    return parseCareerpuckPostingsFromApi(companyNameForPostings, responseJson);
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
  
  async function fetchGovernmentJobsViewHtml(url, params) {
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
  
  async function collectPostingsForPoliceappDynamic() {
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
      return collectPostingsForRegistryPilotCompany(company, "workday");
    }
    if (atsName === "ashbyhq" || atsName === "ashby") {
      return collectPostingsForRegistryPilotCompany(company, "ashby");
    }
    if (atsName === "greenhouseio" || atsName === "greenhouse.io" || atsName === "greenhouse") {
      return collectPostingsForRegistryPilotCompany(company, "greenhouse");
    }
    if (atsName === "leverco" || atsName === "lever.co" || atsName === "lever") {
      return collectPostingsForRegistryPilotCompany(company, "lever");
    }
    if (atsName === "jobvite" || atsName === "jobvite.com" || atsName === "jobvitecom") {
      return collectPostingsForRegistryPilotCompany(company, "jobvite");
    }
    if (atsName === "applicantpro" || atsName === "applicantpro.com" || atsName === "applicantprocom") {
      return collectPostingsForRegistryPilotCompany(company, "applicantpro");
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
      return collectPostingsForRegistryPilotCompany(company, "breezy");
    }
    if (atsName === "icims" || atsName === "icims.com" || atsName === "icimscom") {
      return collectPostingsForRegistryPilotCompany(company, "icims");
    }
    if (atsName === "zoho" || atsName === "zohorecruit" || atsName === "zohorecruit.com" || atsName === "zohorecruitcom") {
      return collectPostingsForRegistryPilotCompany(company, "zoho");
    }
    if (atsName === "applicantai" || atsName === "applicantai.com" || atsName === "applicantaicom") {
      return collectPostingsForApplicantAiCompany(company);
    }
    if (atsName === "gem" || atsName === "jobs.gem.com" || atsName === "gem.com" || atsName === "gemcom") {
      return collectPostingsForRegistryPilotCompany(company, "gem");
    }
    if (atsName === "jobaps" || atsName === "jobapscloud.com" || atsName === "jobapscloudcom") {
      return collectPostingsForJobApsCompany(company);
    }
    if (atsName === "join" || atsName === "join.com" || atsName === "joincom") {
      return collectPostingsForRegistryPilotCompany(company, "join");
    }
    if (
      atsName === "talentreef" ||
      atsName === "jobappnetwork.com" ||
      atsName === "jobappnetworkcom" ||
      atsName === "apply.jobappnetwork.com" ||
      atsName === "applyjobappnetworkcom"
    ) {
      return collectPostingsForRegistryPilotCompany(company, "talentreef");
    }
    if (atsName === "careerplug" || atsName === "careerplug.com" || atsName === "careerplugcom") {
      return collectPostingsForRegistryPilotCompany(company, "careerplug");
    }
    if (atsName === "bamboohr" || atsName === "bamboohr.com" || atsName === "bamboohrcom") {
      return collectPostingsForRegistryPilotCompany(company, "bamboohr");
    }
    if (atsName === "adp_myjobs" || atsName === "adpmyjobs") {
      return collectPostingsForRegistryPilotCompany(company, "adp_myjobs");
    }
    if (
      atsName === "adp_workforcenow" ||
      atsName === "adpworkforcenow" ||
      atsName === "workforcenow.adp.com" ||
      atsName === "workforcenowadpcom"
    ) {
      return collectPostingsForRegistryPilotCompany(company, "adp_workforcenow");
    }
    if (
      atsName === "paylocity" ||
      atsName === "paylocity.com" ||
      atsName === "paylocitycom" ||
      atsName === "recruiting.paylocity.com" ||
      atsName === "recruitingpaylocitycom"
    ) {
      return collectPostingsForRegistryPilotCompany(company, "paylocity");
    }
    if (atsName === "eightfold" || atsName === "eightfold.ai" || atsName === "eightfoldai") {
      return collectPostingsForRegistryPilotCompany(company, "eightfold");
    }
    if (
      atsName === "oracle" ||
      atsName === "oraclecloud" ||
      atsName === "oraclecloud.com" ||
      atsName === "oraclecloudcom"
    ) {
      return collectPostingsForRegistryPilotCompany(company, "oracle");
    }
    if (
      atsName === "brassring" ||
      atsName === "brassring.com" ||
      atsName === "brassringcom" ||
      atsName === "sjobs.brassring.com" ||
      atsName === "sjobsbrassringcom"
    ) {
      return collectPostingsForRegistryPilotCompany(company, "brassring");
    }
    if (atsName === "applitrack" || atsName === "applitrack.com" || atsName === "applitrackcom") {
      return collectPostingsForRegistryPilotCompany(company, "applitrack");
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
      return collectPostingsForRegistryPilotCompany(company, "isolvisolvedhire");
    }
    if (
      atsName === "manatal" ||
      atsName === "manatal.com" ||
      atsName === "manatalcom" ||
      atsName === "careers-page.com" ||
      atsName === "careerspagecom"
    ) {
      return collectPostingsForRegistryPilotCompany(company, "manatal");
    }
    if (atsName === "careerspage" || atsName === "careerspage.io" || atsName === "careerspageio") {
      return collectPostingsForRegistryPilotCompany(company, "careerspage");
    }
    if (
      atsName === "pageup" ||
      atsName === "pageuppeople" ||
      atsName === "pageuppeople.com" ||
      atsName === "pageuppeoplecom" ||
      atsName === "careers.pageuppeople.com" ||
      atsName === "careerspageuppeoplecom"
    ) {
      return collectPostingsForRegistryPilotCompany(company, "pageup");
    }
    if (
      atsName === "hirebridge" ||
      atsName === "hirebridge.com" ||
      atsName === "hirebridgecom" ||
      atsName === "recruit.hirebridge.com" ||
      atsName === "recruithirebridgecom"
    ) {
      return collectPostingsForRegistryPilotCompany(company, "hirebridge");
    }
    if (atsName === "teamtailor" || atsName === "teamtailor.com" || atsName === "teamtailorcom") {
      return collectPostingsForRegistryPilotCompany(company, "teamtailor");
    }
    if (atsName === "freshteam" || atsName === "freshteam.com" || atsName === "freshteamcom") {
      return collectPostingsForRegistryPilotCompany(company, "freshteam");
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
      return collectPostingsForRegistryPilotCompany(company, "loxo");
    }
    if (atsName === "peopleforce" || atsName === "peopleforce.io" || atsName === "peopleforceio") {
      return collectPostingsForPeopleforceCompany(company);
    }
    if (atsName === "simplicant" || atsName === "simplicant.com" || atsName === "simplicantcom") {
      return collectPostingsForSimplicantCompany(company);
    }
    if (atsName === "pinpointhq" || atsName === "pinpointhq.com" || atsName === "pinpointhqcom") {
      return collectPostingsForRegistryPilotCompany(company, "pinpointhq");
    }
    if (atsName === "recruitcrm" || atsName === "recruitcrm.io" || atsName === "recruitcrmiocom" || atsName === "recruitcrmio") {
      return collectPostingsForRegistryPilotCompany(company, "recruitcrm");
    }
    if (atsName === "rippling" || atsName === "rippling.com" || atsName === "ripplingcom" || atsName === "ats.rippling.com" || atsName === "atsripplingcom") {
      return collectPostingsForRegistryPilotCompany(company, "rippling");
    }
    if (atsName === "careerpuck" || atsName === "careerpuck.com" || atsName === "careerpuckcom") {
      return collectPostingsForCareerpuckCompany(company);
    }
    if (atsName === "fountain" || atsName === "fountain.com" || atsName === "fountaincom") {
      return collectPostingsForRegistryPilotCompany(company, "fountain");
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
      return collectPostingsForRegistryPilotCompany(company, "smartrecruiters");
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
      return collectPostingsForRegistryPilotCompany(company, "recruitee");
    }
    if (atsName === "ultipro" || atsName === "ukg") {
      return collectPostingsForRegistryPilotCompany(company, "ultipro");
    }
    if (atsName === "taleo" || atsName === "taleo.net" || atsName === "taleonet") {
      return collectPostingsForRegistryPilotCompany(company, "taleo");
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
