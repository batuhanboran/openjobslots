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

const CERTIFICATION_VERSION = "ats-field-certification-v1.5.17";

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
    parserPath: "server/index.js parseIcimsPostingsFromHtml plus detail helpers",
    requiredFixtures: ["wrapper html", "iframe/list html", "next page html", "detail html"],
    fieldDecisions: {
      geo: decision("detail-page", "Live rows show card/list geo is often missing; detail pages may expose location."),
      date: decision("detail-page", "Live rows are almost all missing date; certify detail date extraction or documented absence."),
      remote: decision("url-or-title-inference", "Remote can only be inferred from explicit title/location/detail text."),
      sourceId: decision("url-or-title-inference", "Stable /jobs/{id}/ URL id is already recoverable.")
    }
  },
  applitrack: {
    priority: "P0",
    sourcePattern: "Applitrack Output.asp?all=1 list plus JobPostings detail pages.",
    parserPath: "server/index.js parseApplitrackPostings and extractApplitrackDetailFields",
    requiredFixtures: ["Output.asp list html", "detail page with location/date", "detail page with omitted fields"],
    fieldDecisions: {
      geo: decision("detail-page", "Most live rows lack list geo; detail pages must decide whether data exists."),
      date: decision("detail-page", "Most live rows lack list date; detail pages must decide whether data exists."),
      remote: decision("url-or-title-inference", "Use only explicit remote/hybrid/on-site text."),
      sourceId: decision("url-or-title-inference", "applyFor/listing URL id is recoverable.")
    }
  },
  workday: {
    priority: "P1",
    sourcePattern: "Workday CXS jobPostings API with externalPath/job URL fields.",
    parserPath: "server/index.js Workday CXS collector/helpers",
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
    parserPath: "server/index.js Ashby collector",
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
    parserPath: "server/index.js Greenhouse collector",
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
    parserPath: "server/index.js parseOraclePostingsFromApi",
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
    parserPath: "server/index.js parseAdpWorkforcenowPostingsFromApi",
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
    parserPath: "server/index.js parsePaylocityPostingsFromPageData",
    requiredFixtures: ["pageData Jobs fixture", "expected normalized fixture", "remote/location variants"],
    fieldDecisions: {
      geo: decision("list-payload", "JobLocation city/state/country and LocationName expose location evidence."),
      date: decision("list-payload", "PublishedDate exposes posting date when source includes it."),
      remote: decision("list-payload", "IsRemote and source location/title text expose remote evidence."),
      sourceId: decision("list-payload", "JobId is available and must be preserved.")
    }
  },
  lever: {
    priority: "P1",
    sourcePattern: "Lever postings API JSON.",
    parserPath: "server/index.js Lever collector",
    requiredFixtures: ["postings JSON with categories and allLocations"],
    fieldDecisions: {
      geo: decision("list-payload", "categories.location/allLocations expose location text; broad regions remain country-null."),
      date: decision("list-payload", "createdAt is available."),
      remote: decision("list-payload", "categories.location can explicitly say remote."),
      sourceId: decision("list-payload", "Lever id is available.")
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
  usajobs: "USAJobs landing token and search POST.",
  zoho: "Zoho Recruit hidden jobs JSON in careers page."
};

const PARSER_PATHS = {
  adp_myjobs: "server/index.js parseAdpMyjobsPostingsFromApi",
  adp_workforcenow: "server/index.js parseAdpWorkforcenowPostingsFromApi",
  adpworkforcenow: "server/index.js parseAdpWorkforcenowPostingsFromApi",
  applicantai: "server/index.js parseApplicantAiPostingsFromHtml",
  applicantpro: "server/index.js ApplicantPro collector/API mapping",
  applytojob: "server/index.js parseApplyToJobPostingsFromHtml",
  bamboohr: "server/index.js parseBambooHrPostingsFromApi",
  brassring: "server/index.js BrassRing collector/API mapping",
  breezy: "server/index.js parseBreezyPostingsFromHtml",
  calcareers: "server/index.js CalCareers collector",
  calopps: "server/index.js CalOpps collector",
  careerplug: "server/index.js parseCareerplugPostingsFromHtml",
  careerpuck: "server/index.js parseCareerpuckPostingsFromApi",
  careerspage: "server/index.js parseCareerspagePostingsFromHtml",
  eightfold: "server/index.js parseEightfoldPostingsFromApi",
  fountain: "server/index.js parseFountainPostingsFromApi",
  freshteam: "server/index.js parseFreshteamPostingsFromHtml",
  gem: "server/index.js parseGemPostingsFromBatchResponse",
  getro: "server/index.js parseGetroPostingsFromHtml",
  governmentjobs: "server/index.js GovernmentJobs collector",
  hibob: "server/index.js parseHibobPostingsFromApi",
  hirebridge: "server/index.js parseHirebridgePostingsFromHtml",
  hrmdirect: "server/index.js parseHrmDirectPostingsFromHtml",
  isolvisolvedhire: "server/index.js parseIsolvisolvedhirePostingsFromApi",
  jobaps: "server/index.js JobAps collector",
  jobvite: "server/index.js parseJobvitePostingsFromHtml",
  join: "server/index.js parseJoinPostingsFromNextData",
  k12jobspot: "server/index.js K12JobSpot collector",
  loxo: "server/index.js parseLoxoPostingsFromHtml",
  manatal: "server/index.js parseManatalPostingsFromApi and fallback HTML parser",
  oracle: "server/index.js parseOraclePostingsFromApi",
  pageup: "server/index.js parsePageupPostingsFromResults",
  paylocity: "server/index.js parsePaylocityPostingsFromPageData",
  peopleforce: "server/index.js parsePeopleforcePostingsFromHtml",
  pinpointhq: "server/index.js parsePinpointHqPostingsFromApi",
  policeapp: "server/index.js PoliceApp AJAX collector",
  recruitcrm: "server/index.js parseRecruitCrmPostingsFromApi",
  recruitee: "server/index.js parseRecruiteePostingsFromPublicApp",
  rippling: "server/index.js parseRipplingPostingsFromApi",
  sagehr: "server/index.js parseSagehrPostingsFromHtml",
  saphrcloud: "server/index.js SAP HR Cloud HTML/API parsers",
  schoolspring: "server/index.js SchoolSpring collector",
  simplicant: "server/index.js parseSimplicantPostingsFromHtml",
  smartrecruiters: "server/index.js SmartRecruiters collector",
  statejobsny: "server/index.js StateJobsNY collector",
  taleo: "server/index.js extractTaleoPostingsFromRest and fallback collector",
  talentreef: "server/index.js parseTalentreefPostingsFromSearchResponse",
  talentlyft: "server/index.js parseTalentlyftPostingsFromFragment",
  talexio: "server/index.js parseTalexioPostingsFromApi",
  teamtailor: "server/index.js parseTeamtailorPostingsFromHtml",
  theapplicantmanager: "server/index.js parseTheApplicantManagerPostingsFromHtml",
  ultipro: "server/index.js UltiPro collector/opportunities parser",
  usajobs: "server/index.js USAJobs token/search collector",
  zoho: "server/index.js parseZohoPostingsFromHtml"
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
