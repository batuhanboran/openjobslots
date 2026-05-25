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

test("registry exposes BambooHR, Greenhouse, HRMDirect, and iCIMS as pilot sources", () => {
  assert.equal(isRegistryPilotSource("bamboohr"), true);
  assert.equal(isRegistryPilotSource("greenhouse"), true);
  assert.equal(isRegistryPilotSource("hrmdirect"), true);
  assert.equal(isRegistryPilotSource("icims"), true);
  assert.equal(isRegistryPilotSource("lever"), false);

  const pilotKeys = listRegistrySourceModules().map((item) => item.atsKey).sort();
  assert.deepEqual(pilotKeys, ["bamboohr", "greenhouse", "hrmdirect", "icims"]);
});

test("registry returns contract-valid pilot source modules", () => {
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
