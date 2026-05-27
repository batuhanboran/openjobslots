const { getSourceModule } = require("./sources");
const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  createUnsupportedSourceModule
} = require("./sourceContracts");

const PILOT_SOURCE_METADATA = Object.freeze({
  adp_myjobs: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled
  }),
  adp_workforcenow: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  applicantpro: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  applicantai: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  applitrack: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.quarantine
  }),
  applytojob: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  ashby: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  bamboohr: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  brassring: Object.freeze({
    family: SOURCE_FAMILIES.brittleHighRisk,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  breezy: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  calcareers: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  calopps: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  careerplug: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  dayforcehcm: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  careerpuck: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  careerspage: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  eightfold: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  gem: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  fountain: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  freshteam: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  getro: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.disabled
  }),
  governmentjobs: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  greenhouse: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  hibob: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  hirebridge: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  hrmdirect: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  icims: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  isolvisolvedhire: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  jobvite: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  k12jobspot: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  jobaps: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.disabled
  }),
  join: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  lever: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  loxo: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  manatal: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  oracle: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  peopleforce: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  pinpointhq: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.disabled
  }),
  policeapp: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.disabled
  }),
  recruitcrm: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.quarantine
  }),
  smartrecruiters: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  statejobsny: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  schoolspring: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  simplicant: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  recruitee: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.quarantine
  }),
  rippling: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  sagehr: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  saphrcloud: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled
  }),
  taleo: Object.freeze({
    family: SOURCE_FAMILIES.brittleHighRisk,
    status: SOURCE_STATUSES.disabled
  }),
  talentreef: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  theapplicantmanager: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  talentlyft: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  talexio: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  teamtailor: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  ultipro: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled
  }),
  paylocity: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  pageup: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  usajobs: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  workday: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled
  }),
  zoho: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.canary
  })
});

const REGISTRY_SOURCE_ALIASES = Object.freeze({
  adpmyjobs: "adp_myjobs",
  adpworkforcenow: "adp_workforcenow",
  "applicantai.com": "applicantai",
  applicantaicom: "applicantai",
  "applicantpro.com": "applicantpro",
  applicantprocom: "applicantpro",
  "applitrack.com": "applitrack",
  applitrackcom: "applitrack",
  "applytojob.com": "applytojob",
  applytojobcom: "applytojob",
  ashbyhq: "ashby",
  "ats.rippling.com": "rippling",
  atsripplingcom: "rippling",
  "bamboohr.com": "bamboohr",
  bamboohrcom: "bamboohr",
  "brassring.com": "brassring",
  brassringcom: "brassring",
  "breezy.hr": "breezy",
  breezyhr: "breezy",
  breezyhrcom: "breezy",
  "calcareers.ca.gov": "calcareers",
  calcareerscagov: "calcareers",
  "calopps.org": "calopps",
  caloppsorg: "calopps",
  "careerpuck.com": "careerpuck",
  careerpuckcom: "careerpuck",
  "careerplug.com": "careerplug",
  careerplugcom: "careerplug",
  "careers-page.com": "manatal",
  careerspagecom: "manatal",
  "careers.hibob.com": "hibob",
  careershibobcom: "hibob",
  "careers.pageuppeople.com": "pageup",
  careerspageuppeoplecom: "pageup",
  "careerspage.io": "careerspage",
  careerspageio: "careerspage",
  "dayforcehcm.com": "dayforcehcm",
  dayforce: "dayforcehcm",
  dayforcehcmcom: "dayforcehcm",
  "eightfold.ai": "eightfold",
  eightfoldai: "eightfold",
  "fountain.com": "fountain",
  fountaincom: "fountain",
  "freshteam.com": "freshteam",
  freshteamcom: "freshteam",
  "gem.com": "gem",
  gemcom: "gem",
  "getro.com": "getro",
  getrocom: "getro",
  greenhouseio: "greenhouse",
  "greenhouse.io": "greenhouse",
  "governmentjobs.com": "governmentjobs",
  governmentjobscom: "governmentjobs",
  "hibob.com": "hibob",
  hibobcom: "hibob",
  "hirebridge.com": "hirebridge",
  hirebridgecom: "hirebridge",
  "hrmdirect.com": "hrmdirect",
  hrmdirectcom: "hrmdirect",
  "icims.com": "icims",
  icimscom: "icims",
  isolvedhire: "isolvisolvedhire",
  "isolvedhire.com": "isolvisolvedhire",
  isolvedhirecom: "isolvisolvedhire",
  "jobapscloud.com": "jobaps",
  jobapscloudcom: "jobaps",
  "jobvite.com": "jobvite",
  jobvitecom: "jobvite",
  "jobs.gem.com": "gem",
  "jobs.smartrecruiters.com": "smartrecruiters",
  jobssmartrecruiterscom: "smartrecruiters",
  "join.com": "join",
  joincom: "join",
  "k12jobspot.com": "k12jobspot",
  k12jobspotcom: "k12jobspot",
  "lever.co": "lever",
  leverco: "lever",
  "loxo.co": "loxo",
  loxoco: "loxo",
  "manatal.com": "manatal",
  manatalcom: "manatal",
  oraclecloud: "oracle",
  "oraclecloud.com": "oracle",
  oraclecloudcom: "oracle",
  "pageuppeople.com": "pageup",
  pageuppeople: "pageup",
  pageuppeoplecom: "pageup",
  "paylocity.com": "paylocity",
  paylocitycom: "paylocity",
  "peopleforce.io": "peopleforce",
  peopleforceio: "peopleforce",
  "pinpointhq.com": "pinpointhq",
  pinpointhqcom: "pinpointhq",
  "policeapp.com": "policeapp",
  policeappcom: "policeapp",
  "recruit.hirebridge.com": "hirebridge",
  recruithirebridgecom: "hirebridge",
  "recruitcrm.io": "recruitcrm",
  recruitcrmio: "recruitcrm",
  recruitcrmiocom: "recruitcrm",
  recruiteecom: "recruitee",
  "recruitee.com": "recruitee",
  "recruiting.paylocity.com": "paylocity",
  recruitingpaylocitycom: "paylocity",
  "rippling.com": "rippling",
  ripplingcom: "rippling",
  "sage.hr": "sagehr",
  sagehr: "sagehr",
  "saphrcloud.com": "saphrcloud",
  saphrcloudcom: "saphrcloud",
  "schoolspring.com": "schoolspring",
  schoolspringcom: "schoolspring",
  "simplicant.com": "simplicant",
  simplicantcom: "simplicant",
  "sjobs.brassring.com": "brassring",
  sjobsbrassringcom: "brassring",
  "smartrecruiters.com": "smartrecruiters",
  smartrecruiterscom: "smartrecruiters",
  "statejobsny.com": "statejobsny",
  statejobsnycom: "statejobsny",
  "taleo.net": "taleo",
  taleonet: "taleo",
  "talentlyft.com": "talentlyft",
  talentlyftcom: "talentlyft",
  "talexio.com": "talexio",
  talexiocom: "talexio",
  "teamtailor.com": "teamtailor",
  teamtailorcom: "teamtailor",
  "theapplicantmanager.com": "theapplicantmanager",
  theapplicantmanagercom: "theapplicantmanager",
  ukg: "ultipro",
  "usajobs.gov": "usajobs",
  usajobsgov: "usajobs",
  "workforcenow.adp.com": "adp_workforcenow",
  workforcenowadpcom: "adp_workforcenow",
  "www.calcareers.ca.gov": "calcareers",
  wwwcalcareerscagov: "calcareers",
  "www.calopps.org": "calopps",
  wwwcaloppsorg: "calopps",
  "www.k12jobspot.com": "k12jobspot",
  wwwk12jobspotcom: "k12jobspot",
  "www.policeapp.com": "policeapp",
  wwwpoliceappcom: "policeapp",
  "api.k12jobspot.com": "k12jobspot",
  apik12jobspotcom: "k12jobspot",
  "api.schoolspring.com": "schoolspring",
  apischoolspringcom: "schoolspring",
  "www.schoolspring.com": "schoolspring",
  wwwschoolspringcom: "schoolspring",
  "www.statejobsny.com": "statejobsny",
  wwwstatejobsnycom: "statejobsny",
  "www.usajobs.gov": "usajobs",
  wwwusajobsgov: "usajobs",
  "jobs.hr.cloud.sap": "saphrcloud",
  jobshrcloudsap: "saphrcloud",
  "talent.sage.hr": "sagehr",
  talentsagehr: "sagehr",
  "zohorecruit.com": "zoho",
  zohorecruit: "zoho",
  zohorecruitcom: "zoho",
  "apply.jobappnetwork.com": "talentreef",
  applyjobappnetworkcom: "talentreef",
  "jobappnetwork.com": "talentreef",
  jobappnetworkcom: "talentreef"
});

function normalizeSourceKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isRegistryPilotSource(atsKey) {
  return Object.hasOwn(PILOT_SOURCE_METADATA, normalizeSourceKey(atsKey));
}

function resolveRegistrySourceKey(value) {
  const normalized = normalizeSourceKey(value);
  if (!normalized) return "";
  if (isRegistryPilotSource(normalized)) return normalized;
  return REGISTRY_SOURCE_ALIASES[normalized] || "";
}

function withContractMetadata(atsKey, sourceModule) {
  const key = normalizeSourceKey(atsKey);
  const metadata = PILOT_SOURCE_METADATA[key];
  if (!metadata || !sourceModule) {
    return createUnsupportedSourceModule(key || "unknown", {
      reason: "source is not registry-backed"
    });
  }

  return {
    ...sourceModule,
    atsKey: key,
    family: metadata.family,
    status: metadata.status,
    collectWhenDisabled: metadata.collectWhenDisabled !== false
  };
}

function getRegistrySourceModule(atsKey) {
  const key = normalizeSourceKey(atsKey);
  if (!isRegistryPilotSource(key)) {
    return createUnsupportedSourceModule(key || "unknown", {
      reason: "source is not registry-backed"
    });
  }
  return withContractMetadata(key, getSourceModule(key));
}

function listRegistrySourceModules() {
  return Object.keys(PILOT_SOURCE_METADATA).map((key) => getRegistrySourceModule(key));
}

module.exports = {
  getRegistrySourceModule,
  isRegistryPilotSource,
  listRegistrySourceModules,
  resolveRegistrySourceKey
};
