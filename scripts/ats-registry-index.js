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
const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  validateSourceRecoveryContract
} = require("../server/ingestion/sourceContracts");
const {
  getRegistrySourceModule,
  isRegistryPilotSource
} = require("../server/ingestion/sourceRegistry");
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
  const configuredKeys = new Set(FAMILY_TARGETS.flatMap((item) => item.configured));
  for (const item of [...FUTURE_DIRECT_SOURCE_CANDIDATES, ...REQUESTED_FUTURE_ATS_CANDIDATES]) {
    const key = String(item.key || "").trim().toLowerCase();
    if (!key) continue;
    if (configuredKeys.has(key)) continue;
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

function sourceModuleStatus(atsKey) {
  if (!isRegistryPilotSource(atsKey)) return "";
  return getRegistrySourceModule(atsKey)?.status || "";
}

function sourceOperationSafetyArgs() {
  return [
    "--confirm-production",
    "--backup-confirmed",
    "--worker-isolated",
    "--planned-batch=<planned_batch_report>",
    "--preflight-report=<fresh_preflight_report>",
    "--preflight-max-age-minutes=60",
    "--predicted-guard-result=pass"
  ].join(" ");
}

function registryStatusFor(source) {
  const atsKey = String(source.ats_key || "").trim().toLowerCase();
  if (UNSUPPORTED_ATS.has(atsKey) || source.current_status === "unsupported") return "unsupported";
  if (isRegistryPilotSource(atsKey)) {
    const status = sourceModuleStatus(atsKey);
    if (status === SOURCE_STATUSES.unsupported) return "unsupported";
    if (status === SOURCE_STATUSES.enabled) return "registry-backed-enabled";
    if (status === SOURCE_STATUSES.canary) return "registry-backed-canary";
    if (status === SOURCE_STATUSES.quarantine) return "registry-backed-quarantine";
    if (status === SOURCE_STATUSES.disabled) return "registry-backed-disabled";
    return "registry-backed";
  }
  if (source.source_module?.present) return "module-ready";
  return "needs-source-module";
}

function scriptsForTarget(atsKey, family, future = false) {
  if (future) {
    return {
      workbench: "not available until configured as an ATS adapter",
      source_test: "not available until source module exists",
      dry_run: "not available until adapter and source target exist",
      inventory_scan: "not available until adapter and source target exist",
      estimate_net_new: "not available until adapter and source target exist",
      plan_batches: "not available until adapter and source target exist",
      source_canary: "not available until adapter and source target exist",
      source_apply: "not available until adapter and source target exist and canary/release proof passes",
      recovery_preflight: "not available until adapter and source target exist",
      recovery_guard: "not available until adapter and source target exist",
      release_check: "not available until recovery guard reports exist",
      parity_check: "npm.cmd run search:reindex:check -- --json --sample-limit=25",
      registry_check: "node scripts/ats-registry-index.test.js"
    };
  }
  return {
    workbench: `npm.cmd run ats:workbench -- --source=${atsKey} --json`,
    source_test: sourceTestScript(family),
    dry_run: `npm.cmd run ats:source:dry-run -- --source=${atsKey} --limit=10 --json`,
    inventory_scan: `npm.cmd run ats:inventory:scan -- --source=${atsKey} --company-limit=<safe_limit> --row-limit=<safe_row_limit> --json --output=<report>`,
    estimate_net_new: `npm.cmd run ats:estimate-net-new -- --source=${atsKey} --limit=<safe_limit> --company-limit=<safe_company_limit> --json`,
    plan_batches: `npm.cmd run ats:plan-batches -- --source=${atsKey} --target-gain=<gain> --company-limit=<safe_limit> --row-limit=<safe_row_limit> --json --output=<report>`,
    source_canary: `npm.cmd run ats:source:canary -- --source=${atsKey} --limit=<safe_limit> ${sourceOperationSafetyArgs()} --json --output=<source_report>`,
    source_apply: `npm.cmd run ats:source:apply -- --source=${atsKey} --limit=<safe_limit> --max-updates=<safe_max_updates> ${sourceOperationSafetyArgs()} --json --output=<source_report>`,
    recovery_preflight: "npm.cmd run ats:recovery:preflight -- --json --system-report=<system_report> --expected-commit=<sha> --backup-path=<backup> --output=<fresh_preflight_report>",
    recovery_guard: "npm.cmd run ats:recovery:guard -- --json --before=<before_data_quality> --after=<after_data_quality> --source-report=<source_report> --meili-check=<meili_check> --ingestion-status=<ingestion_status> --service-stats=<service_stats> --output=<guard_report>",
    release_check: "npm.cmd run release:ats-recovery:check -- --json --before=<before_data_quality> --after=<after_data_quality> --source-report=<source_report> --meili-check=<meili_check> --guard-report=<guard_report> --tests-report=<tests_report> --preflight-report=<fresh_preflight_report> --output=<release_report>",
    parity_check: "npm.cmd run search:reindex:check -- --json --sample-limit=25",
    registry_check: "node server/ingestion/sourceRegistry.test.js"
  };
}

function fixtureEvidence(sourceModule) {
  const result = {
    paths: [],
    present: [],
    missing: [],
    errors: []
  };
  if (typeof sourceModule?.fixtures !== "function") return result;
  try {
    result.paths = sourceModule.fixtures();
  } catch (error) {
    result.errors.push(String(error?.message || error));
  }
  if (!Array.isArray(result.paths)) {
    result.errors.push("fixtures did not return an array");
    result.paths = [];
  }
  for (const fixturePath of result.paths) {
    const normalizedPath = String(fixturePath || "").replace(/\\/g, "/");
    if (!normalizedPath) continue;
    if (fs.existsSync(path.resolve(normalizedPath))) result.present.push(normalizedPath);
    else result.missing.push(normalizedPath);
  }
  return result;
}

function recoveryReadinessForTarget(atsKey, registryStatus, future = false) {
  if (future) {
    return {
      status: "research-only",
      source_contract_ok: false,
      public_gate: false,
      quality_threshold: false,
      rate_limit: false,
      fixtures: { paths: [], present: [], missing: [], errors: [] },
      blockers: ["adapter metadata and source module required before recovery"],
      required_gate_sequence: []
    };
  }

  const sourceModule = isRegistryPilotSource(atsKey) ? getRegistrySourceModule(atsKey) : null;
  if (!sourceModule) {
    return {
      status: "blocked-no-source-module",
      source_contract_ok: false,
      public_gate: false,
      quality_threshold: false,
      rate_limit: false,
      fixtures: { paths: [], present: [], missing: [], errors: [] },
      blockers: ["source module required before recovery"],
      required_gate_sequence: []
    };
  }

  const recoveryContract = validateSourceRecoveryContract(sourceModule);
  const fixtures = fixtureEvidence(sourceModule);
  const blockers = [...recoveryContract.failures, ...fixtures.errors];
  if (fixtures.missing.length > 0) blockers.push(`missing fixture files: ${fixtures.missing.join(", ")}`);
  if (registryStatus === "unsupported") blockers.push("unsupported source");

  return {
    status: blockers.length === 0 ? "ready-for-read-only-recovery" : "blocked",
    source_contract_ok: recoveryContract.ok,
    public_gate: typeof sourceModule.validatePublic === "function",
    quality_threshold: typeof sourceModule.qualityThreshold === "function",
    rate_limit: typeof sourceModule.rateLimit === "function",
    fixtures,
    blockers,
    production_write_policy: "canary/apply/backfill/reindex/deploy require explicit approval, backup, worker isolation, recovery guard, and parity proof",
    required_gate_sequence: [
      "source_test",
      "workbench",
      "dry_run",
      "inventory_scan",
      "estimate_net_new",
      "plan_batches",
      "recovery_preflight",
      "source_canary_or_apply_after_explicit_approval",
      "recovery_guard",
      "parity_check",
      "release_check"
    ]
  };
}

function nextActionFor(source, family, registryStatus) {
  if (registryStatus === "registry-backed-enabled") {
    return "Keep registry dispatch enabled; use read-only inventory, net-new estimate, batch planning, recovery guard, and parity checks before any approved write.";
  }
  if (registryStatus === "registry-backed-canary" || registryStatus === "registry-backed-quarantine") {
    return "Keep recovery canary/quarantine-scoped; prove clean net-new candidates with read-only inventory and batch planning before requesting writes.";
  }
  if (registryStatus === "registry-backed-disabled") {
    return "Keep disabled until bounded live canary and source-quality evidence are approved; use read-only workbench and inventory first.";
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
  const scripts = scriptsForTarget(atsKey, family);
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
    scripts,
    recovery_readiness: recoveryReadinessForTarget(atsKey, registryStatus),
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
    recovery_readiness: recoveryReadinessForTarget(candidate.ats_key, "research-only", true),
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
          "registry-backed-enabled": 0,
          "registry-backed-canary": 1,
          "registry-backed-quarantine": 2,
          "registry-backed-disabled": 3,
          "module-ready": 4,
          "needs-source-module": 5,
          unsupported: 6,
          "research-only": 7
        };
        return Number(statusOrder[a.registry_status] ?? 9) - Number(statusOrder[b.registry_status] ?? 9) ||
          a.ats_key.localeCompare(b.ats_key);
      })
      .map((target) => ({
        ats_key: target.ats_key,
        registry_status: target.registry_status,
        recovery_readiness: target.recovery_readiness.status,
        source_module: target.source_module.path || "",
        next_action: target.next_action
      }))
  }));
}

function buildSummary(targets) {
  const counts = {};
  const familyCounts = {};
  const readinessCounts = {};
  for (const target of targets) {
    counts[target.registry_status] = Number(counts[target.registry_status] || 0) + 1;
    familyCounts[target.family] = Number(familyCounts[target.family] || 0) + 1;
    readinessCounts[target.recovery_readiness?.status || "unknown"] = Number(readinessCounts[target.recovery_readiness?.status || "unknown"] || 0) + 1;
  }
  const configuredTargets = targets.filter((target) => target.current_status !== "future-candidate");
  return {
    configured_ats_count: configuredTargets.length,
    future_candidate_count: targets.filter((target) => target.current_status === "future-candidate").length,
    registry_status_counts: counts,
    recovery_readiness_counts: readinessCounts,
    read_only_recovery_ready_count: configuredTargets.filter((target) => target.recovery_readiness?.status === "ready-for-read-only-recovery").length,
    recovery_readiness_blockers: configuredTargets
      .filter((target) => target.recovery_readiness?.status !== "ready-for-read-only-recovery")
      .map((target) => ({
        ats_key: target.ats_key,
        registry_status: target.registry_status,
        status: target.recovery_readiness?.status || "unknown",
        blockers: target.recovery_readiness?.blockers || []
      })),
    family_counts: familyCounts,
    next_execution_order: [
      "registry-backed enabled sources with ready recovery contracts",
      "registry-backed canary or quarantine sources with read-only inventory first",
      "registry-backed disabled sources after fixture and canary evidence",
      "sources blocked by missing parser certification after source-backed fixtures exist",
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
    `| \`${target.ats_key}\` | ${target.registry_status} | ${target.recovery_readiness.status} | ${target.source_module.path ? `\`${target.source_module.path}\`` : ""} | ${target.next_action} | \`${target.scripts.workbench}\` |`
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
    `- Recovery readiness counts: ${JSON.stringify(payload.summary.recovery_readiness_counts)}`,
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
    lines.push("| ATS | Registry status | Recovery readiness | Source module | Next action | Workbench script |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
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
