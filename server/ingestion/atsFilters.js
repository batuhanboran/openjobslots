const { isAtsEnabledByDefault } = require("./adapter-metadata");

const ATS_FILTER_OPTION_ITEMS = Object.freeze([
  { value: "workday", label: "Workday" },
  { value: "ashby", label: "Ashby" },
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "jobvite", label: "Jobvite" },
  { value: "applicantpro", label: "ApplicantPro" },
  { value: "applytojob", label: "ApplyToJob" },
  { value: "theapplicantmanager", label: "The Applicant Manager" },
  { value: "breezy", label: "BreezyHR" },
  { value: "icims", label: "iCIMS" },
  { value: "zoho", label: "Zoho Recruit" },
  { value: "applicantai", label: "ApplicantAI" },
  { value: "gem", label: "Gem" },
  { value: "jobaps", label: "JobAps" },
  { value: "join", label: "JOIN" },
  { value: "talentreef", label: "TalentReef" },
  { value: "careerplug", label: "CareerPlug" },
  { value: "bamboohr", label: "BambooHR" },
  { value: "adp_myjobs", label: "ADP MyJobs" },
  { value: "adp_workforcenow", label: "ADP Workforce Now" },
  { value: "oracle", label: "Oracle" },
  { value: "paylocity", label: "Paylocity" },
  { value: "eightfold", label: "Eightfold" },
  { value: "manatal", label: "Manatal" },
  { value: "careerspage", label: "CareersPage" },
  { value: "dayforcehcm", label: "Dayforce", enabledByDefault: false },
  { value: "pageup", label: "PageUp" },
  { value: "hirebridge", label: "Hirebridge" },
  { value: "brassring", label: "BrassRing" },
  { value: "applitrack", label: "Applitrack" },
  { value: "hibob", label: "HiBob" },
  { value: "isolvisolvedhire", label: "isolvedhire" },
  { value: "teamtailor", label: "Teamtailor" },
  { value: "freshteam", label: "Freshteam" },
  { value: "sagehr", label: "SageHR" },
  { value: "loxo", label: "Loxo" },
  { value: "peopleforce", label: "PeopleForce" },
  { value: "simplicant", label: "Simplicant" },
  { value: "pinpointhq", label: "PinpointHQ" },
  { value: "recruitcrm", label: "RecruitCRM" },
  { value: "rippling", label: "Rippling" },
  { value: "careerpuck", label: "CareerPuck" },
  { value: "fountain", label: "Fountain" },
  { value: "getro", label: "Getro" },
  { value: "personio", label: "Personio", enabledByDefault: false },
  { value: "workable", label: "Workable", enabledByDefault: false },
  { value: "governmentjobs", label: "GovernmentJobs" },
  { value: "smartrecruiters", label: "SmartRecruiters" },
  { value: "policeapp", label: "PoliceApp" },
  { value: "usajobs", label: "USAJobs" },
  { value: "k12jobspot", label: "K12JobSpot" },
  { value: "schoolspring", label: "SchoolSpring" },
  { value: "calcareers", label: "CalCareers" },
  { value: "calopps", label: "CalOpps" },
  { value: "statejobsny", label: "StateJobsNY" },
  { value: "hrmdirect", label: "HRMDirect" },
  { value: "talentlyft", label: "Talentlyft" },
  { value: "talexio", label: "Talexio" },
  { value: "saphrcloud", label: "SAP HR Cloud" },
  { value: "recruitee", label: "Recruitee" },
  { value: "ultipro", label: "UltiPro" },
  { value: "taleo", label: "Taleo" }
]);
const ATS_FILTER_OPTIONS = new Set(ATS_FILTER_OPTION_ITEMS.map((item) => item.value));
const ATS_FILTER_LABEL_BY_VALUE = new Map(ATS_FILTER_OPTION_ITEMS.map((item) => [item.value, item.label]));
const SYNC_DEFAULT_ENABLED_ATS = Object.freeze(
  ATS_FILTER_OPTION_ITEMS
    .filter((item) => item.enabledByDefault !== false && isAtsEnabledByDefault(item.value))
    .map((item) => item.value)
);

const ATS_FILTER_ALIASES = new Map([
  ["ashbyhq", "ashby"],
  ["greenhouseio", "greenhouse"],
  ["greenhouse.io", "greenhouse"],
  ["leverco", "lever"],
  ["lever.co", "lever"],
  ["recruiteecom", "recruitee"],
  ["recruitee.com", "recruitee"],
  ["ukg", "ultipro"],
  ["taleonet", "taleo"],
  ["taleo.net", "taleo"],
  ["jobvitecom", "jobvite"],
  ["jobvite.com", "jobvite"],
  ["applicantprocom", "applicantpro"],
  ["applicantpro.com", "applicantpro"],
  ["hibob.com", "hibob"],
  ["hibobcom", "hibob"],
  ["hibob", "hibob"],
  ["careers.hibob.com", "hibob"],
  ["careershibobcom", "hibob"],
  ["isolvisolvedhire", "isolvisolvedhire"],
  ["isolvedhire", "isolvisolvedhire"],
  ["isolvedhire.com", "isolvisolvedhire"],
  ["isolvedhirecom", "isolvisolvedhire"],
  ["applytojobcom", "applytojob"],
  ["applytojob.com", "applytojob"],
  ["icimscom", "icims"],
  ["icims.com", "icims"],
  ["theapplicantmanagercom", "theapplicantmanager"],
  ["theapplicantmanager.com", "theapplicantmanager"],
  ["breezyhr", "breezy"],
  ["breezy.hr", "breezy"],
  ["breezyhrcom", "breezy"],
  ["zohorecruit", "zoho"],
  ["zohorecruit.com", "zoho"],
  ["zohorecruitcom", "zoho"],
  ["applicantai.com", "applicantai"],
  ["applicantaicom", "applicantai"],
  ["bamboohr.com", "bamboohr"],
  ["bamboohrcom", "bamboohr"],
  ["careerplug.com", "careerplug"],
  ["careerplugcom", "careerplug"],
  ["manatal.com", "manatal"],
  ["manatalcom", "manatal"],
  ["careers-page.com", "manatal"],
  ["careerspagecom", "manatal"],
  ["careerpuck.com", "careerpuck"],
  ["careerpuckcom", "careerpuck"],
  ["dayforcehcm", "dayforcehcm"],
  ["dayforce", "dayforcehcm"],
  ["dayforcehcm.com", "dayforcehcm"],
  ["dayforcehcmcom", "dayforcehcm"],
  ["fountain.com", "fountain"],
  ["fountaincom", "fountain"],
  ["getro.com", "getro"],
  ["getrocom", "getro"],
  ["governmentjobs.com", "governmentjobs"],
  ["governmentjobscom", "governmentjobs"],
  ["governmentjobs", "governmentjobs"],
  ["smartrecruiters.com", "smartrecruiters"],
  ["smartrecruiterscom", "smartrecruiters"],
  ["jobs.smartrecruiters.com", "smartrecruiters"],
  ["jobssmartrecruiterscom", "smartrecruiters"],
  ["smartrecruiters", "smartrecruiters"],
  ["policeapp", "policeapp"],
  ["policeapp.com", "policeapp"],
  ["policeappcom", "policeapp"],
  ["www.policeapp.com", "policeapp"],
  ["wwwpoliceappcom", "policeapp"],
  ["usajobs", "usajobs"],
  ["usajobs.gov", "usajobs"],
  ["usajobsgov", "usajobs"],
  ["www.usajobs.gov", "usajobs"],
  ["wwwusajobsgov", "usajobs"],
  ["k12jobspot", "k12jobspot"],
  ["k12jobspot.com", "k12jobspot"],
  ["k12jobspotcom", "k12jobspot"],
  ["www.k12jobspot.com", "k12jobspot"],
  ["wwwk12jobspotcom", "k12jobspot"],
  ["api.k12jobspot.com", "k12jobspot"],
  ["apik12jobspotcom", "k12jobspot"],
  ["schoolspring", "schoolspring"],
  ["schoolspring.com", "schoolspring"],
  ["schoolspringcom", "schoolspring"],
  ["api.schoolspring.com", "schoolspring"],
  ["apischoolspringcom", "schoolspring"],
  ["www.schoolspring.com", "schoolspring"],
  ["wwwschoolspringcom", "schoolspring"],
  ["calcareers", "calcareers"],
  ["calcareers.ca.gov", "calcareers"],
  ["calcareerscagov", "calcareers"],
  ["www.calcareers.ca.gov", "calcareers"],
  ["wwwcalcareerscagov", "calcareers"],
  ["calopps", "calopps"],
  ["calopps.org", "calopps"],
  ["caloppsorg", "calopps"],
  ["www.calopps.org", "calopps"],
  ["wwwcaloppsorg", "calopps"],
  ["statejobsny", "statejobsny"],
  ["statejobsny.com", "statejobsny"],
  ["statejobsnycom", "statejobsny"],
  ["www.statejobsny.com", "statejobsny"],
  ["wwwstatejobsnycom", "statejobsny"],
  ["hrmdirect.com", "hrmdirect"],
  ["hrmdirectcom", "hrmdirect"],
  ["talentlyft.com", "talentlyft"],
  ["talentlyftcom", "talentlyft"],
  ["talexio.com", "talexio"],
  ["talexiocom", "talexio"],
  ["teamtailor.com", "teamtailor"],
  ["teamtailorcom", "teamtailor"],
  ["freshteam.com", "freshteam"],
  ["freshteamcom", "freshteam"],
  ["sagehr", "sagehr"],
  ["sage.hr", "sagehr"],
  ["talent.sage.hr", "sagehr"],
  ["talentsagehr", "sagehr"],
  ["loxo.co", "loxo"],
  ["loxoco", "loxo"],
  ["app.loxo.co", "loxo"],
  ["apploxoco", "loxo"],
  ["peopleforce.io", "peopleforce"],
  ["peopleforceio", "peopleforce"],
  ["simplicant.com", "simplicant"],
  ["simplicantcom", "simplicant"],
  ["pinpointhq.com", "pinpointhq"],
  ["pinpointhqcom", "pinpointhq"],
  ["recruitcrm.io", "recruitcrm"],
  ["recruitcrmiocom", "recruitcrm"],
  ["recruitcrmio", "recruitcrm"],
  ["rippling.com", "rippling"],
  ["ripplingcom", "rippling"],
  ["ats.rippling.com", "rippling"],
  ["atsripplingcom", "rippling"],
  ["rippling", "rippling"],
  ["jobs.gem.com", "gem"],
  ["gem.com", "gem"],
  ["gemcom", "gem"],
  ["jobapscloud.com", "jobaps"],
  ["jobapscloudcom", "jobaps"],
  ["join.com", "join"],
  ["joincom", "join"],
  ["jobappnetwork.com", "talentreef"],
  ["jobappnetworkcom", "talentreef"],
  ["apply.jobappnetwork.com", "talentreef"],
  ["applyjobappnetworkcom", "talentreef"],
  ["saphrcloud", "saphrcloud"],
  ["saphrcloud.com", "saphrcloud"],
  ["saphrcloudcom", "saphrcloud"],
  ["jobs.hr.cloud.sap", "saphrcloud"],
  ["jobshrcloudsap", "saphrcloud"],
  ["adp_myjobs", "adp_myjobs"],
  ["adpmyjobs", "adp_myjobs"],
  ["adp_workforcenow", "adp_workforcenow"],
  ["adpworkforcenow", "adp_workforcenow"],
  ["workforcenow.adp.com", "adp_workforcenow"],
  ["workforcenowadpcom", "adp_workforcenow"],
  ["careerspage", "careerspage"],
  ["careerspage.io", "careerspage"],
  ["careerspageio", "careerspage"],
  ["paylocity", "paylocity"],
  ["paylocity.com", "paylocity"],
  ["paylocitycom", "paylocity"],
  ["recruiting.paylocity.com", "paylocity"],
  ["recruitingpaylocitycom", "paylocity"],
  ["personio", "personio"],
  ["personio.de", "personio"],
  ["personiode", "personio"],
  ["jobs.personio.de", "personio"],
  ["jobspersoniode", "personio"],
  ["workable", "workable"],
  ["workable.com", "workable"],
  ["workablecom", "workable"],
  ["apply.workable.com", "workable"],
  ["applyworkablecom", "workable"],
  ["eightfold", "eightfold"],
  ["eightfold.ai", "eightfold"],
  ["eightfoldai", "eightfold"],
  ["pageup", "pageup"],
  ["pageuppeople", "pageup"],
  ["pageuppeople.com", "pageup"],
  ["pageuppeoplecom", "pageup"],
  ["careers.pageuppeople.com", "pageup"],
  ["careerspageuppeoplecom", "pageup"],
  ["oracle", "oracle"],
  ["oraclecloud", "oracle"],
  ["oraclecloud.com", "oracle"],
  ["oraclecloudcom", "oracle"],
  ["hirebridge", "hirebridge"],
  ["hirebridge.com", "hirebridge"],
  ["hirebridgecom", "hirebridge"],
  ["recruit.hirebridge.com", "hirebridge"],
  ["recruithirebridgecom", "hirebridge"],
  ["brassring", "brassring"],
  ["brassring.com", "brassring"],
  ["brassringcom", "brassring"],
  ["sjobs.brassring.com", "brassring"],
  ["sjobsbrassringcom", "brassring"],
  ["applitrack.com", "applitrack"],
  ["applitrackcom", "applitrack"],
  ["applitrack", "applitrack"]
]);

function normalizeLikeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseStringArrayInput(value) {
  if (Array.isArray(value)) return normalizeStringArray(value);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return normalizeStringArray(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function normalizeAtsFilterValue(value) {
  const normalized = normalizeLikeText(value);
  return ATS_FILTER_ALIASES.get(normalized) || normalized;
}

function getAtsFilterAliasValues(value) {
  const canonical = normalizeAtsFilterValue(value);
  if (!canonical) return [];
  const aliases = new Set([canonical]);
  for (const [alias, target] of ATS_FILTER_ALIASES.entries()) {
    if (target === canonical) aliases.add(alias);
  }
  return Array.from(aliases);
}

function quotePostgresLiteral(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function buildPostgresAtsFilterCanonicalExpression(columnSql) {
  const column = String(columnSql || "").trim();
  if (!column) throw new Error("columnSql is required");
  const normalizedColumn = `LOWER(BTRIM(${column}))`;
  const cases = [];
  for (const [alias, target] of ATS_FILTER_ALIASES.entries()) {
    if (!alias || !target || alias === target) continue;
    cases.push(`WHEN ${quotePostgresLiteral(alias)} THEN ${quotePostgresLiteral(target)}`);
  }
  return `(CASE ${normalizedColumn} ${cases.join(" ")} ELSE ${normalizedColumn} END)`;
}

function normalizeAtsFilters(value) {
  const items = normalizeStringArray(Array.isArray(value) ? value : [value])
    .map((item) => normalizeAtsFilterValue(item))
    .filter((item) => ATS_FILTER_OPTIONS.has(item));
  return Array.from(new Set(items));
}

function normalizeSyncEnabledAts(value, fallbackValue = SYNC_DEFAULT_ENABLED_ATS) {
  const activeOnly = (items) => items.filter((item) => isAtsEnabledByDefault(item));
  const fallback = activeOnly(normalizeAtsFilters(Array.isArray(fallbackValue) ? fallbackValue : SYNC_DEFAULT_ENABLED_ATS));
  const requested = normalizeAtsFilters(Array.isArray(value) ? value : parseStringArrayInput(value));
  const normalized = activeOnly(requested);
  if (normalized.length > 0) return normalized;
  if (requested.length > 0) return [];
  if (fallback.length > 0) return fallback;
  return Array.from(SYNC_DEFAULT_ENABLED_ATS);
}

module.exports = {
  ATS_FILTER_LABEL_BY_VALUE,
  ATS_FILTER_OPTION_ITEMS,
  ATS_FILTER_OPTIONS,
  SYNC_DEFAULT_ENABLED_ATS,
  buildPostgresAtsFilterCanonicalExpression,
  getAtsFilterAliasValues,
  normalizeAtsFilterValue,
  normalizeAtsFilters,
  normalizeSyncEnabledAts
};
