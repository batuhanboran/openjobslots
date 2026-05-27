const {
  inferWorkdayLocationFromJobUrl
} = require("./sources/workday/parse");
const {
  getRegistrySourceModule,
  resolveRegistrySourceKey
} = require("./sourceRegistry");
const { SOURCE_STATUSES, validateSourceContract } = require("./sourceContracts");

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
const BREEZY_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ZOHO_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CAREERPLUG_RATE_LIMIT_WAIT_MS = 60 * 1000;
const BAMBOOHR_RATE_LIMIT_WAIT_MS = 60 * 1000;
const FOUNTAIN_RATE_LIMIT_WAIT_MS = 60 * 1000;
const HRMDIRECT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const TEAMTAILOR_RATE_LIMIT_WAIT_MS = 60 * 1000;
const FRESHTEAM_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SIMPLICANT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const PINPOINTHQ_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RECRUITCRM_RATE_LIMIT_WAIT_MS = 60 * 1000;
const RIPPLING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const MANATAL_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOBAPS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const JOIN_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ADP_MYJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CAREERSPAGE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const APPLITRACK_RATE_LIMIT_WAIT_MS = 60 * 1000;
const K12JOBSPOT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const SCHOOLSPRING_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CALCAREERS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const CALOPPS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const ISOLVISOLVEDHIRE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const REGISTRY_PILOT_RATE_LIMIT_WAIT_MS = Object.freeze({
  adp_myjobs: ADP_MYJOBS_RATE_LIMIT_WAIT_MS,
  adp_workforcenow: 60 * 1000,
  applicantai: 60 * 1000,
  applicantpro: APPLICANTPRO_RATE_LIMIT_WAIT_MS,
  applitrack: APPLITRACK_RATE_LIMIT_WAIT_MS,
  applytojob: APPLYTOJOB_RATE_LIMIT_WAIT_MS,
  ashby: ASHBY_RATE_LIMIT_WAIT_MS,
  bamboohr: BAMBOOHR_RATE_LIMIT_WAIT_MS,
  breezy: BREEZY_RATE_LIMIT_WAIT_MS,
  calcareers: CALCAREERS_RATE_LIMIT_WAIT_MS,
  calopps: CALOPPS_RATE_LIMIT_WAIT_MS,
  careerplug: CAREERPLUG_RATE_LIMIT_WAIT_MS,
  careerspage: CAREERSPAGE_RATE_LIMIT_WAIT_MS,
  eightfold: 60 * 1000,
  fountain: FOUNTAIN_RATE_LIMIT_WAIT_MS,
  freshteam: FRESHTEAM_RATE_LIMIT_WAIT_MS,
  greenhouse: 60 * 1000,
  governmentjobs: GOVERNMENTJOBS_RATE_LIMIT_WAIT_MS,
  hibob: 60 * 1000,
  hrmdirect: HRMDIRECT_RATE_LIMIT_WAIT_MS,
  icims: 60 * 1000,
  isolvisolvedhire: ISOLVISOLVEDHIRE_RATE_LIMIT_WAIT_MS,
  jobaps: JOBAPS_RATE_LIMIT_WAIT_MS,
  jobvite: JOBVITE_RATE_LIMIT_WAIT_MS,
  join: JOIN_RATE_LIMIT_WAIT_MS,
  k12jobspot: K12JOBSPOT_RATE_LIMIT_WAIT_MS,
  lever: LEVER_RATE_LIMIT_WAIT_MS,
  loxo: 5 * 1000,
  simplicant: SIMPLICANT_RATE_LIMIT_WAIT_MS,
  smartrecruiters: 1000,
  manatal: MANATAL_RATE_LIMIT_WAIT_MS,
  oracle: 60 * 1000,
  peopleforce: 60 * 1000,
  pinpointhq: PINPOINTHQ_RATE_LIMIT_WAIT_MS,
  policeapp: 60 * 1000,
  recruitcrm: RECRUITCRM_RATE_LIMIT_WAIT_MS,
  recruitee: RECRUITEE_RATE_LIMIT_WAIT_MS,
  rippling: RIPPLING_RATE_LIMIT_WAIT_MS,
  sagehr: 60 * 1000,
  saphrcloud: 60 * 1000,
  schoolspring: SCHOOLSPRING_RATE_LIMIT_WAIT_MS,
  statejobsny: 60 * 1000,
  taleo: TALEO_RATE_LIMIT_WAIT_MS,
  talexio: 60 * 1000,
  talentreef: 60 * 1000,
  theapplicantmanager: 60 * 1000,
  teamtailor: TEAMTAILOR_RATE_LIMIT_WAIT_MS,
  ultipro: ULTIPRO_RATE_LIMIT_WAIT_MS,
  usajobs: 60 * 1000,
  workday: WORKDAY_RATE_LIMIT_WAIT_MS,
  zoho: ZOHO_RATE_LIMIT_WAIT_MS
});
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
  const resolveRegistrySourceKeyForRuntime = typeof dependencies.resolveRegistrySourceKey === "function"
    ? dependencies.resolveRegistrySourceKey
    : resolveRegistrySourceKey;

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

    const allowedStatuses = new Set(
      Array.isArray(target.allowStatuses)
        ? target.allowStatuses.map((status) => Number(status)).filter(Number.isFinite)
        : []
    );
    if (!res.ok && !allowedStatuses.has(Number(res.status || 0))) {
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

  async function collectPostingsForCompany(company) {
    const atsName = String(company?.ATS_name || "").trim().toLowerCase();
    const registryKey = resolveRegistrySourceKeyForRuntime(atsName);
    if (registryKey) {
      return collectPostingsForRegistryPilotCompany(company, registryKey);
    }

    return [];
  }

  return {
    collectPostingsForCompany,
    inferPostingLocationFromJobUrl,
    parsePostingDateToEpochSeconds,
    shouldStorePostingByDate
  };
}

module.exports = {
  createSourceCollectorRuntime
};
