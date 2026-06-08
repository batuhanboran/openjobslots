const { getSourceModule } = require("./sources");
const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  createUnsupportedSourceModule
} = require("./sourceContracts");

const PILOT_SOURCE_METADATA = Object.freeze({
  "adp_myjobs": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "adp_workforcenow": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "applicantpro": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "applicantai": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "applitrack": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "applytojob": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "ashby": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "bamboohr": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "brassring": Object.freeze({
    family: SOURCE_FAMILIES.brittleHighRisk,
    status: SOURCE_STATUSES.enabled
  }),
  "breezy": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "calcareers": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "calopps": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "careerplug": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "dayforcehcm": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "careerpuck": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "careerspage": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "eightfold": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "gem": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "fountain": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "freshteam": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "getro": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "governmentjobs": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "greenhouse": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "hibob": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "hirebridge": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "hrmdirect": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "icims": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "isolvisolvedhire": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "jobvite": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "k12jobspot": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "jobaps": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "join": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "lever": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "loxo": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "manatal": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "oracle": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "personio": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "peopleforce": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "pinpointhq": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "policeapp": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "recruitcrm": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "smartrecruiters": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "statejobsny": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "schoolspring": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "simplicant": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "recruitee": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "rippling": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "sagehr": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "saphrcloud": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "taleo": Object.freeze({
    family: SOURCE_FAMILIES.brittleHighRisk,
    status: SOURCE_STATUSES.enabled
  }),
  "talentreef": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "theapplicantmanager": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "talentlyft": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "talexio": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "teamtailor": Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  "ultipro": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "paylocity": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "pageup": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "usajobs": Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  "workday": Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  "workable": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "zoho": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "100hires": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "jobylon": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "jobsoid": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "hirehive": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "phenom": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "gohire": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "paradox": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "sympa": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "flatchr": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "talentnest": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "hiringthing": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "oleeo": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "jobadder": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "brightmove": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "jobdiva": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "tribepad": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "akkencloud": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "aviont": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "exelare": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "dvinci": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "onlyfy": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "vultus": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "naukrirms": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "ismartrecruit": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "logicmelon": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "broadbean": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "idibu": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "seekout": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "fetcher": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "hired": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "targetrecruit": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "jobscience": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "cornerstoneondemand": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "sabasoftware": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "sumtotalsystems": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "prescreen": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "hirex": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "turbohire": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "cegid": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "apli": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "smartsearch": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "erecruit": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "easyrecrue": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "talentwunder": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "cvat": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "engagesoftware": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "hireserve": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "hiretrace": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "skeeled": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "talentadore": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "jazzhr": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "clearcompany": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "firefish": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "recruitive": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "talentera": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "atsondemand": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "tracker": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "invenias": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "beamery": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "humi": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "collagehr": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "risepeople": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "eploy": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "networx": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "recooty": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "jobilla": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "tempworks": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "coats": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "lumesse": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "meta4": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "talentsoft": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "haufe": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "coview": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "kenjo": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "kiwihr": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "hrworks": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "beetween": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "jobaffinity": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "sentrient": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "talentum": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "wocoats": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "pitchnhire": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "hrmantra": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "neogov": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "cleverconnect": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "talentlink": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "hiringopps": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "vireup": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "webrecruit": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "vacancyfiller": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "gorecruit": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "rapidrecruit": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "symphonytalent": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "inrecruit": Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  "staffsuite": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "pcrecruiter": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "ceipal": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "applicantstack": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "beetween_new": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  "kenjo_new": Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
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
  "jobs.personio.de": "personio",
  "personio.de": "personio",
  personio: "personio",
  personiode: "personio",
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
  workable: "workable",
  "workable.com": "workable",
  workablecom: "workable",
  "apply.workable.com": "workable",
  applyworkablecom: "workable",
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

  const status = sourceModule.status === SOURCE_STATUSES.unsupported
    ? SOURCE_STATUSES.unsupported
    : metadata.status;

  return {
    ...sourceModule,
    atsKey: key,
    family: metadata.family,
    status,
    collectWhenDisabled: status === SOURCE_STATUSES.unsupported
      ? false
      : metadata.collectWhenDisabled !== false
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
