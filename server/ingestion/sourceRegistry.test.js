const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  validateSourceContract
} = require("./sourceContracts");
const {
  getRegistrySourceModule,
  isRegistryPilotSource,
  listRegistrySourceModules
} = require("./sourceRegistry");

test("registry exposes ADP MyJobs, ADP WorkForceNow, ApplicantPro, Applitrack, ApplyToJob, Ashby, BambooHR, BrassRing, Breezy, CalCareers, CareerPlug, CareerPuck, CareersPage, Eightfold, Fountain, Freshteam, Getro, GovernmentJobs, Greenhouse, HireBridge, HRMDirect, iCIMS, isolvisolvedhire, JobAps, Jobvite, Join, K12JobSpot, Lever, Loxo, Manatal, Oracle, PageUp, Paylocity, PinpointHQ, RecruitCRM, Recruitee, Rippling, SchoolSpring, Simplicant, SmartRecruiters, StateJobsNY, Taleo, TalentLyft, TalentReef, Teamtailor, UltiPro, Workday, and Zoho as pilot sources", () => {
  assert.equal(isRegistryPilotSource("adp_myjobs"), true);
  assert.equal(isRegistryPilotSource("adp_workforcenow"), true);
  assert.equal(isRegistryPilotSource("applicantpro"), true);
  assert.equal(isRegistryPilotSource("applitrack"), true);
  assert.equal(isRegistryPilotSource("applytojob"), true);
  assert.equal(isRegistryPilotSource("ashby"), true);
  assert.equal(isRegistryPilotSource("bamboohr"), true);
  assert.equal(isRegistryPilotSource("brassring"), true);
  assert.equal(isRegistryPilotSource("breezy"), true);
  assert.equal(isRegistryPilotSource("calcareers"), true);
  assert.equal(isRegistryPilotSource("careerplug"), true);
  assert.equal(isRegistryPilotSource("careerpuck"), true);
  assert.equal(isRegistryPilotSource("careerspage"), true);
  assert.equal(isRegistryPilotSource("eightfold"), true);
  assert.equal(isRegistryPilotSource("gem"), true);
  assert.equal(isRegistryPilotSource("fountain"), true);
  assert.equal(isRegistryPilotSource("freshteam"), true);
  assert.equal(isRegistryPilotSource("getro"), true);
  assert.equal(isRegistryPilotSource("governmentjobs"), true);
  assert.equal(isRegistryPilotSource("greenhouse"), true);
  assert.equal(isRegistryPilotSource("hirebridge"), true);
  assert.equal(isRegistryPilotSource("hrmdirect"), true);
  assert.equal(isRegistryPilotSource("icims"), true);
  assert.equal(isRegistryPilotSource("isolvisolvedhire"), true);
  assert.equal(isRegistryPilotSource("jobaps"), true);
  assert.equal(isRegistryPilotSource("jobvite"), true);
  assert.equal(isRegistryPilotSource("join"), true);
  assert.equal(isRegistryPilotSource("k12jobspot"), true);
  assert.equal(isRegistryPilotSource("lever"), true);
  assert.equal(isRegistryPilotSource("loxo"), true);
  assert.equal(isRegistryPilotSource("manatal"), true);
  assert.equal(isRegistryPilotSource("oracle"), true);
  assert.equal(isRegistryPilotSource("pageup"), true);
  assert.equal(isRegistryPilotSource("pinpointhq"), true);
  assert.equal(isRegistryPilotSource("paylocity"), true);
  assert.equal(isRegistryPilotSource("recruitcrm"), true);
  assert.equal(isRegistryPilotSource("schoolspring"), true);
  assert.equal(isRegistryPilotSource("simplicant"), true);
  assert.equal(isRegistryPilotSource("smartrecruiters"), true);
  assert.equal(isRegistryPilotSource("statejobsny"), true);
  assert.equal(isRegistryPilotSource("recruitee"), true);
  assert.equal(isRegistryPilotSource("rippling"), true);
  assert.equal(isRegistryPilotSource("taleo"), true);
  assert.equal(isRegistryPilotSource("talentlyft"), true);
  assert.equal(isRegistryPilotSource("talentreef"), true);
  assert.equal(isRegistryPilotSource("teamtailor"), true);
  assert.equal(isRegistryPilotSource("ultipro"), true);
  assert.equal(isRegistryPilotSource("workday"), true);
  assert.equal(isRegistryPilotSource("zoho"), true);

  const pilotKeys = listRegistrySourceModules().map((item) => item.atsKey).sort();
  assert.deepEqual(pilotKeys, [
    "adp_myjobs",
    "adp_workforcenow",
    "applicantpro",
    "applitrack",
    "applytojob",
    "ashby",
    "bamboohr",
    "brassring",
    "breezy",
    "calcareers",
    "careerplug",
    "careerpuck",
    "careerspage",
    "eightfold",
    "fountain",
    "freshteam",
    "gem",
    "getro",
    "governmentjobs",
    "greenhouse",
    "hirebridge",
    "hrmdirect",
    "icims",
    "isolvisolvedhire",
    "jobaps",
    "jobvite",
    "join",
    "k12jobspot",
    "lever",
    "loxo",
    "manatal",
    "oracle",
    "pageup",
    "paylocity",
    "pinpointhq",
    "recruitcrm",
    "recruitee",
    "rippling",
    "schoolspring",
    "simplicant",
    "smartrecruiters",
    "statejobsny",
    "talentlyft",
    "talentreef",
    "taleo",
    "teamtailor",
    "ultipro",
    "workday",
    "zoho"
  ]);
});

test("registry returns contract-valid pilot source modules", () => {
  const adpMyjobs = getRegistrySourceModule("adp_myjobs");
  assert.equal(adpMyjobs.atsKey, "adp_myjobs");
  assert.equal(adpMyjobs.family, SOURCE_FAMILIES.enterpriseDirect);
  assert.equal(adpMyjobs.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof adpMyjobs.discover, "function");
  assert.equal(typeof adpMyjobs.fetchList, "function");
  assert.equal(typeof adpMyjobs.parse, "function");
  assert.equal(typeof adpMyjobs.normalize, "function");
  assert.equal(typeof adpMyjobs.validate, "function");
  assert.deepEqual(validateSourceContract(adpMyjobs), { ok: true, failures: [] });

  const adpWorkforcenow = getRegistrySourceModule("adp_workforcenow");
  assert.equal(adpWorkforcenow.atsKey, "adp_workforcenow");
  assert.equal(adpWorkforcenow.family, SOURCE_FAMILIES.enterpriseDirect);
  assert.equal(adpWorkforcenow.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof adpWorkforcenow.discover, "function");
  assert.equal(typeof adpWorkforcenow.fetchList, "function");
  assert.equal(typeof adpWorkforcenow.parse, "function");
  assert.equal(typeof adpWorkforcenow.normalize, "function");
  assert.equal(typeof adpWorkforcenow.validate, "function");
  assert.deepEqual(validateSourceContract(adpWorkforcenow), { ok: true, failures: [] });

  const applicantPro = getRegistrySourceModule("applicantpro");
  assert.equal(applicantPro.atsKey, "applicantpro");
  assert.equal(applicantPro.family, SOURCE_FAMILIES.embeddedOrSemiStructured);
  assert.equal(applicantPro.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof applicantPro.discover, "function");
  assert.equal(typeof applicantPro.fetchList, "function");
  assert.equal(typeof applicantPro.parse, "function");
  assert.equal(typeof applicantPro.normalize, "function");
  assert.equal(typeof applicantPro.validate, "function");
  assert.deepEqual(validateSourceContract(applicantPro), { ok: true, failures: [] });

  const applitrack = getRegistrySourceModule("applitrack");
  assert.equal(applitrack.atsKey, "applitrack");
  assert.equal(applitrack.family, SOURCE_FAMILIES.publicSectorEducation);
  assert.equal(applitrack.status, SOURCE_STATUSES.quarantine);
  assert.equal(typeof applitrack.discover, "function");
  assert.equal(typeof applitrack.fetchList, "function");
  assert.equal(typeof applitrack.parse, "function");
  assert.equal(typeof applitrack.normalize, "function");
  assert.equal(typeof applitrack.validate, "function");
  assert.deepEqual(validateSourceContract(applitrack), { ok: true, failures: [] });

  const applyToJob = getRegistrySourceModule("applytojob");
  assert.equal(applyToJob.atsKey, "applytojob");
  assert.equal(applyToJob.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(applyToJob.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof applyToJob.discover, "function");
  assert.equal(typeof applyToJob.fetchList, "function");
  assert.equal(typeof applyToJob.parse, "function");
  assert.equal(typeof applyToJob.normalize, "function");
  assert.equal(typeof applyToJob.validate, "function");
  assert.deepEqual(validateSourceContract(applyToJob), { ok: true, failures: [] });

  const ashby = getRegistrySourceModule("ashby");
  assert.equal(ashby.atsKey, "ashby");
  assert.equal(ashby.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(ashby.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof ashby.discover, "function");
  assert.equal(typeof ashby.fetchList, "function");
  assert.equal(typeof ashby.parse, "function");
  assert.equal(typeof ashby.normalize, "function");
  assert.equal(typeof ashby.validate, "function");
  assert.deepEqual(validateSourceContract(ashby), { ok: true, failures: [] });

  const bamboohr = getRegistrySourceModule("bamboohr");
  assert.equal(bamboohr.atsKey, "bamboohr");
  assert.equal(bamboohr.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(bamboohr.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof bamboohr.discover, "function");
  assert.equal(typeof bamboohr.fetchList, "function");
  assert.equal(typeof bamboohr.parse, "function");
  assert.equal(typeof bamboohr.normalize, "function");
  assert.equal(typeof bamboohr.validate, "function");
  assert.deepEqual(validateSourceContract(bamboohr), { ok: true, failures: [] });

  const brassring = getRegistrySourceModule("brassring");
  assert.equal(brassring.atsKey, "brassring");
  assert.equal(brassring.family, SOURCE_FAMILIES.brittleHighRisk);
  assert.equal(brassring.status, SOURCE_STATUSES.disabled);
  assert.equal(brassring.collectWhenDisabled, false);
  assert.equal(typeof brassring.discover, "function");
  assert.equal(typeof brassring.fetchList, "function");
  assert.equal(typeof brassring.parse, "function");
  assert.equal(typeof brassring.normalize, "function");
  assert.equal(typeof brassring.validate, "function");
  assert.deepEqual(validateSourceContract(brassring), { ok: true, failures: [] });

  const breezy = getRegistrySourceModule("breezy");
  assert.equal(breezy.atsKey, "breezy");
  assert.equal(breezy.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(breezy.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof breezy.discover, "function");
  assert.equal(typeof breezy.fetchList, "function");
  assert.equal(typeof breezy.parse, "function");
  assert.equal(typeof breezy.normalize, "function");
  assert.equal(typeof breezy.validate, "function");
  assert.deepEqual(validateSourceContract(breezy), { ok: true, failures: [] });

  const careerplug = getRegistrySourceModule("careerplug");
  assert.equal(careerplug.atsKey, "careerplug");
  assert.equal(careerplug.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(careerplug.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof careerplug.discover, "function");
  assert.equal(typeof careerplug.fetchList, "function");
  assert.equal(typeof careerplug.parse, "function");
  assert.equal(typeof careerplug.normalize, "function");
  assert.equal(typeof careerplug.validate, "function");
  assert.deepEqual(validateSourceContract(careerplug), { ok: true, failures: [] });

  const careerpuck = getRegistrySourceModule("careerpuck");
  assert.equal(careerpuck.atsKey, "careerpuck");
  assert.equal(careerpuck.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(careerpuck.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof careerpuck.discover, "function");
  assert.equal(typeof careerpuck.fetchList, "function");
  assert.equal(typeof careerpuck.parse, "function");
  assert.equal(typeof careerpuck.normalize, "function");
  assert.equal(typeof careerpuck.validate, "function");
  assert.deepEqual(validateSourceContract(careerpuck), { ok: true, failures: [] });

  const eightfold = getRegistrySourceModule("eightfold");
  assert.equal(eightfold.atsKey, "eightfold");
  assert.equal(eightfold.family, SOURCE_FAMILIES.enterpriseDirect);
  assert.equal(eightfold.status, SOURCE_STATUSES.disabled);
  assert.equal(eightfold.collectWhenDisabled, false);
  assert.equal(typeof eightfold.discover, "function");
  assert.equal(typeof eightfold.fetchList, "function");
  assert.equal(typeof eightfold.parse, "function");
  assert.equal(typeof eightfold.normalize, "function");
  assert.equal(typeof eightfold.validate, "function");
  assert.deepEqual(validateSourceContract(eightfold), { ok: true, failures: [] });

  const gem = getRegistrySourceModule("gem");
  assert.equal(gem.atsKey, "gem");
  assert.equal(gem.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(gem.status, SOURCE_STATUSES.disabled);
  assert.equal(gem.collectWhenDisabled, false);
  assert.equal(typeof gem.discover, "function");
  assert.equal(typeof gem.fetchList, "function");
  assert.equal(typeof gem.parse, "function");
  assert.equal(typeof gem.normalize, "function");
  assert.equal(typeof gem.validate, "function");
  assert.deepEqual(validateSourceContract(gem), { ok: true, failures: [] });

  const greenhouse = getRegistrySourceModule("greenhouse");
  assert.equal(greenhouse.atsKey, "greenhouse");
  assert.equal(greenhouse.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(greenhouse.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof greenhouse.discover, "function");
  assert.equal(typeof greenhouse.fetchList, "function");
  assert.equal(typeof greenhouse.parse, "function");
  assert.equal(typeof greenhouse.normalize, "function");
  assert.equal(typeof greenhouse.validate, "function");
  assert.deepEqual(validateSourceContract(greenhouse), { ok: true, failures: [] });

  const governmentJobs = getRegistrySourceModule("governmentjobs");
  assert.equal(governmentJobs.atsKey, "governmentjobs");
  assert.equal(governmentJobs.family, SOURCE_FAMILIES.publicSectorEducation);
  assert.equal(governmentJobs.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof governmentJobs.discover, "function");
  assert.equal(typeof governmentJobs.fetchList, "function");
  assert.equal(typeof governmentJobs.parse, "function");
  assert.equal(typeof governmentJobs.normalize, "function");
  assert.equal(typeof governmentJobs.validate, "function");
  assert.deepEqual(validateSourceContract(governmentJobs), { ok: true, failures: [] });

  const hirebridge = getRegistrySourceModule("hirebridge");
  assert.equal(hirebridge.atsKey, "hirebridge");
  assert.equal(hirebridge.family, SOURCE_FAMILIES.embeddedOrSemiStructured);
  assert.equal(hirebridge.status, SOURCE_STATUSES.disabled);
  assert.equal(hirebridge.collectWhenDisabled, false);
  assert.equal(typeof hirebridge.discover, "function");
  assert.equal(typeof hirebridge.fetchList, "function");
  assert.equal(typeof hirebridge.parse, "function");
  assert.equal(typeof hirebridge.normalize, "function");
  assert.equal(typeof hirebridge.validate, "function");
  assert.deepEqual(validateSourceContract(hirebridge), { ok: true, failures: [] });

  const fountain = getRegistrySourceModule("fountain");
  assert.equal(fountain.atsKey, "fountain");
  assert.equal(fountain.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(fountain.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof fountain.discover, "function");
  assert.equal(typeof fountain.fetchList, "function");
  assert.equal(typeof fountain.parse, "function");
  assert.equal(typeof fountain.normalize, "function");
  assert.equal(typeof fountain.validate, "function");
  assert.deepEqual(validateSourceContract(fountain), { ok: true, failures: [] });

  const freshteam = getRegistrySourceModule("freshteam");
  assert.equal(freshteam.atsKey, "freshteam");
  assert.equal(freshteam.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(freshteam.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof freshteam.discover, "function");
  assert.equal(typeof freshteam.fetchList, "function");
  assert.equal(typeof freshteam.parse, "function");
  assert.equal(typeof freshteam.normalize, "function");
  assert.equal(typeof freshteam.validate, "function");
  assert.deepEqual(validateSourceContract(freshteam), { ok: true, failures: [] });

  const icims = getRegistrySourceModule("icims");
  assert.equal(icims.atsKey, "icims");
  assert.equal(icims.family, SOURCE_FAMILIES.embeddedOrSemiStructured);
  assert.equal(icims.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof icims.discover, "function");
  assert.equal(typeof icims.fetchList, "function");
  assert.equal(typeof icims.parse, "function");
  assert.equal(typeof icims.normalize, "function");
  assert.equal(typeof icims.validate, "function");
  assert.deepEqual(validateSourceContract(icims), { ok: true, failures: [] });

  const hrmDirect = getRegistrySourceModule("hrmdirect");
  assert.equal(hrmDirect.atsKey, "hrmdirect");
  assert.equal(hrmDirect.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(hrmDirect.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof hrmDirect.discover, "function");
  assert.equal(typeof hrmDirect.fetchList, "function");
  assert.equal(typeof hrmDirect.parse, "function");
  assert.equal(typeof hrmDirect.normalize, "function");
  assert.equal(typeof hrmDirect.validate, "function");
  assert.deepEqual(validateSourceContract(hrmDirect), { ok: true, failures: [] });

  const isolvIsolvedHire = getRegistrySourceModule("isolvisolvedhire");
  assert.equal(isolvIsolvedHire.atsKey, "isolvisolvedhire");
  assert.equal(isolvIsolvedHire.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(isolvIsolvedHire.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof isolvIsolvedHire.discover, "function");
  assert.equal(typeof isolvIsolvedHire.fetchList, "function");
  assert.equal(typeof isolvIsolvedHire.parse, "function");
  assert.equal(typeof isolvIsolvedHire.normalize, "function");
  assert.equal(typeof isolvIsolvedHire.validate, "function");
  assert.deepEqual(validateSourceContract(isolvIsolvedHire), { ok: true, failures: [] });

  const jobvite = getRegistrySourceModule("jobvite");
  assert.equal(jobvite.atsKey, "jobvite");
  assert.equal(jobvite.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(jobvite.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof jobvite.discover, "function");
  assert.equal(typeof jobvite.fetchList, "function");
  assert.equal(typeof jobvite.parse, "function");
  assert.equal(typeof jobvite.normalize, "function");
  assert.equal(typeof jobvite.validate, "function");
  assert.deepEqual(validateSourceContract(jobvite), { ok: true, failures: [] });

  const k12jobspot = getRegistrySourceModule("k12jobspot");
  assert.equal(k12jobspot.atsKey, "k12jobspot");
  assert.equal(k12jobspot.family, SOURCE_FAMILIES.publicSectorEducation);
  assert.equal(k12jobspot.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof k12jobspot.discover, "function");
  assert.equal(typeof k12jobspot.fetchList, "function");
  assert.equal(typeof k12jobspot.parse, "function");
  assert.equal(typeof k12jobspot.normalize, "function");
  assert.equal(typeof k12jobspot.validate, "function");
  assert.deepEqual(validateSourceContract(k12jobspot), { ok: true, failures: [] });

  const lever = getRegistrySourceModule("lever");
  assert.equal(lever.atsKey, "lever");
  assert.equal(lever.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(lever.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof lever.discover, "function");
  assert.equal(typeof lever.fetchList, "function");
  assert.equal(typeof lever.parse, "function");
  assert.equal(typeof lever.normalize, "function");
  assert.equal(typeof lever.validate, "function");
  assert.deepEqual(validateSourceContract(lever), { ok: true, failures: [] });

  const join = getRegistrySourceModule("join");
  assert.equal(join.atsKey, "join");
  assert.equal(join.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(join.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof join.discover, "function");
  assert.equal(typeof join.fetchList, "function");
  assert.equal(typeof join.parse, "function");
  assert.equal(typeof join.normalize, "function");
  assert.equal(typeof join.validate, "function");
  assert.deepEqual(validateSourceContract(join), { ok: true, failures: [] });

  const manatal = getRegistrySourceModule("manatal");
  assert.equal(manatal.atsKey, "manatal");
  assert.equal(manatal.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(manatal.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof manatal.discover, "function");
  assert.equal(typeof manatal.fetchList, "function");
  assert.equal(typeof manatal.parse, "function");
  assert.equal(typeof manatal.normalize, "function");
  assert.equal(typeof manatal.validate, "function");
  assert.deepEqual(validateSourceContract(manatal), { ok: true, failures: [] });

  const teamtailor = getRegistrySourceModule("teamtailor");
  assert.equal(teamtailor.atsKey, "teamtailor");
  assert.equal(teamtailor.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(teamtailor.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof teamtailor.discover, "function");
  assert.equal(typeof teamtailor.fetchList, "function");
  assert.equal(typeof teamtailor.parse, "function");
  assert.equal(typeof teamtailor.normalize, "function");
  assert.equal(typeof teamtailor.validate, "function");
  assert.deepEqual(validateSourceContract(teamtailor), { ok: true, failures: [] });

  const oracle = getRegistrySourceModule("oracle");
  assert.equal(oracle.atsKey, "oracle");
  assert.equal(oracle.family, SOURCE_FAMILIES.enterpriseDirect);
  assert.equal(oracle.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof oracle.discover, "function");
  assert.equal(typeof oracle.fetchList, "function");
  assert.equal(typeof oracle.parse, "function");
  assert.equal(typeof oracle.normalize, "function");
  assert.equal(typeof oracle.validate, "function");
  assert.deepEqual(validateSourceContract(oracle), { ok: true, failures: [] });

  const pinpointHq = getRegistrySourceModule("pinpointhq");
  assert.equal(pinpointHq.atsKey, "pinpointhq");
  assert.equal(pinpointHq.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(pinpointHq.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof pinpointHq.discover, "function");
  assert.equal(typeof pinpointHq.fetchList, "function");
  assert.equal(typeof pinpointHq.parse, "function");
  assert.equal(typeof pinpointHq.normalize, "function");
  assert.equal(typeof pinpointHq.validate, "function");
  assert.deepEqual(validateSourceContract(pinpointHq), { ok: true, failures: [] });

  const paylocity = getRegistrySourceModule("paylocity");
  assert.equal(paylocity.atsKey, "paylocity");
  assert.equal(paylocity.family, SOURCE_FAMILIES.enterpriseDirect);
  assert.equal(paylocity.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof paylocity.discover, "function");
  assert.equal(typeof paylocity.fetchList, "function");
  assert.equal(typeof paylocity.parse, "function");
  assert.equal(typeof paylocity.normalize, "function");
  assert.equal(typeof paylocity.validate, "function");
  assert.deepEqual(validateSourceContract(paylocity), { ok: true, failures: [] });

  const pageup = getRegistrySourceModule("pageup");
  assert.equal(pageup.atsKey, "pageup");
  assert.equal(pageup.family, SOURCE_FAMILIES.enterpriseDirect);
  assert.equal(pageup.status, SOURCE_STATUSES.disabled);
  assert.equal(pageup.collectWhenDisabled, false);
  assert.equal(typeof pageup.discover, "function");
  assert.equal(typeof pageup.fetchList, "function");
  assert.equal(typeof pageup.parse, "function");
  assert.equal(typeof pageup.normalize, "function");
  assert.equal(typeof pageup.validate, "function");
  assert.deepEqual(validateSourceContract(pageup), { ok: true, failures: [] });

  const recruitCrm = getRegistrySourceModule("recruitcrm");
  assert.equal(recruitCrm.atsKey, "recruitcrm");
  assert.equal(recruitCrm.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(recruitCrm.status, SOURCE_STATUSES.quarantine);
  assert.equal(typeof recruitCrm.discover, "function");
  assert.equal(typeof recruitCrm.fetchList, "function");
  assert.equal(typeof recruitCrm.parse, "function");
  assert.equal(typeof recruitCrm.normalize, "function");
  assert.equal(typeof recruitCrm.validate, "function");
  assert.deepEqual(validateSourceContract(recruitCrm), { ok: true, failures: [] });

  const smartRecruiters = getRegistrySourceModule("smartrecruiters");
  assert.equal(smartRecruiters.atsKey, "smartrecruiters");
  assert.equal(smartRecruiters.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(smartRecruiters.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof smartRecruiters.discover, "function");
  assert.equal(typeof smartRecruiters.fetchList, "function");
  assert.equal(typeof smartRecruiters.parse, "function");
  assert.equal(typeof smartRecruiters.normalize, "function");
  assert.equal(typeof smartRecruiters.validate, "function");
  assert.deepEqual(validateSourceContract(smartRecruiters), { ok: true, failures: [] });

  const stateJobsNy = getRegistrySourceModule("statejobsny");
  assert.equal(stateJobsNy.atsKey, "statejobsny");
  assert.equal(stateJobsNy.family, SOURCE_FAMILIES.publicSectorEducation);
  assert.equal(stateJobsNy.status, SOURCE_STATUSES.disabled);
  assert.equal(stateJobsNy.collectWhenDisabled, false);
  assert.equal(typeof stateJobsNy.discover, "function");
  assert.equal(typeof stateJobsNy.fetchList, "function");
  assert.equal(typeof stateJobsNy.parse, "function");
  assert.equal(typeof stateJobsNy.normalize, "function");
  assert.equal(typeof stateJobsNy.validate, "function");
  assert.deepEqual(validateSourceContract(stateJobsNy), { ok: true, failures: [] });

  const calCareers = getRegistrySourceModule("calcareers");
  assert.equal(calCareers.atsKey, "calcareers");
  assert.equal(calCareers.family, SOURCE_FAMILIES.publicSectorEducation);
  assert.equal(calCareers.status, SOURCE_STATUSES.disabled);
  assert.equal(calCareers.collectWhenDisabled, false);
  assert.equal(typeof calCareers.discover, "function");
  assert.equal(typeof calCareers.fetchList, "function");
  assert.equal(typeof calCareers.parse, "function");
  assert.equal(typeof calCareers.normalize, "function");
  assert.equal(typeof calCareers.validate, "function");
  assert.deepEqual(validateSourceContract(calCareers), { ok: true, failures: [] });

  const schoolSpring = getRegistrySourceModule("schoolspring");
  assert.equal(schoolSpring.atsKey, "schoolspring");
  assert.equal(schoolSpring.family, SOURCE_FAMILIES.publicSectorEducation);
  assert.equal(schoolSpring.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof schoolSpring.discover, "function");
  assert.equal(typeof schoolSpring.fetchList, "function");
  assert.equal(typeof schoolSpring.parse, "function");
  assert.equal(typeof schoolSpring.normalize, "function");
  assert.equal(typeof schoolSpring.validate, "function");
  assert.deepEqual(validateSourceContract(schoolSpring), { ok: true, failures: [] });

  const simplicant = getRegistrySourceModule("simplicant");
  assert.equal(simplicant.atsKey, "simplicant");
  assert.equal(simplicant.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(simplicant.status, SOURCE_STATUSES.enabled);
  assert.equal(typeof simplicant.discover, "function");
  assert.equal(typeof simplicant.fetchList, "function");
  assert.equal(typeof simplicant.parse, "function");
  assert.equal(typeof simplicant.normalize, "function");
  assert.equal(typeof simplicant.validate, "function");
  assert.deepEqual(validateSourceContract(simplicant), { ok: true, failures: [] });

  const recruitee = getRegistrySourceModule("recruitee");
  assert.equal(recruitee.atsKey, "recruitee");
  assert.equal(recruitee.family, SOURCE_FAMILIES.directJsonStable);
  assert.equal(recruitee.status, SOURCE_STATUSES.quarantine);
  assert.equal(typeof recruitee.discover, "function");
  assert.equal(typeof recruitee.fetchList, "function");
  assert.equal(typeof recruitee.parse, "function");
  assert.equal(typeof recruitee.normalize, "function");
  assert.equal(typeof recruitee.validate, "function");
  assert.deepEqual(validateSourceContract(recruitee), { ok: true, failures: [] });

  const rippling = getRegistrySourceModule("rippling");
  assert.equal(rippling.atsKey, "rippling");
  assert.equal(rippling.family, SOURCE_FAMILIES.vendorSpecific);
  assert.equal(rippling.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof rippling.discover, "function");
  assert.equal(typeof rippling.fetchList, "function");
  assert.equal(typeof rippling.parse, "function");
  assert.equal(typeof rippling.normalize, "function");
  assert.equal(typeof rippling.validate, "function");
  assert.deepEqual(validateSourceContract(rippling), { ok: true, failures: [] });

  const taleo = getRegistrySourceModule("taleo");
  assert.equal(taleo.atsKey, "taleo");
  assert.equal(taleo.family, SOURCE_FAMILIES.brittleHighRisk);
  assert.equal(taleo.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof taleo.discover, "function");
  assert.equal(typeof taleo.fetchList, "function");
  assert.equal(typeof taleo.parse, "function");
  assert.equal(typeof taleo.normalize, "function");
  assert.equal(typeof taleo.validate, "function");
  assert.deepEqual(validateSourceContract(taleo), { ok: true, failures: [] });

  const talentreef = getRegistrySourceModule("talentreef");
  assert.equal(talentreef.atsKey, "talentreef");
  assert.equal(talentreef.family, SOURCE_FAMILIES.embeddedOrSemiStructured);
  assert.equal(talentreef.status, SOURCE_STATUSES.disabled);
  assert.equal(talentreef.collectWhenDisabled, false);
  assert.equal(typeof talentreef.discover, "function");
  assert.equal(typeof talentreef.fetchList, "function");
  assert.equal(typeof talentreef.parse, "function");
  assert.equal(typeof talentreef.normalize, "function");
  assert.equal(typeof talentreef.validate, "function");
  assert.deepEqual(validateSourceContract(talentreef), { ok: true, failures: [] });

  const ultipro = getRegistrySourceModule("ultipro");
  assert.equal(ultipro.atsKey, "ultipro");
  assert.equal(ultipro.family, SOURCE_FAMILIES.enterpriseDirect);
  assert.equal(ultipro.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof ultipro.discover, "function");
  assert.equal(typeof ultipro.fetchList, "function");
  assert.equal(typeof ultipro.parse, "function");
  assert.equal(typeof ultipro.normalize, "function");
  assert.equal(typeof ultipro.validate, "function");
  assert.deepEqual(validateSourceContract(ultipro), { ok: true, failures: [] });

  const workday = getRegistrySourceModule("workday");
  assert.equal(workday.atsKey, "workday");
  assert.equal(workday.family, SOURCE_FAMILIES.enterpriseDirect);
  assert.equal(workday.status, SOURCE_STATUSES.disabled);
  assert.equal(typeof workday.discover, "function");
  assert.equal(typeof workday.fetchList, "function");
  assert.equal(typeof workday.parse, "function");
  assert.equal(typeof workday.normalize, "function");
  assert.equal(typeof workday.validate, "function");
  assert.deepEqual(validateSourceContract(workday), { ok: true, failures: [] });

  const zoho = getRegistrySourceModule("zoho");
  assert.equal(zoho.atsKey, "zoho");
  assert.equal(zoho.family, SOURCE_FAMILIES.embeddedOrSemiStructured);
  assert.equal(zoho.status, SOURCE_STATUSES.canary);
  assert.equal(typeof zoho.discover, "function");
  assert.equal(typeof zoho.fetchList, "function");
  assert.equal(typeof zoho.parse, "function");
  assert.equal(typeof zoho.normalize, "function");
  assert.equal(typeof zoho.validate, "function");
  assert.deepEqual(validateSourceContract(zoho), { ok: true, failures: [] });
});

test("registry returns typed unsupported module for unknown sources", async () => {
  const unknown = getRegistrySourceModule("notreal");
  assert.equal(unknown.atsKey, "notreal");
  assert.equal(unknown.status, SOURCE_STATUSES.unsupported);
  assert.deepEqual(validateSourceContract(unknown), { ok: true, failures: [] });
  assert.equal((await unknown.fetchList()).ok, false);
});
