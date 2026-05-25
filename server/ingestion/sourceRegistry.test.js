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

test("registry exposes ApplicantPro, Applitrack, ApplyToJob, Ashby, BambooHR, Breezy, CareerPlug, Fountain, Greenhouse, HRMDirect, iCIMS, Join, Lever, PinpointHQ, RecruitCRM, Recruitee, Rippling, Taleo, and Zoho as pilot sources", () => {
  assert.equal(isRegistryPilotSource("applicantpro"), true);
  assert.equal(isRegistryPilotSource("applitrack"), true);
  assert.equal(isRegistryPilotSource("applytojob"), true);
  assert.equal(isRegistryPilotSource("ashby"), true);
  assert.equal(isRegistryPilotSource("bamboohr"), true);
  assert.equal(isRegistryPilotSource("breezy"), true);
  assert.equal(isRegistryPilotSource("careerplug"), true);
  assert.equal(isRegistryPilotSource("fountain"), true);
  assert.equal(isRegistryPilotSource("greenhouse"), true);
  assert.equal(isRegistryPilotSource("hrmdirect"), true);
  assert.equal(isRegistryPilotSource("icims"), true);
  assert.equal(isRegistryPilotSource("join"), true);
  assert.equal(isRegistryPilotSource("lever"), true);
  assert.equal(isRegistryPilotSource("pinpointhq"), true);
  assert.equal(isRegistryPilotSource("recruitcrm"), true);
  assert.equal(isRegistryPilotSource("recruitee"), true);
  assert.equal(isRegistryPilotSource("rippling"), true);
  assert.equal(isRegistryPilotSource("taleo"), true);
  assert.equal(isRegistryPilotSource("zoho"), true);

  const pilotKeys = listRegistrySourceModules().map((item) => item.atsKey).sort();
  assert.deepEqual(pilotKeys, [
    "applicantpro",
    "applitrack",
    "applytojob",
    "ashby",
    "bamboohr",
    "breezy",
    "careerplug",
    "fountain",
    "greenhouse",
    "hrmdirect",
    "icims",
    "join",
    "lever",
    "pinpointhq",
    "recruitcrm",
    "recruitee",
    "rippling",
    "taleo",
    "zoho"
  ]);
});

test("registry returns contract-valid pilot source modules", () => {
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
