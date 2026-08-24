const fs = require("node:fs");
const path = require("node:path");
const { inspectSourceDirectory } = require("../server/ingestion/sourceCertification");

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCES_DIR = path.resolve(REPO_ROOT, "server", "ingestion", "sources");
const PILOT_SOURCES_PATH = path.resolve(REPO_ROOT, "server", "ingestion", "pilotSources.json");
const SOURCE_ALIASES_PATH = path.resolve(REPO_ROOT, "server", "ingestion", "sourceAliases.json");
const ATS_FILTERS_PATH = path.resolve(REPO_ROOT, "server", "ingestion", "atsFilters.js");
const ADAPTER_METADATA_PATH = path.resolve(REPO_ROOT, "server", "ingestion", "adapter-metadata.js");
const LEGACY_GENERATOR_PATH = path.resolve(REPO_ROOT, "scripts", "generate-ats-modules.js");

const EXPECTED_PRE_PRUNE = Object.freeze({ total: 631, noOp: 566, operational: 65 });

function normalizeNewlines(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function assertPathInsideSources(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(SOURCES_DIR, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing source deletion outside a child directory: ${resolved}`);
  }
  return resolved;
}

function listSourceDirectories() {
  return fs.readdirSync(SOURCES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((atsKey) => fs.existsSync(path.join(SOURCES_DIR, atsKey, "index.js")))
    .sort();
}

function inspectSources() {
  const operational = [];
  const noOp = [];
  const noOpReasons = {};

  for (const atsKey of listSourceDirectories()) {
    const inspection = inspectSourceDirectory(path.join(SOURCES_DIR, atsKey));
    if (inspection.noOp) {
      noOp.push(atsKey);
      noOpReasons[atsKey] = inspection.reasons;
    } else {
      operational.push(atsKey);
    }
  }

  return {
    total: operational.length + noOp.length,
    operational,
    noOp,
    noOpReasons
  };
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildArtifacts(operationalKeys) {
  const keep = new Set(operationalKeys);
  const currentPilotSources = loadJson(PILOT_SOURCES_PATH);
  const currentAliases = loadJson(SOURCE_ALIASES_PATH);
  const missingMetadata = operationalKeys.filter((atsKey) => !Object.hasOwn(currentPilotSources, atsKey));
  if (missingMetadata.length > 0) {
    throw new Error(`operational sources missing pilot metadata: ${missingMetadata.join(", ")}`);
  }

  const pilotSources = Object.fromEntries(
    operationalKeys.map((atsKey) => [atsKey, currentPilotSources[atsKey]])
  );
  const sourceAliases = Object.fromEntries(
    Object.entries(currentAliases)
      .filter(([, canonical]) => keep.has(canonical))
      .sort(([left], [right]) => left.localeCompare(right))
  );
  const removedAliases = Object.entries(currentAliases)
    .filter(([, canonical]) => !keep.has(canonical));

  return { pilotSources, sourceAliases, removedAliases };
}

function inspectOperationalArtifacts(operationalKeys) {
  const expected = [...operationalKeys].sort();
  delete require.cache[require.resolve(ATS_FILTERS_PATH)];
  delete require.cache[require.resolve(ADAPTER_METADATA_PATH)];
  const atsFilters = require(ATS_FILTERS_PATH);
  const adapterMetadata = require(ADAPTER_METADATA_PATH);
  const filterKeys = atsFilters.ATS_FILTER_OPTION_ITEMS.map((item) => item.value).sort();
  const metadataKeys = [
    ...adapterMetadata.DIRECT_JSON_STABLE,
    ...adapterMetadata.ENTERPRISE_DIRECT,
    ...adapterMetadata.EMBEDDED_OR_SEMI_STRUCTURED,
    ...adapterMetadata.VENDOR_SPECIFIC,
    ...adapterMetadata.PUBLIC_SECTOR_EDUCATION,
    ...adapterMetadata.BRITTLE_HIGH_RISK
  ].sort();
  const fixtureKeys = Array.from(adapterMetadata.FIXTURE_BACKED).sort();
  const parserFixtureKeys = Array.from(adapterMetadata.PARSER_FIXTURE_BACKED).sort();

  return {
    filterKeysMatch: JSON.stringify(filterKeys) === JSON.stringify(expected),
    metadataKeysMatch: JSON.stringify(metadataKeys) === JSON.stringify(expected),
    fixtureKeysMatch: JSON.stringify(fixtureKeys) === JSON.stringify(expected),
    parserFixtureKeysMatch: JSON.stringify(parserFixtureKeys) === JSON.stringify(expected)
  };
}

function inspectState() {
  const sources = inspectSources();
  const artifacts = buildArtifacts(sources.operational);
  const operationalArtifacts = inspectOperationalArtifacts(sources.operational);
  const currentPilotKeys = Object.keys(loadJson(PILOT_SOURCES_PATH)).sort();
  const expectedPilotKeys = Object.keys(artifacts.pilotSources).sort();
  const pilotMatches = JSON.stringify(currentPilotKeys) === JSON.stringify(expectedPilotKeys);

  return {
    ...sources,
    ...artifacts,
    ...operationalArtifacts,
    pilotMatches,
    legacyGeneratorPresent: fs.existsSync(LEGACY_GENERATOR_PATH)
  };
}


function operationalArtifactsMatch(state) {
  return state.filterKeysMatch
    && state.metadataKeysMatch
    && state.fixtureKeysMatch
    && state.parserFixtureKeysMatch;
}

function assertExpectedPruneState(state) {
  if (
    state.total !== EXPECTED_PRE_PRUNE.total
    || state.noOp.length !== EXPECTED_PRE_PRUNE.noOp
    || state.operational.length !== EXPECTED_PRE_PRUNE.operational
  ) {
    throw new Error(
      `unexpected source inventory; expected ${JSON.stringify(EXPECTED_PRE_PRUNE)}, `
      + `received ${JSON.stringify({ total: state.total, noOp: state.noOp.length, operational: state.operational.length })}`
    );
  }
  if (state.removedAliases.length > 0) {
    throw new Error(`aliases target no-op sources: ${JSON.stringify(state.removedAliases)}`);
  }
  for (const atsKey of state.noOp) {
    assertPathInsideSources(path.join(SOURCES_DIR, atsKey));
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rewriteAtsFilters(operationalKeys) {
  const keep = new Set(operationalKeys);
  delete require.cache[require.resolve(ATS_FILTERS_PATH)];
  const currentOptions = require(ATS_FILTERS_PATH).ATS_FILTER_OPTION_ITEMS;
  const operationalOptions = currentOptions.filter((item) => keep.has(item.value));
  if (operationalOptions.length !== operationalKeys.length) {
    throw new Error(
      `ATS filter labels missing for operational sources; expected ${operationalKeys.length}, received ${operationalOptions.length}`
    );
  }

  const source = normalizeNewlines(fs.readFileSync(ATS_FILTERS_PATH, "utf8"));
  const replacement = `const ATS_FILTER_OPTION_ITEMS = Object.freeze(${JSON.stringify(operationalOptions, null, 2)});\n`;
  const rewritten = source.replace(
    /const ATS_FILTER_OPTION_ITEMS = Object\.freeze\(\[[\s\S]*?\]\);\n(?=const ATS_FILTER_OPTIONS)/,
    replacement
  );
  if (rewritten === source) throw new Error("ATS filter option block was not rewritten");
  fs.writeFileSync(ATS_FILTERS_PATH, rewritten, "utf8");
}

function rewriteAdapterMetadata() {
  const source = normalizeNewlines(fs.readFileSync(ADAPTER_METADATA_PATH, "utf8"));
  const replacement = `const OPERATIONAL_SOURCE_METADATA = Object.freeze(require("./pilotSources.json"));

function sourceKeysForFamily(family) {
  return Object.keys(OPERATIONAL_SOURCE_METADATA)
    .filter((atsKey) => OPERATIONAL_SOURCE_METADATA[atsKey]?.family === family)
    .sort();
}

const DIRECT_JSON_STABLE = Object.freeze(sourceKeysForFamily("direct-json-stable"));
const ENTERPRISE_DIRECT = Object.freeze(sourceKeysForFamily("enterprise-direct"));
const EMBEDDED_OR_SEMI_STRUCTURED = Object.freeze(sourceKeysForFamily("embedded-or-semi-structured"));
const VENDOR_SPECIFIC = Object.freeze(sourceKeysForFamily("vendor-specific"));
const PUBLIC_SECTOR_EDUCATION = Object.freeze(sourceKeysForFamily("public-sector-education"));
const BRITTLE_HIGH_RISK = Object.freeze(sourceKeysForFamily("brittle-high-risk"));
const UNSUPPORTED_ATS = new Set([]);
const DISABLED_BY_DEFAULT_ATS = new Set(["dayforcehcm"]);
const SOURCE_FIXTURE_BACKED_ATS = Object.freeze(Object.keys(OPERATIONAL_SOURCE_METADATA).sort());
const FIXTURE_BACKED = new Set(SOURCE_FIXTURE_BACKED_ATS);
const PARSER_FIXTURE_BACKED = new Set(SOURCE_FIXTURE_BACKED_ATS);

`;
  const rewritten = source.replace(
    /const DIRECT_JSON_STABLE = \[[\s\S]*?const PARSER_FIXTURE_BACKED = new Set\(SOURCE_FIXTURE_BACKED_ATS\);\n\n/,
    replacement
  );
  if (rewritten === source) throw new Error("adapter metadata source lists were not rewritten");
  fs.writeFileSync(ADAPTER_METADATA_PATH, rewritten, "utf8");
}

function syncOperationalArtifacts(operationalKeys) {
  rewriteAtsFilters(operationalKeys);
  rewriteAdapterMetadata();
}

function applyPrune(state) {
  assertExpectedPruneState(state);
  writeJson(PILOT_SOURCES_PATH, state.pilotSources);
  writeJson(SOURCE_ALIASES_PATH, state.sourceAliases);

  for (const atsKey of state.noOp) {
    const sourceDir = assertPathInsideSources(path.join(SOURCES_DIR, atsKey));
    fs.rmSync(sourceDir, { recursive: true, force: false });
  }
  syncOperationalArtifacts(state.operational);
}

function printSummary(mode, state) {
  process.stdout.write(`${JSON.stringify({
    mode,
    total: state.total,
    noOp: state.noOp.length,
    noOpReasons: state.noOpReasons,
    operational: state.operational.length,
    pilotMatches: state.pilotMatches,
    operationalArtifactsMatch: operationalArtifactsMatch(state),
    legacyGeneratorPresent: state.legacyGeneratorPresent,
    removedAliases: state.removedAliases.length,
    operationalKeys: state.operational
  }, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  const mode = argv.includes("--apply")
    ? "apply"
    : argv.includes("--sync-artifacts")
      ? "sync-artifacts"
      : argv.includes("--check")
        ? "check"
        : "plan";
  const state = inspectState();

  if (mode === "sync-artifacts") {
    if (state.noOp.length !== 0 || !state.pilotMatches) {
      throw new Error("source modules and pilot registry must be pruned before syncing artifacts");
    }
    syncOperationalArtifacts(state.operational);
    printSummary(mode, inspectState());
    return;
  }

  if (mode === "apply") {
    applyPrune(state);
    const appliedState = inspectState();
    printSummary(mode, appliedState);
    if (
      appliedState.total !== EXPECTED_PRE_PRUNE.operational
      || appliedState.noOp.length !== 0
      || !appliedState.pilotMatches
      || !operationalArtifactsMatch(appliedState)
      || appliedState.legacyGeneratorPresent
    ) {
      throw new Error("post-prune source inventory does not match the operational registry");
    }
    return;
  }

  printSummary(mode, state);
  if (
    mode === "check"
    && (
      state.noOp.length > 0
      || !state.pilotMatches
      || state.removedAliases.length > 0
      || !operationalArtifactsMatch(state)
      || state.legacyGeneratorPresent
    )
  ) {
    throw new Error("no-op ATS sources remain in the operational registry");
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  EXPECTED_PRE_PRUNE,
  assertPathInsideSources,
  inspectSources,
  inspectState,
  main
};
