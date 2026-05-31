const SMARTRECRUITERS_INSERT_EVERY_N_TARGETS = 10;

const DYNAMIC_SYNC_ESTIMATED_COMPANY_COUNTS = Object.freeze({
  governmentjobs: 2400,
  smartrecruiters: 4000,
  policeapp: 1166,
  usajobs: 26,
  k12jobspot: 13000,
  schoolspring: 16287,
  calcareers: 297,
  calopps: 254,
  statejobsny: 165
});

const DYNAMIC_SYNC_TARGETS_BY_ATS = Object.freeze({
  smartrecruiters: Object.freeze({
    id: null,
    company_name: "SmartRecruiters (dynamic)",
    url_string: "https://jobs.smartrecruiters.com/sr-jobs/search",
    ATS_name: "smartrecruiters"
  }),
  governmentjobs: Object.freeze({
    id: null,
    company_name: "GovernmentJobs (dynamic)",
    url_string: "https://www.governmentjobs.com/jobs",
    ATS_name: "governmentjobs"
  }),
  policeapp: Object.freeze({
    id: null,
    company_name: "PoliceApp (dynamic)",
    url_string: "https://www.policeapp.com/jobs/urlrewrite_jobpostings/jobResultsAjax.ashx?j=0&r=50&s=0&p=0",
    ATS_name: "policeapp"
  }),
  usajobs: Object.freeze({
    id: null,
    company_name: "USAJobs (dynamic)",
    url_string: "https://data.usajobs.gov/api/Search",
    ATS_name: "usajobs"
  }),
  k12jobspot: Object.freeze({
    id: null,
    company_name: "K12JobSpot (dynamic)",
    url_string: "https://api.k12jobspot.com/api/Jobs/Search",
    ATS_name: "k12jobspot"
  }),
  schoolspring: Object.freeze({
    id: null,
    company_name: "SchoolSpring (dynamic)",
    url_string:
      "https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch?domainName=&keyword=&location=&category=&gradelevel=&jobtype=&organization=&swLat=&swLon=&neLat=&neLon=&page=1&size=25&sortDateAscending=false",
    ATS_name: "schoolspring"
  }),
  calcareers: Object.freeze({
    id: null,
    company_name: "CalCareers (dynamic)",
    url_string: "https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx",
    ATS_name: "calcareers"
  }),
  calopps: Object.freeze({
    id: null,
    company_name: "CalOpps (dynamic)",
    url_string: "https://www.calopps.org/job-search-list",
    ATS_name: "calopps"
  }),
  statejobsny: Object.freeze({
    id: null,
    company_name: "StateJobsNY (dynamic)",
    url_string: "https://www.statejobsny.com/public/vacancyTable.cfm",
    ATS_name: "statejobsny"
  })
});

function hasEnabledAts(enabledAts, atsKey) {
  if (enabledAts instanceof Set) return enabledAts.has(atsKey);
  return Array.isArray(enabledAts) && enabledAts.includes(atsKey);
}

function dynamicTarget(atsKey) {
  const target = DYNAMIC_SYNC_TARGETS_BY_ATS[atsKey];
  return target ? { ...target } : null;
}

function getDynamicSyncEstimatedCompanyCount(enabledAts) {
  return Object.entries(DYNAMIC_SYNC_ESTIMATED_COMPANY_COUNTS).reduce((total, [atsKey, count]) => {
    return hasEnabledAts(enabledAts, atsKey) ? total + count : total;
  }, 0);
}

function buildLegacySqliteSyncTargets(companies, enabledAts) {
  const syncTargets = [];
  let smartRecruitersInserted = false;
  let companyInsertionsSinceSmartRecruiters = 0;

  for (const company of Array.isArray(companies) ? companies : []) {
    syncTargets.push(company);
    companyInsertionsSinceSmartRecruiters += 1;

    if (
      hasEnabledAts(enabledAts, "smartrecruiters") &&
      companyInsertionsSinceSmartRecruiters >= SMARTRECRUITERS_INSERT_EVERY_N_TARGETS
    ) {
      syncTargets.push(dynamicTarget("smartrecruiters"));
      smartRecruitersInserted = true;
      companyInsertionsSinceSmartRecruiters = 0;
    }
  }

  if (hasEnabledAts(enabledAts, "smartrecruiters") && companyInsertionsSinceSmartRecruiters > 0) {
    syncTargets.push(dynamicTarget("smartrecruiters"));
    smartRecruitersInserted = true;
  }

  if (hasEnabledAts(enabledAts, "smartrecruiters") && !smartRecruitersInserted) {
    syncTargets.push(dynamicTarget("smartrecruiters"));
  }

  for (const atsKey of [
    "governmentjobs",
    "policeapp",
    "usajobs",
    "k12jobspot",
    "schoolspring",
    "calcareers",
    "calopps",
    "statejobsny"
  ]) {
    if (hasEnabledAts(enabledAts, atsKey)) syncTargets.push(dynamicTarget(atsKey));
  }

  return syncTargets;
}

module.exports = {
  DYNAMIC_SYNC_ESTIMATED_COMPANY_COUNTS,
  DYNAMIC_SYNC_TARGETS_BY_ATS,
  SMARTRECRUITERS_INSERT_EVERY_N_TARGETS,
  buildLegacySqliteSyncTargets,
  getDynamicSyncEstimatedCompanyCount
};
