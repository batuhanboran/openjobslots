const fs = require("fs");
const path = require("path");

const {
  BRITTLE_HIGH_RISK,
  DIRECT_JSON_STABLE,
  EMBEDDED_OR_SEMI_STRUCTURED,
  ENTERPRISE_DIRECT,
  FUTURE_DIRECT_SOURCE_CANDIDATES,
  PUBLIC_SECTOR_EDUCATION,
  UNSUPPORTED_ATS,
  VENDOR_SPECIFIC
} = require("../server/ingestion/adapter-metadata");
const { SOURCE_FAMILIES } = require("../server/ingestion/sourceContracts");
const { isRegistryPilotSource } = require("../server/ingestion/sourceRegistry");
const { buildWorkbench } = require("./ats-workbench");

const DEFAULT_OUTPUT_DIR = path.join("docs", "reference", "ats-registry-targets");
const DEFAULT_WORKBENCH_DIR = path.join("docs", "reference", "ats-workbench");

const REQUESTED_FUTURE_ATS_CANDIDATES = Object.freeze([
  { key: "paycomonline", displayName: "PaycomOnline" },
  { key: "agilehr", displayName: "AgileHR" },
  { key: "avature", displayName: "Avature" },
  { key: "comeet", displayName: "Comeet" },
  { key: "factorialhr", displayName: "FactorialHR" },
  { key: "hireology", displayName: "Hireology" },
  { key: "crelate", displayName: "Crelate" },
  { key: "hiringplatform", displayName: "HiringPlatform" },
  { key: "homerun", displayName: "Homerun" },
  { key: "jibeapply", displayName: "JibeApply" },
  { key: "jobs2web", displayName: "Jobs2Web" },
  { key: "occupop", displayName: "Occupop" },
  { key: "peopleadmin", displayName: "PeopleAdmin" },
  { key: "personio", displayName: "Personio" },
  { key: "recruiterflow", displayName: "Recruiterflow" },
  { key: "softgarden", displayName: "Softgarden" },
  { key: "trakstar", displayName: "Trakstar" },
  { key: "ukg", displayName: "UKG" },
  { key: "ycombinator", displayName: "YCombinator" },
  { key: "yello", displayName: "Yello" },
  { key: "edjoin", displayName: "EdJoin" },
  { key: "webcruiter", displayName: "Webcruiter" },
  { key: "academicjobsonline", displayName: "AcademicJobsOnline" },
  { key: "prismhr", displayName: "PrismHR" },
  { key: "silkroad", displayName: "SilkRoad" },
  { key: "paycor", displayName: "Paycor" }
]);

const FAMILY_TARGETS = Object.freeze([
  {
    family: SOURCE_FAMILIES.directJsonStable,
    title: "Direct JSON Stable",
    configured: DIRECT_JSON_STABLE,
    objective: "Move stable public JSON ATS modules onto registry-backed discover/fetch/parse/normalize contracts first.",
    test_script: "node server/ingestion/sources/directSourceModules.test.js",
    next_family_script: "npm.cmd run ats:registry-index -- --family=direct-json-stable --json"
  },
  {
    family: SOURCE_FAMILIES.enterpriseDirect,
    title: "Enterprise Direct",
    configured: ENTERPRISE_DIRECT,
    objective: "Keep tenant/API discovery source-specific, add registry metadata, then canary only fixture-backed enterprise modules.",
    test_script: "node server/ingestion/sources/enterpriseSourceModules.test.js",
    next_family_script: "npm.cmd run ats:registry-index -- --family=enterprise-direct --json"
  },
  {
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    title: "Embedded Or Semi-Structured",
    configured: EMBEDDED_OR_SEMI_STRUCTURED,
    objective: "Split HTML/embed discovery from parsing and keep detail enrichment fixture-backed before registry enablement.",
    test_script: "node server/ingestion/sources/htmlPublicSourceModules.test.js",
    next_family_script: "npm.cmd run ats:registry-index -- --family=embedded-or-semi-structured --json"
  },
  {
    family: SOURCE_FAMILIES.vendorSpecific,
    title: "Vendor Specific",
    configured: VENDOR_SPECIFIC,
    objective: "Stabilize one vendor at a time with source-local fixtures before broad registry dispatch.",
    test_script: "node server/ingestion/sources/directSourceModules.test.js && node server/ingestion/sources/htmlPublicSourceModules.test.js",
    next_family_script: "npm.cmd run ats:registry-index -- --family=vendor-specific --json"
  },
  {
    family: SOURCE_FAMILIES.publicSectorEducation,
    title: "Public Sector And Education",
    configured: PUBLIC_SECTOR_EDUCATION,
    objective: "Move aggregate public-board URLs out of bootstrap into source modules with polite pagination and virtual target tests.",
    test_script: "node server/ingestion/sources/htmlPublicSourceModules.test.js",
    next_family_script: "npm.cmd run ats:registry-index -- --family=public-sector-education --json"
  },
  {
    family: SOURCE_FAMILIES.brittleHighRisk,
    title: "Brittle High Risk",
    configured: BRITTLE_HIGH_RISK,
    objective: "Keep brittle ATS canary-only until fixtures prove stable list/detail parsing and source IDs.",
    test_script: "node server/ingestion/sources/enterpriseSourceModules.test.js",
    next_family_script: "npm.cmd run ats:registry-index -- --family=brittle-high-risk --json"
  },
  {
    family: SOURCE_FAMILIES.futureCandidate,
    title: "Future Candidate",
    configured: [],
    objective: "Track research-only ATS candidates separately so unsupported systems cannot leak into live sync or server/index.js.",
    test_script: "node scripts/ats-registry-index.test.js",
    next_family_script: "npm.cmd run ats:registry-index -- --family=future-candidate --json"
  }
]);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    family: "",
    json: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    workbenchDir: DEFAULT_WORKBENCH_DIR,
    write: true
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--no-write") options.write = false;
    else if (arg.startsWith("--family=")) options.family = arg.slice("--family=".length).trim().toLowerCase();
    else if (arg.startsWith("--output-dir=")) options.outputDir = arg.slice("--output-dir=".length);
    else if (arg.startsWith("--workbench-dir=")) options.workbenchDir = arg.slice("--workbench-dir=".length);
  }
  return options;
}

function uniqueFutureCandidates() {
  const byKey = new Map();
  for (const item of [...FUTURE_DIRECT_SOURCE_CANDIDATES, ...REQUESTED_FUTURE_ATS_CANDIDATES]) {
    const key = String(item.key || "").trim().toLowerCase();
    if (!key) continue;
    byKey.set(key, {
      ats_key: key,
      display_name: String(item.displayName || key).trim(),
      docs_url: String(item.docsUrl || "").trim(),
      endpoint_pattern: String(item.endpointPattern || "").trim(),
      notes: String(item.notes || "research-only candidate; public endpoint and raw fixtures required before enabling").trim()
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.ats_key.localeCompare(b.ats_key));
}

function findFamilyForAts(atsKey) {
  const key = String(atsKey || "").trim().toLowerCase();
  const family = FAMILY_TARGETS.find((item) => item.configured.includes(key));
  return family?.family || SOURCE_FAMILIES.futureCandidate;
}

function sourceTestScript(family) {
  return FAMILY_TARGETS.find((item) => item.family === family)?.test_script || "npm.cmd run test:backend";
}

function registryStatusFor(source) {
  const atsKey = String(source.ats_key || "").trim().toLowerCase();
  if (UNSUPPORTED_ATS.has(atsKey) || source.current_status === "unsupported") return "unsupported";
  if (isRegistryPilotSource(atsKey)) return "pilot-enabled";
  if (source.source_module?.present) return "module-ready";
  return "needs-source-module";
}

function scriptsForTarget(atsKey, family, future = false) {
  if (future) {
    return {
      workbench: "not available until configured as an ATS adapter",
      source_test: "not available until source module exists",
      dry_run: "not available until adapter and source target exist",
      registry_check: "node scripts/ats-registry-index.test.js"
    };
  }
  return {
    workbench: `npm.cmd run ats:workbench -- --source=${atsKey} --json`,
    source_test: sourceTestScript(family),
    dry_run: `npm.cmd run ats:source:dry-run -- --source=${atsKey} --limit=10 --json`,
    registry_check: "node server/ingestion/sourceRegistry.test.js"
  };
}

function nextActionFor(source, family, registryStatus) {
  if (registryStatus === "pilot-enabled") {
    return "Keep registry dispatch enabled; use this ATS as the contract reference while expanding the family.";
  }
  if (registryStatus === "unsupported") {
    return "Do not run live sync; add raw fixtures, parser certification, and source module before registry enablement.";
  }
  if (registryStatus === "module-ready") {
    return "Add registry metadata, run focused source tests, then route this ATS through registry dispatch canary.";
  }
  if (family === SOURCE_FAMILIES.publicSectorEducation) {
    return "Create source-local discover/fetchList/parse fixtures and move bootstrap dynamic URL logic out of server/index.js.";
  }
  return "Create source-local discover/fetchList/parse/normalize/validate fixtures before registry dispatch.";
}

function configuredTargetFromSource(source) {
  const atsKey = String(source.ats_key || "").trim().toLowerCase();
  const family = findFamilyForAts(atsKey);
  const registryStatus = registryStatusFor(source);
  return {
    ats_key: atsKey,
    display_name: source.display_name || atsKey,
    family,
    registry_status: registryStatus,
    current_status: source.current_status,
    public_enabled: Boolean(source.public_enabled),
    source_module: {
      present: Boolean(source.source_module?.present),
      path: source.source_module?.path || "",
      fixtures_dir: source.source_module?.fixtures_dir || ""
    },
    quality: source.production_quality || {},
    scripts: scriptsForTarget(atsKey, family),
    next_action: nextActionFor(source, family, registryStatus),
    work_packet: `docs/reference/ats-workbench/sources/${atsKey}.json`
  };
}

function futureTargetFromCandidate(candidate) {
  return {
    ats_key: candidate.ats_key,
    display_name: candidate.display_name,
    family: SOURCE_FAMILIES.futureCandidate,
    registry_status: "research-only",
    current_status: "future-candidate",
    public_enabled: false,
    source_module: {
      present: false,
      path: "",
      fixtures_dir: ""
    },
    quality: {},
    scripts: scriptsForTarget(candidate.ats_key, SOURCE_FAMILIES.futureCandidate, true),
    next_action: "Research public endpoint, capture raw fixture, define parser contract, then add adapter metadata.",
    work_packet: "",
    docs_url: candidate.docs_url,
    endpoint_pattern: candidate.endpoint_pattern,
    notes: candidate.notes
  };
}

function buildFamilies(targets) {
  return FAMILY_TARGETS.map((family) => ({
    family: family.family,
    title: family.title,
    objective: family.objective,
    test_script: family.test_script,
    next_family_script: family.next_family_script,
    targets: targets
      .filter((target) => target.family === family.family)
      .sort((a, b) => {
        const statusOrder = {
          "pilot-enabled": 0,
          "module-ready": 1,
          "needs-source-module": 2,
          unsupported: 3,
          "research-only": 4
        };
        return Number(statusOrder[a.registry_status] ?? 9) - Number(statusOrder[b.registry_status] ?? 9) ||
          a.ats_key.localeCompare(b.ats_key);
      })
      .map((target) => ({
        ats_key: target.ats_key,
        registry_status: target.registry_status,
        source_module: target.source_module.path || "",
        next_action: target.next_action
      }))
  }));
}

function buildSummary(targets) {
  const counts = {};
  const familyCounts = {};
  for (const target of targets) {
    counts[target.registry_status] = Number(counts[target.registry_status] || 0) + 1;
    familyCounts[target.family] = Number(familyCounts[target.family] || 0) + 1;
  }
  return {
    configured_ats_count: targets.filter((target) => target.current_status !== "future-candidate").length,
    future_candidate_count: targets.filter((target) => target.current_status === "future-candidate").length,
    registry_status_counts: counts,
    family_counts: familyCounts,
    next_execution_order: [
      "greenhouse and icims stay as pilot references",
      "direct-json-stable module-ready sources",
      "enterprise-direct fixture-backed sources",
      "embedded-or-semi-structured high-volume debt sources",
      "public-sector-education dynamic sources",
      "brittle-high-risk canary-only sources",
      "future-candidate research packets"
    ]
  };
}

function buildRegistryIndex(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const workbench = buildWorkbench({
    source: "",
    json: true,
    outputDir: options.workbenchDir || DEFAULT_WORKBENCH_DIR,
    scoreboardPath: path.join(options.workbenchDir || DEFAULT_WORKBENCH_DIR, "scoreboard.json"),
    write: false
  });
  const configuredTargets = workbench.sources.map(configuredTargetFromSource);
  const configuredKeys = new Set(configuredTargets.map((target) => target.ats_key));
  const futureTargets = uniqueFutureCandidates()
    .filter((candidate) => !configuredKeys.has(candidate.ats_key))
    .map(futureTargetFromCandidate);
  const targets = [...configuredTargets, ...futureTargets].sort((a, b) => a.ats_key.localeCompare(b.ats_key));
  const filteredTargets = options.family
    ? targets.filter((target) => target.family === options.family)
    : targets;
  return {
    ok: true,
    generated_at: generatedAt,
    summary: buildSummary(targets),
    families: buildFamilies(targets),
    targets: filteredTargets
  };
}

function markdownForTarget(target) {
  return [
    `| \`${target.ats_key}\` | ${target.registry_status} | ${target.source_module.path ? `\`${target.source_module.path}\`` : ""} | ${target.next_action} | \`${target.scripts.workbench}\` |`
  ].join("");
}

function toMarkdown(payload) {
  const lines = [
    "# ATS Registry Targets",
    "",
    "Generated by `npm.cmd run ats:registry-index`.",
    "",
    `- Configured ATS: ${payload.summary.configured_ats_count}`,
    `- Future candidates: ${payload.summary.future_candidate_count}`,
    `- Registry status counts: ${JSON.stringify(payload.summary.registry_status_counts)}`,
    "",
    "## Execution Order",
    "",
    ...payload.summary.next_execution_order.map((item, index) => `${index + 1}. ${item}`),
    ""
  ];

  for (const family of payload.families) {
    const targets = payload.targets.filter((target) => target.family === family.family);
    if (targets.length === 0) continue;
    lines.push(`## ${family.title}`, "");
    lines.push(family.objective, "");
    lines.push(`Family script: \`${family.next_family_script}\``);
    lines.push(`Test script: \`${family.test_script}\``, "");
    lines.push("| ATS | Registry status | Source module | Next action | Workbench script |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const target of targets) lines.push(markdownForTarget(target));
    lines.push("");
  }

  while (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function writeRegistryIndex(payload, options) {
  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "index.json"), `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "index.md"), toMarkdown(payload));
}

function main() {
  const options = parseArgs();
  const payload = buildRegistryIndex(options);
  if (options.write) writeRegistryIndex(payload, options);
  if (options.json || options.family) {
    process.stdout.write(`${JSON.stringify(options.family ? payload.targets : payload.summary, null, 2)}\n`);
  } else {
    process.stdout.write(`Generated ATS registry target index for ${payload.targets.length} target(s) in ${options.outputDir}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  buildFamilies,
  buildRegistryIndex,
  parseArgs,
  toMarkdown,
  uniqueFutureCandidates
};
