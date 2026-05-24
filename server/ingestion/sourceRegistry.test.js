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

test("registry exposes Greenhouse and iCIMS as pilot sources", () => {
  assert.equal(isRegistryPilotSource("greenhouse"), true);
  assert.equal(isRegistryPilotSource("icims"), true);
  assert.equal(isRegistryPilotSource("lever"), false);

  const pilotKeys = listRegistrySourceModules().map((item) => item.atsKey).sort();
  assert.deepEqual(pilotKeys, ["greenhouse", "icims"]);
});

test("registry returns contract-valid pilot source modules", () => {
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
});

test("registry returns typed unsupported module for unknown sources", async () => {
  const unknown = getRegistrySourceModule("notreal");
  assert.equal(unknown.atsKey, "notreal");
  assert.equal(unknown.status, SOURCE_STATUSES.unsupported);
  assert.deepEqual(validateSourceContract(unknown), { ok: true, failures: [] });
  assert.equal((await unknown.fetchList()).ok, false);
});
