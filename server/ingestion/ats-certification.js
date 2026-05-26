const {
  BRITTLE_HIGH_RISK,
  DIRECT_JSON_STABLE,
  EMBEDDED_OR_SEMI_STRUCTURED,
  ENTERPRISE_DIRECT,
  PARSER_FIXTURE_BACKED,
  PUBLIC_SECTOR_EDUCATION,
  UNSUPPORTED_ATS,
  VENDOR_SPECIFIC,
  getAdapterTier,
  getParserFixtureStatus
} = require("./adapter-metadata");

const CERTIFICATION_VERSION = "ats-field-certification-v1.5.21";

const CERTIFICATION_STATUSES = new Set([
  "parser-fixture-backed",
  "normalized-fixture-only",
  "pending-raw-fixture",
  "unsupported"
]);

const FIELD_DECISION_STATUSES = new Set([
  "list-payload",
  "detail-page",
  "url-or-title-inference",
  "source-absent",
  "unsupported",
  "pending-research"
]);

const FIELD_NAMES = ["geo", "date", "remote", "sourceId"];

function decision(status, evidence) {
  return {
    status,
    evidence
  };
}

function baseFieldDecisions(key) {
  if (UNSUPPORTED_ATS.has(key)) {
    return {
      geo: decision("unsupported", "No supported collector exists."),
      date: decision("unsupported", "No supported collector exists."),
      remote: decision("unsupported", "No supported collector exists."),
      sourceId: decision("unsupported", "No supported collector exists.")
    };
  }
  if (DIRECT_JSON_STABLE.includes(key)) {
    return {
      geo: decision("list-payload", "Public JSON/list payload usually exposes location fields; raw fixture must prove variants."),
      date: decision("list-payload", "Use source date fields when present; otherwise document source absence."),
      remote: decision("list-payload", "Use explicit workplace/remote fields first, then conservative title/location text."),
      sourceId: decision("list-payload", "Use raw id/job id when available; fall back to stable canonical URL id.")
    };
  }
  if (ENTERPRISE_DIRECT.includes(key)) {
    return {
      geo: decision("list-payload", "Candidate/search APIs usually expose structured or labeled location fields."),
      date: decision("list-payload", "Use product-specific posted date fields only when source exposes them."),
      remote: decision("pending-research", "Remote/workplace semantics vary by vendor and need raw fixture proof."),
      sourceId: decision("list-payload", "Use requisition, item, vacancy, or URL id.")
    };
  }
  if (EMBEDDED_OR_SEMI_STRUCTURED.includes(key)) {
    return {
      geo: decision("detail-page", "List cards may omit geo; detail fixture decides whether detail fetch is required."),
      date: decision("detail-page", "List cards often omit date; detail fixture decides whether date exists."),
      remote: decision("url-or-title-inference", "Only infer remote/hybrid from explicit card/detail text."),
      sourceId: decision("url-or-title-inference", "Use stable URL id when raw row id is absent.")
    };
  }
  if (VENDOR_SPECIFIC.includes(key)) {
    return {
      geo: decision("pending-research", "Vendor-specific payload shape needs saved fixture proof."),
      date: decision("pending-research", "Use source date only; leave null when source omits it."),
      remote: decision("pending-research", "Use explicit remote/workplace fields or conservative text only."),
      sourceId: decision("pending-research", "Prefer raw id; otherwise stable URL id.")
    };
  }
  if (PUBLIC_SECTOR_EDUCATION.includes(key)) {
    return {
      geo: decision("list-payload", "Preserve agency/school location fields and normalize country/region conservatively."),
      date: decision("pending-research", "Public boards frequently expose close/open dates; do not invent posted dates."),
      remote: decision("pending-research", "Use explicit telework/remote text only."),
      sourceId: decision("url-or-title-inference", "Use vacancy/job control/listing id or stable URL id.")
    };
  }
  if (BRITTLE_HIGH_RISK.includes(key)) {
    return {
      geo: decision("pending-research", "Portal-specific columns must be fixture-certified."),
      date: decision("pending-research", "Reject boolean/placeholders; use only real date columns."),
      remote: decision("pending-research", "Use explicit source text only."),
      sourceId: decision("list-payload", "Use requisition/job id when source exposes it.")
    };
  }
  return {
    geo: decision("pending-research", "Certification record needs source fixture proof."),
    date: decision("pending-research", "Certification record needs source fixture proof."),
    remote: decision("pending-research", "Certification record needs source fixture proof."),
    sourceId: decision("pending-research", "Certification record needs source fixture proof.")
  };
}

const ATS_CERTIFICATION_OVERRIDES = {
  icims: {
    priority: "P0",
    sourcePattern: "iCIMS public wrapper page, iframe/list pages, next-page links, and job detail pages.",
    parserPath: "server/ingestion/sources/icims/parse.js parseIcimsPostingsFromHtml plus detail helpers",
    requiredFixtures: ["wrapper html", "iframe/list html", "next page html", "detail html"],
    fieldDecisions: {
      geo: decision("detail-page", "Saved raw fixtures cover iCIMS CC-state-city and CC-remote list/detail evidence; blank-card tenants still need detail sampling."),
      date: decision("source-absent", "Saved detail fixture proves some public iCIMS detail pages omit posted date; use source date only when a raw fixture exposes it."),
      remote: decision("detail-page", "Saved raw fixtures cover explicit iCIMS Remote Yes/No header handling plus location/title inference."),
      sourceId: decision("url-or-title-inference", "Stable /jobs/{id}/ URL id is already recoverable.")
    }
  },
  applitrack: {
    priority: "P0",
    sourcePattern: "Applitrack Output.asp?all=1 list plus JobPostings detail pages.",
    parserPath: "server/ingestion/sources/applitrack/parse.js parseApplitrackPostings and extractApplitrackDetailFields",
    requiredFixtures: ["Output.asp list html", "detail page with location/date", "detail page with omitted fields"],
    fieldDecisions: {
      geo: decision("detail-page", "Saved raw detail fixture covers Applitrack detail-page location recovery when Output.asp omits it."),
      date: decision("detail-page", "Saved raw detail fixture covers Applitrack detail-page Date Posted recovery when Output.asp omits it."),
      remote: decision("detail-page", "Saved raw detail fixture covers explicit remote/hybrid/on-site text from detail body."),
      sourceId: decision("url-or-title-inference", "applyFor/listing URL id is recoverable.")
    }
  },
  careerplug: {
    sourcePattern: "CareerPlug public jobs HTML at https://{tenant}.careerplug.com/jobs with /jobs/{id} posting links.",
    parserPath: "server/ingestion/sources/careerplug/parse.js parseCareerplugPostingsFromHtml",
    requiredFixtures: ["list/source fixture", "placeholder title fixture", "expected normalized fixture"],
    fieldDecisions: {
      geo: decision("list-payload", "Saved raw fixture covers .job-location parsing and US state-code geo normalization."),
      date: decision("source-absent", "Saved CareerPlug list fixture contains no posting date; leave posted_at null unless a future detail fixture proves source dates."),
      remote: decision("url-or-title-inference", "Use explicit list/detail title or location text such as Remote/Hybrid only; do not invent remote state."),
      sourceId: decision("url-or-title-inference", "Stable source id comes from /jobs/{id} canonical URL.")
    }
  },
  applicantpro: {
    priority: "P2",
    sourcePattern: "ApplicantPro board HTML domain-id discovery plus core jobs JSON.",
    parserPath: "server/ingestion/sources/applicantpro/parse.js parseApplicantProPostingsFromApi",
    requiredFixtures: ["core jobs JSON fixture", "expected normalized fixture", "board domain-id fixture"],
    fieldDecisions: {
      geo: decision("list-payload", "Saved raw API fixture covers jobLocation fallback to city/iso3 country evidence."),
      date: decision("list-payload", "Saved raw API fixture covers startDateRef as the source posting date when exposed."),
      remote: decision("url-or-title-inference", "Remote is only inferred from explicit title/location text in the saved parser fixture."),
      sourceId: decision("list-payload", "Saved raw API fixture covers JSON id as source_job_id.")
    }
  },
  manatal: {
    priority: "P1",
    sourcePattern: "Manatal careers-page runtime config plus public jobs API at /api/v1.0/c/{clientSlug}/jobs/.",
    parserPath: "server/ingestion/sources/manatal/parse.js parseManatalPostingsFromApi and fallback HTML parser",
    requiredFixtures: ["jobs API response fixture", "missing-title fixture", "missing-url fixture"],
    fieldDecisions: {
      geo: decision("list-payload", "Saved raw API fixture covers city/state/country and location_display fields."),
      date: decision("source-absent", "Saved Manatal API fixture contains no posted date fields; leave posting date null unless a future API variant exposes one."),
      remote: decision("list-payload", "Saved raw API fixture covers WFH/remote evidence from title and description text."),
      sourceId: decision("list-payload", "Saved raw API fixture covers hash/id source id and canonical /job/{hash} URL.")
    }
  },
  workday: {
    priority: "P1",
    sourcePattern: "Workday CXS jobPostings API with externalPath/job URL fields.",
    parserPath: "server/ingestion/sources/workday/parse.js parseWorkdayPostingsFromApi and helpers",
    requiredFixtures: ["CXS jobPostings page", "pagination response", "remote/workplace variant"],
    fieldDecisions: {
      geo: decision("list-payload", "CXS fields and job URL often carry location labels."),
      date: decision("list-payload", "Use postedOn/start date text only; parse relative dates from fetch time."),
      remote: decision("list-payload", "Workplace/URL labels can explicitly indicate Work From Home/remote."),
      sourceId: decision("url-or-title-inference", "JR/requisition suffix is recoverable from externalPath/job URL.")
    }
  },
  ashby: {
    priority: "P1",
    sourcePattern: "Ashby public GraphQL job board response.",
    parserPath: "server/ingestion/sources/ashby/parse.js parseAshbyPostingsFromApi",
    requiredFixtures: ["GraphQL response with primary/secondary locations", "remote/hybrid/on-site variants"],
    fieldDecisions: {
      geo: decision("list-payload", "GraphQL locations expose country/location text but can be broad regional lists."),
      date: decision("source-absent", "Current public query does not expose posting date; keep null unless query changes."),
      remote: decision("list-payload", "Use workplace/location fields where explicit."),
      sourceId: decision("list-payload", "Ashby id/UUID is available.")
    }
  },
  greenhouse: {
    priority: "P1",
    sourcePattern: "Greenhouse Job Board API jobs[] response.",
    parserPath: "server/ingestion/sources/greenhouse/parse.js parseGreenhousePostingsFromApi",
    requiredFixtures: ["jobs[] response with nested location and department"],
    fieldDecisions: {
      geo: decision("list-payload", "location.name exposes source geo text."),
      date: decision("list-payload", "first_published/updated_at fields are available when source includes them."),
      remote: decision("url-or-title-inference", "Use explicit remote text in title/location only."),
      sourceId: decision("list-payload", "id/internal_job_id should be preserved.")
    }
  },
  oracle: {
    priority: "P2",
    sourcePattern: "Oracle CandidateExperience requisition API.",
    parserPath: "server/ingestion/sources/oracle/parse.js parseOraclePostingsFromApi",
    requiredFixtures: ["Oracle requisition API response", "expected normalized fixture", "pagination variant"],
    fieldDecisions: {
      geo: decision("list-payload", "PrimaryLocation, TownOrCity, Region2, Country, or workLocation fields expose location evidence."),
      date: decision("list-payload", "PostedDate/postDate fields expose posting date when source includes it."),
      remote: decision("list-payload", "WorkplaceType, worker type, job type, or source text can explicitly expose remote/hybrid evidence."),
      sourceId: decision("list-payload", "Requisition Id is available and must be preserved.")
    }
  },
  adp_workforcenow: {
    priority: "P2",
    sourcePattern: "ADP Workforce Now content links and job requisitions API.",
    parserPath: "server/ingestion/sources/adp_workforcenow/parse.js parseAdpWorkforcenowPostingsFromApi",
    requiredFixtures: ["content links response", "job requisitions response", "expected normalized fixture"],
    fieldDecisions: {
      geo: decision("list-payload", "Requisition locations expose name/address/country fields."),
      date: decision("list-payload", "postDate exposes posting date when source includes it."),
      remote: decision("list-payload", "workLevelCode/location text can expose remote or hybrid evidence."),
      sourceId: decision("list-payload", "itemID is available and must be preserved.")
    }
  },
  paylocity: {
    priority: "P2",
    sourcePattern: "Paylocity recruiting pageData Jobs JSON.",
    parserPath: "server/ingestion/sources/paylocity/parse.js parsePaylocityPostingsFromPageData",
    requiredFixtures: ["pageData Jobs fixture", "expected normalized fixture", "remote/location variants"],
    fieldDecisions: {
      geo: decision("list-payload", "JobLocation city/state/country and LocationName expose location evidence."),
      date: decision("list-payload", "PublishedDate exposes posting date when source includes it."),
      remote: decision("list-payload", "IsRemote and source location/title text expose remote evidence."),
      sourceId: decision("list-payload", "JobId is available and must be preserved.")
    }
  },
  k12jobspot: {
    priority: "P2",
    sourcePattern: "K12JobSpot public Jobs/Search JSON API.",
    parserPath: "server/ingestion/sources/k12jobspot/parse.js parseK12jobspotPostingsFromPayload",
    requiredFixtures: ["Jobs/Search JSON response fixture", "expected normalized fixture", "invalid shape fixture"],
    fieldDecisions: {
      geo: decision("list-payload", "Saved raw API fixture covers jobs[].location city, regionCode, and postalCode evidence."),
      date: decision("list-payload", "Saved raw API fixture covers jobs[].postedDate when source exposes it."),
      remote: decision("source-absent", "Saved K12JobSpot list fixture exposes no remote/hybrid field; concrete geo-backed rows normalize as onsite and missing-geo rows remain gated."),
      sourceId: decision("list-payload", "Saved raw API fixture covers jobs[].id as source_job_id.")
    }
  },
  calcareers: {
    priority: "P2",
    sourcePattern: "CalCareers ASP.NET Search/JobSearchResults HTML plus search, row-count, and pager postbacks.",
    parserPath: "server/ingestion/sources/calcareers/parse.js parseCalcareersPostingsFromHtml",
    requiredFixtures: ["landing hidden-field fixture", "postback HTML fixture", "expected normalized fixture", "invalid shape fixture"],
    fieldDecisions: {
      geo: decision("list-payload", "Saved postback fixture covers the Location label as source-backed city/state evidence."),
      date: decision("list-payload", "Saved postback fixture covers the Publish Date time field as source posting-date evidence."),
      remote: decision("source-absent", "Saved CalCareers list fixture exposes no explicit remote/hybrid field; concrete geo-backed rows normalize as onsite and missing-geo rows remain gated."),
      sourceId: decision("list-payload", "Saved postback fixture covers Job Control text and JobControlId URL as stable source_job_id evidence.")
    }
  },
  statejobsny: {
    priority: "P2",
    sourcePattern: "StateJobsNY public vacancyTable HTML plus vacancyDetailsView detail HTML.",
    parserPath: "server/ingestion/sources/statejobsny/parse.js parseStatejobsnyPostingsFromHtml and parseStatejobsnyDetailFromHtml",
    requiredFixtures: ["vacancyTable HTML fixture", "detail HTML fixture", "expected normalized fixture", "invalid shape fixture"],
    fieldDecisions: {
      geo: decision("detail-page", "Saved detail fixture covers City and State labels; county-only list rows are preserved as county evidence but not published as fake city geo."),
      date: decision("list-payload", "Saved list fixture covers the Posted column as source posting-date evidence."),
      remote: decision("detail-page", "Saved detail fixture covers exact Telecommuting allowed Yes/No labels; Yes maps to hybrid, No maps to onsite, and county-only list rows do not create remote evidence."),
      sourceId: decision("list-payload", "Saved list fixture covers vacancyDetailsView id and Item # as stable source_job_id evidence.")
    }
  },
  lever: {
    priority: "P1",
    sourcePattern: "Lever postings API JSON.",
    parserPath: "server/ingestion/sources/lever/parse.js parseLeverPostingsFromApi",
    requiredFixtures: ["postings JSON with categories and allLocations"],
    fieldDecisions: {
      geo: decision("list-payload", "categories.location/allLocations expose location text; broad regions remain country-null."),
      date: decision("list-payload", "createdAt is available."),
      remote: decision("list-payload", "categories.location can explicitly say remote."),
      sourceId: decision("list-payload", "Lever id is available.")
    }
  },
  smartrecruiters: {
    priority: "P1",
    sourcePattern: "SmartRecruiters public search JSON and Posting API where credentials exist.",
    parserPath: "server/ingestion/sources/smartrecruiters/parse.js parseSmartRecruitersPostingsFromApi",
    requiredFixtures: ["content[] response fixture", "missing-title fixture", "missing-url fixture"],
    fieldDecisions: {
      geo: decision("list-payload", "Saved content[] fixture covers shortLocation/location city, region, and country fields."),
      date: decision("list-payload", "releasedDate/updatedOn/createdOn expose posting dates when source includes them."),
      remote: decision("list-payload", "remote/isRemote/workplaceType/locationType fields expose remote or hybrid evidence when present."),
      sourceId: decision("list-payload", "SmartRecruiters id/uuid/refNumber is available and must be preserved.")
    }
  },
  taleo: {
    priority: "P1",
    sourcePattern: "Taleo bootstrap, REST requisition search, and AJAX fallback.",
    parserPath: "server/ingestion/sources/taleo/parse.js extractTaleoPostingsFromRest",
    requiredFixtures: ["REST requisition fixture", "missing-title fixture", "missing-url fixture"],
    fieldDecisions: {
      geo: decision("list-payload", "Saved REST fixture scans source columns for country, city/state, or remote location evidence."),
      date: decision("list-payload", "Saved REST fixture accepts only date-like source columns and rejects boolean-like values."),
      remote: decision("url-or-title-inference", "Remote/hybrid is inferred only from explicit source location/title text."),
      sourceId: decision("list-payload", "jobId/contestNo is available and must be preserved.")
    }
  },
  dayforcehcm: {
    priority: "P4",
    sourcePattern: "Unsupported until a stable public Dayforce source is certified.",
    parserPath: "none",
    certificationStatus: "unsupported",
    requiredFixtures: ["collector implementation", "raw source fixture", "validation fixture"]
  }
};

const ATS_SOURCE_PATTERNS = {
  adp_myjobs: "ADP MyJobs public board token and apply-custom-filters JSON.",
  adp_workforcenow: "ADP Workforce Now content links and requisitions JSON.",
  adpworkforcenow: "Alias/legacy key for ADP Workforce Now normalized into adp_workforcenow behavior.",
  applicantai: "ApplicantAI public careers HTML.",
  applicantpro: "ApplicantPro board HTML plus core jobs JSON.",
  applytojob: "ApplyToJob/Resumator careers HTML.",
  bamboohr: "BambooHR /careers/list JSON.",
  brassring: "BrassRing board bootstrap plus matched jobs JSON.",
  breezy: "Breezy portal HTML cards.",
  calcareers: "CalCareers ASP.NET list/postback HTML.",
  calopps: "CalOpps paged public HTML.",
  careerplug: "CareerPlug public jobs HTML.",
  careerpuck: "CareerPuck public board JSON.",
  careerspage: "CareersPage public HTML.",
  eightfold: "Eightfold careers HTML plus search API.",
  fountain: "Fountain board .json openings.",
  freshteam: "Freshteam public board HTML.",
  gem: "Gem public GraphQL batch response.",
  getro: "Getro Next.js __NEXT_DATA__ jobs payload.",
  governmentjobs: "GovernmentJobs public AJAX/list HTML.",
  hibob: "HiBob careers board plus job-ad API.",
  hirebridge: "Hirebridge list HTML plus detail pages.",
  hrmdirect: "HRMDirect employment table HTML.",
  isolvisolvedhire: "iSolved Hire board domain id plus core jobs API.",
  jobaps: "JobAps public agency/company page.",
  jobvite: "Jobvite careers HTML tables.",
  join: "JOIN Next.js embedded jobs data.",
  k12jobspot: "K12JobSpot public JSON API.",
  loxo: "Loxo public board HTML.",
  manatal: "Manatal careers-page runtime config, jobs API, and fallback HTML.",
  oracle: "Oracle CandidateExperience requisition API.",
  pageup: "PageUp search/list HTML plus detail pages.",
  paylocity: "Paylocity embedded pageData Jobs JSON.",
  peopleforce: "PeopleForce public careers HTML.",
  pinpointhq: "PinpointHQ postings.json API.",
  policeapp: "PoliceApp public AJAX/list endpoint.",
  recruitcrm: "RecruitCRM public jobs API.",
  recruitee: "Recruitee PublicApp embedded JSON in HTML.",
  rippling: "Rippling public ATS JSON.",
  sagehr: "SageHR public vacancies HTML.",
  saphrcloud: "SAP SuccessFactors/SAP HR Cloud recruiting HTML or jobs API.",
  schoolspring: "SchoolSpring public JSON API.",
  simplicant: "Simplicant public board HTML.",
  smartrecruiters: "SmartRecruiters public search JSON.",
  statejobsny: "StateJobsNY public dated HTML table.",
  taleo: "Taleo bootstrap, REST requisition search, and AJAX fallback.",
  talentreef: "TalentReef alias/search API.",
  talentlyft: "TalentLyft landing config and paged fragments.",
  talexio: "Talexio public jobs JSON.",
  teamtailor: "Teamtailor public board HTML.",
  theapplicantmanager: "The Applicant Manager public careers HTML.",
  ultipro: "UKG/UltiPro opportunities JSON.",
  usajobs: "USAJobs official Search API with Host/User-Agent/Authorization-Key headers.",
  zoho: "Zoho Recruit hidden jobs JSON in careers page."
};

const PARSER_PATHS = {
  adp_myjobs: "server/ingestion/sources/adp_myjobs/parse.js parseAdpMyjobsPostingsFromApi",
  adp_workforcenow: "server/ingestion/sources/adp_workforcenow/parse.js parseAdpWorkforcenowPostingsFromApi",
  adpworkforcenow: "server/ingestion/sources/adp_workforcenow/parse.js parseAdpWorkforcenowPostingsFromApi",
  applicantai: "server/ingestion/sources/applicantai/parse.js parseApplicantAiPostingsFromHtml",
  applicantpro: "server/ingestion/sources/applicantpro/parse.js parseApplicantProPostingsFromApi",
  applytojob: "server/ingestion/sources/applytojob/parse.js parseApplyToJobPostingsFromHtml",
  bamboohr: "server/ingestion/sources/bamboohr/parse.js parseBambooHrPostingsFromApi",
  brassring: "server/ingestion/sources/brassring/parse.js parseBrassringPostingsFromApi",
  breezy: "server/ingestion/sources/breezy/parse.js parseBreezyPostingsFromHtml",
  calcareers: "server/ingestion/sources/calcareers/parse.js parseCalcareersPostingsFromHtml",
  calopps: "server/ingestion/sources/calopps/parse.js parseCaloppsPostingsFromHtml",
  careerplug: "server/ingestion/sources/careerplug/parse.js parseCareerplugPostingsFromHtml",
  careerpuck: "server/ingestion/sources/careerpuck/parse.js parseCareerpuckPostingsFromApi",
  careerspage: "server/ingestion/sources/careerspage/parse.js parseCareerspagePostingsFromHtml",
  eightfold: "server/ingestion/sources/eightfold/parse.js parseEightfoldPostingsFromApi",
  fountain: "server/ingestion/sources/fountain/parse.js parseFountainPostingsFromApi",
  freshteam: "server/ingestion/sources/freshteam/parse.js parseFreshteamPostingsFromHtml",
  gem: "server/ingestion/sources/gem/parse.js parseGemPostingsFromBatchResponse",
  getro: "server/ingestion/sources/getro/parse.js parseGetroPostingsFromHtml",
  governmentjobs: "server/ingestion/sources/governmentjobs/parse.js parseGovernmentJobsPostingsFromViewHtml",
  hibob: "server/ingestion/sources/hibob/parse.js parseHibobPostingsFromApi",
  hirebridge: "server/ingestion/sources/hirebridge/parse.js parseHirebridgePostingsFromHtml",
  hrmdirect: "server/ingestion/sources/hrmdirect/parse.js parseHrmDirectPostingsFromHtml",
  isolvisolvedhire: "server/ingestion/sources/isolvisolvedhire/parse.js parseIsolvisolvedhirePostingsFromApi",
  jobaps: "server/ingestion/sources/jobaps/parse.js parseJobApsPostingsFromHtml",
  jobvite: "server/ingestion/sources/jobvite/parse.js parseJobvitePostingsFromHtml",
  join: "server/ingestion/sources/join/parse.js parseJoinPostingsFromNextData",
  k12jobspot: "server/ingestion/sources/k12jobspot/parse.js parseK12jobspotPostingsFromPayload",
  loxo: "server/ingestion/sources/loxo/parse.js parseLoxoPostingsFromHtml",
  manatal: "server/ingestion/sources/manatal/parse.js parseManatalPostingsFromApi and fallback HTML parser",
  oracle: "server/ingestion/sources/oracle/parse.js parseOraclePostingsFromApi",
  pageup: "server/ingestion/sources/pageup/parse.js parsePageupPostingsFromResults",
  paylocity: "server/ingestion/sources/paylocity/parse.js parsePaylocityPostingsFromPageData",
  peopleforce: "server/ingestion/sources/peopleforce/parse.js parsePeopleforcePostingsFromHtml",
  pinpointhq: "server/ingestion/sources/pinpointhq/parse.js parsePinpointHqPostingsFromApi",
  policeapp: "server/ingestion/sources/policeapp/parse.js parsePoliceappPostingsFromHtml",
  recruitcrm: "server/ingestion/sources/recruitcrm/parse.js parseRecruitCrmPostingsFromApi",
  recruitee: "server/ingestion/sources/recruitee/parse.js parseRecruiteePostingsFromPublicApp",
  rippling: "server/ingestion/sources/rippling/parse.js parseRipplingPostingsFromApi",
  sagehr: "server/ingestion/sources/sagehr/parse.js parseSagehrPostingsFromHtml",
  saphrcloud: "server/ingestion/sources/saphrcloud/parse.js SAP HR Cloud HTML/API parsers",
  schoolspring: "server/ingestion/sources/schoolspring/parse.js parseSchoolspringPostingsFromPayload",
  simplicant: "server/ingestion/sources/simplicant/parse.js parseSimplicantPostingsFromHtml",
  smartrecruiters: "server/ingestion/sources/smartrecruiters/parse.js parseSmartRecruitersPostingsFromApi",
  statejobsny: "server/ingestion/sources/statejobsny/parse.js parseStatejobsnyPostingsFromHtml",
  taleo: "server/ingestion/sources/taleo/parse.js extractTaleoPostingsFromRest and extractTaleoPostingsFromAjax",
  talentreef: "server/ingestion/sources/talentreef/parse.js parseTalentreefPostingsFromSearchResponse",
  talentlyft: "server/ingestion/sources/talentlyft/parse.js parseTalentlyftPostingsFromFragment",
  talexio: "server/ingestion/sources/talexio/parse.js parseTalexioPostingsFromApi",
  teamtailor: "server/ingestion/sources/teamtailor/parse.js parseTeamtailorPostingsFromHtml",
  theapplicantmanager: "server/ingestion/sources/theapplicantmanager/parse.js parseTheApplicantManagerPostingsFromHtml",
  ultipro: "server/ingestion/sources/ultipro/parse.js parseUltiProPostingsFromApi",
  usajobs: "server/ingestion/sources/usajobs/parse.js parseUsajobsPostingsFromPayload",
  zoho: "server/ingestion/sources/zoho/parse.js parseZohoPostingsFromHtml"
};

function priorityForKey(key) {
  if (["icims", "applitrack"].includes(key)) return "P0";
  if (["manatal", "applytojob", "taleo", "breezy", "workday", "bamboohr", "ashby", "hrmdirect", "zoho"].includes(key)) return "P1";
  if (PARSER_FIXTURE_BACKED.has(key)) return "P2";
  if (UNSUPPORTED_ATS.has(key)) return "P4";
  return "P3";
}

function requiredFixturesForKey(key) {
  if (UNSUPPORTED_ATS.has(key)) return ["collector implementation", "raw fixture", "expected normalized fixture"];
  if (["icims", "applitrack", "pageup", "hirebridge"].includes(key)) return ["list fixture", "detail fixture", "expected normalized fixture"];
  if (["workday", "adp_myjobs", "adp_workforcenow", "eightfold", "ultipro", "rippling", "talentreef"].includes(key)) return ["API response fixture", "pagination fixture", "expected normalized fixture"];
  if (["recruitee", "zoho", "join", "getro"].includes(key)) return ["embedded JSON HTML fixture", "expected normalized fixture"];
  return ["list/source fixture", "expected normalized fixture"];
}

function createCertificationRecord(key) {
  const override = ATS_CERTIFICATION_OVERRIDES[key] || {};
  const parserFixtureStatus = getParserFixtureStatus(key);
  const certificationStatus =
    override.certificationStatus ||
    (UNSUPPORTED_ATS.has(key)
      ? "unsupported"
      : parserFixtureStatus === "parser-fixture-backed"
        ? "parser-fixture-backed"
        : parserFixtureStatus === "normalized-fixture-only"
          ? "normalized-fixture-only"
          : "pending-raw-fixture");
  return {
    key,
    version: CERTIFICATION_VERSION,
    tier: getAdapterTier(key),
    priority: override.priority || priorityForKey(key),
    certificationStatus,
    parserFixtureStatus,
    sourcePattern: override.sourcePattern || ATS_SOURCE_PATTERNS[key] || `${key} public ATS source; endpoint certification pending.`,
    parserPath: override.parserPath || PARSER_PATHS[key] || "server/index.js legacy collector",
    fieldDecisions: {
      ...baseFieldDecisions(key),
      ...(override.fieldDecisions || {})
    },
    requiredFixtures: override.requiredFixtures || requiredFixturesForKey(key),
    notes: override.notes || ""
  };
}

function buildAtsCertificationRecords(atsKeys) {
  const records = {};
  for (const key of atsKeys) {
    records[key] = createCertificationRecord(key);
  }
  return records;
}

function validateCertificationRecord(record) {
  const errors = [];
  if (!record || typeof record !== "object") {
    return ["record must be an object"];
  }
  if (!record.key) errors.push("missing key");
  if (!record.version) errors.push(`${record.key || "unknown"} missing version`);
  if (!CERTIFICATION_STATUSES.has(record.certificationStatus)) {
    errors.push(`${record.key} invalid certificationStatus ${record.certificationStatus}`);
  }
  if (!record.sourcePattern) errors.push(`${record.key} missing sourcePattern`);
  if (!record.parserPath) errors.push(`${record.key} missing parserPath`);
  if (!Array.isArray(record.requiredFixtures) || record.requiredFixtures.length === 0) {
    errors.push(`${record.key} missing requiredFixtures`);
  }
  for (const fieldName of FIELD_NAMES) {
    const field = record.fieldDecisions?.[fieldName];
    if (!field) {
      errors.push(`${record.key} missing ${fieldName} decision`);
      continue;
    }
    if (!FIELD_DECISION_STATUSES.has(field.status)) {
      errors.push(`${record.key} invalid ${fieldName} decision ${field.status}`);
    }
    if (!field.evidence) {
      errors.push(`${record.key} missing ${fieldName} evidence`);
    }
  }
  if (record.certificationStatus === "parser-fixture-backed") {
    const pendingFields = FIELD_NAMES.filter((fieldName) => record.fieldDecisions[fieldName].status === "pending-research");
    if (pendingFields.length > 0) {
      errors.push(`${record.key} parser-fixture-backed record has pending fields: ${pendingFields.join(", ")}`);
    }
  }
  if (record.fieldDecisions?.date?.status === "url-or-title-inference") {
    errors.push(`${record.key} date must not be inferred from URL or title`);
  }
  return errors;
}

module.exports = {
  CERTIFICATION_STATUSES,
  CERTIFICATION_VERSION,
  FIELD_DECISION_STATUSES,
  FIELD_NAMES,
  buildAtsCertificationRecords,
  validateCertificationRecord
};
