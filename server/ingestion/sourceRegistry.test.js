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

test("registry exposes ApplicantPro, ApplyToJob, Ashby, BambooHR, Breezy, CareerPlug, Greenhouse, HRMDirect, and iCIMS as pilot sources", () => {
  assert.equal(isRegistryPilotSource("applicantpro"), true);
  assert.equal(isRegistryPilotSource("applytojob"), true);
  assert.equal(isRegistryPilotSource("ashby"), true);
  assert.equal(isRegistryPilotSource("bamboohr"), true);
  assert.equal(isRegistryPilotSource("breezy"), true);
  assert.equal(isRegistryPilotSource("careerplug"), true);
  assert.equal(isRegistryPilotSource("greenhouse"), true);
  assert.equal(isRegistryPilotSource("hrmdirect"), true);
  assert.equal(isRegistryPilotSource("icims"), true);
  assert.equal(isRegistryPilotSource("lever"), false);

  const pilotKeys = listRegistrySourceModules().map((item) => item.atsKey).sort();
  assert.deepEqual(pilotKeys, [
    "applicantpro",
    "applytojob",
    "ashby",
    "bamboohr",
    "breezy",
    "careerplug",
    "greenhouse",
    "hrmdirect",
    "icims"
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
});

test("registry returns typed unsupported module for unknown sources", async () => {
  const unknown = getRegistrySourceModule("notreal");
  assert.equal(unknown.atsKey, "notreal");
  assert.equal(unknown.status, SOURCE_STATUSES.unsupported);
  assert.deepEqual(validateSourceContract(unknown), { ok: true, failures: [] });
  assert.equal((await unknown.fetchList()).ok, false);
});
