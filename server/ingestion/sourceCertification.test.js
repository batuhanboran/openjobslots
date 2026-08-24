const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  inspectCertificationEvidence,
  inspectSourceDirectory
} = require("./sourceCertification");

function writeFixture(root, relativePath, value) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

test("split-file empty fetch collectors are semantic no-ops", (t) => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "ojs-source-cert-"));
  t.after(() => fs.rmSync(sourceDir, { recursive: true, force: true }));
  writeFixture(sourceDir, "index.js", 'const { fetchList } = require("./fetchList"); module.exports = { fetchList };\n');
  writeFixture(sourceDir, "fetchList.js", "module.exports = { fetchList: async () => [] };\n");
  writeFixture(sourceDir, "fixtures/expected-normalized.json", []);
  writeFixture(sourceDir, "fixtures/invalid-shapes.json", { cases: [] });

  const result = inspectSourceDirectory(sourceDir);
  assert.equal(result.noOp, true);
  assert.ok(result.reasons.includes("fetchList is guaranteed to return an empty array"));
  assert.ok(result.reasons.includes("expected-normalized fixture has no rows"));
  assert.ok(result.reasons.includes("invalid-shapes fixture has no cases"));
});

test("certification requires positive and negative parser evidence", (t) => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "ojs-source-cert-"));
  t.after(() => fs.rmSync(sourceDir, { recursive: true, force: true }));
  const expected = writeFixture(sourceDir, "fixtures/expected-normalized.json", []);
  const invalid = writeFixture(sourceDir, "fixtures/invalid-shapes.json", { cases: [] });
  const list = writeFixture(sourceDir, "fixtures/list.json", { jobs: [] });
  writeFixture(sourceDir, "fetchList.js", "module.exports = { fetchList: async () => [] };\n");

  const result = inspectCertificationEvidence({
    fixtures: () => [list, expected, invalid]
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("expected-normalized fixture must contain at least one row"));
  assert.ok(result.blockers.includes("invalid-shapes fixture must contain at least one case"));
  assert.ok(result.blockers.includes("collector is a semantic no-op"));
});

test("certification accepts non-empty positive and negative fixtures", (t) => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "ojs-source-cert-"));
  t.after(() => fs.rmSync(sourceDir, { recursive: true, force: true }));
  const expected = writeFixture(sourceDir, "fixtures/expected-normalized.json", [{ title: "Engineer" }]);
  const invalid = writeFixture(sourceDir, "fixtures/invalid-shapes.json", { cases: [{ input: null }] });
  const list = writeFixture(sourceDir, "fixtures/list.json", { jobs: [{ id: "1" }] });
  writeFixture(sourceDir, "fetchList.js", "module.exports = { fetchList: async () => ({ jobs: [] }) };\n");

  const result = inspectCertificationEvidence({
    fixtures: () => [list, expected, invalid]
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
});
