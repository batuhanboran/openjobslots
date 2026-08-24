const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function normalizeNewlines(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function readJsonIfPresent(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { present: false, value: null, error: null };
  try {
    return { present: true, value: JSON.parse(fs.readFileSync(filePath, "utf8")), error: null };
  } catch (error) {
    return { present: true, value: null, error: String(error?.message || error) };
  }
}

function resolveFixturePath(fixturePath, repoRoot = REPO_ROOT) {
  const value = String(fixturePath || "").trim();
  if (!value) return "";
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(repoRoot, value);
}

function fixtureRowCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;
  for (const key of ["rows", "jobs", "items", "postings", "results"]) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  return 0;
}

function invalidCaseCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && Array.isArray(value.cases)) return value.cases.length;
  return 0;
}

function inspectSourceDirectory(sourceDir) {
  const reasons = [];
  const resolved = path.resolve(sourceDir);
  const jsFiles = fs.existsSync(resolved)
    ? fs.readdirSync(resolved, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => path.join(resolved, entry.name))
    : [];
  const sources = new Map(jsFiles.map((filePath) => [
    path.basename(filePath),
    normalizeNewlines(fs.readFileSync(filePath, "utf8"))
  ]));
  const fetchSource = sources.get("fetchList.js") || sources.get("index.js") || "";
  const fetchReturnsEmpty = (
    /fetchList\s*:\s*async\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*\[\s*\]/s.test(fetchSource)
    || /async\s+function\s+fetchList\s*\([^)]*\)\s*\{[\s\S]*?return\s+\[\s*\]\s*;?[\s\S]*?\}/.test(fetchSource)
    || (/fetchList\.js$/i.test(jsFiles.find((filePath) => path.basename(filePath) === "fetchList.js") || "")
      && /module\.exports\s*=\s*async\s+function[^\{]*\{[\s\S]*?return\s+\[\s*\]/.test(fetchSource))
  );
  if (fetchReturnsEmpty) reasons.push("fetchList is guaranteed to return an empty array");

  const expectedPath = path.join(resolved, "fixtures", "expected-normalized.json");
  const expected = readJsonIfPresent(expectedPath);
  const expectedEmpty = expected.present && !expected.error && fixtureRowCount(expected.value) === 0;
  if (expectedEmpty) reasons.push("expected-normalized fixture has no rows");

  const invalidPath = path.join(resolved, "fixtures", "invalid-shapes.json");
  const invalid = readJsonIfPresent(invalidPath);
  const invalidEmpty = invalid.present && !invalid.error && invalidCaseCount(invalid.value) === 0;
  if (invalidEmpty) reasons.push("invalid-shapes fixture has no cases");

  const normalizeSource = sources.get("normalize.js") || sources.get("index.js") || "";
  if (/Unknown Title|source_job_id[^\n]*\|\|\s*["']unknown["']/.test(normalizeSource)) {
    reasons.push("normalizer emits placeholder identity fields");
  }

  const validateSource = sources.get("validate.js") || sources.get("index.js") || "";
  if (/validate\s*:\s*\(?.*?\)?\s*=>\s*\(\{\s*ok\s*:\s*true\s*\}\)/s.test(validateSource)) {
    reasons.push("validator unconditionally accepts every row");
  }

  return {
    noOp: fetchReturnsEmpty && expectedEmpty,
    reasons,
    sourceDir: resolved
  };
}

function inspectCertificationEvidence(sourceModule = {}, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const blockers = [];
  let fixturePaths = [];
  try {
    fixturePaths = typeof sourceModule.fixtures === "function" ? sourceModule.fixtures() : [];
  } catch (error) {
    blockers.push(`fixtures failed: ${String(error?.message || error)}`);
  }
  if (!Array.isArray(fixturePaths)) {
    blockers.push("fixtures did not return an array");
    fixturePaths = [];
  }

  const resolvedPaths = fixturePaths.map((fixturePath) => resolveFixturePath(fixturePath, repoRoot));
  const byName = new Map(resolvedPaths.map((fixturePath) => [path.basename(fixturePath), fixturePath]));
  const expected = readJsonIfPresent(byName.get("expected-normalized.json"));
  const invalid = readJsonIfPresent(byName.get("invalid-shapes.json"));

  if (!expected.present) blockers.push("expected-normalized fixture is missing");
  else if (expected.error) blockers.push(`expected-normalized fixture is invalid JSON: ${expected.error}`);
  else if (fixtureRowCount(expected.value) === 0) blockers.push("expected-normalized fixture must contain at least one row");

  if (!invalid.present) blockers.push("invalid-shapes fixture is missing");
  else if (invalid.error) blockers.push(`invalid-shapes fixture is invalid JSON: ${invalid.error}`);
  else if (invalidCaseCount(invalid.value) === 0) blockers.push("invalid-shapes fixture must contain at least one case");

  const firstFixture = resolvedPaths.find(Boolean);
  const sourceDir = firstFixture ? path.dirname(path.dirname(firstFixture)) : "";
  const staticInspection = sourceDir && fs.existsSync(sourceDir)
    ? inspectSourceDirectory(sourceDir)
    : { noOp: false, reasons: [], sourceDir };
  if (staticInspection.noOp) blockers.push("collector is a semantic no-op");

  return {
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
    fixturePaths: resolvedPaths,
    staticInspection
  };
}

module.exports = {
  inspectCertificationEvidence,
  inspectSourceDirectory,
  invalidCaseCount,
  fixtureRowCount,
  resolveFixturePath
};
