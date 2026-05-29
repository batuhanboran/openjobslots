const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAP_PATH = path.join("docs", "reference", "ats-external-method-map.json");

const REPOSITORIES = [
  {
    name: "firecrawl/firecrawl",
    url: "https://github.com/firecrawl/firecrawl",
    stars_observed: 125891,
    license: "AGPL-3.0",
    integration_role: "evidence-provider",
    boundary: "Detail markdown and extracted text are evidence only; deterministic source fixtures and parsers remain truth."
  },
  {
    name: "unclecode/crawl4ai",
    url: "https://github.com/unclecode/crawl4ai",
    stars_observed: 67146,
    license: "Apache-2.0",
    integration_role: "evidence-provider",
    boundary: "Self-hosted crawler output can guide parser work, but cannot populate public fields directly."
  },
  {
    name: "scrapy/scrapy",
    url: "https://github.com/scrapy/scrapy",
    stars_observed: 61960,
    license: "BSD-3-Clause",
    integration_role: "crawler-reference",
    boundary: "Useful crawler architecture reference; Python stack is not the default OpenJobSlots runtime path."
  },
  {
    name: "ScrapeGraphAI/Scrapegraph-ai",
    url: "https://github.com/ScrapeGraphAI/Scrapegraph-ai",
    stars_observed: 26396,
    license: "MIT",
    integration_role: "ai-extraction-reference",
    boundary: "AI extraction is research evidence only because OpenJobSlots must preserve evidence-vs-truth separation."
  },
  {
    name: "apify/crawlee",
    url: "https://github.com/apify/crawlee",
    stars_observed: 23542,
    license: "Apache-2.0",
    integration_role: "rendered-fetch-sidecar",
    boundary: "Best fit for an optional Node-side rendered/detail fetch path behind source caps and fixtures."
  },
  {
    name: "lorien/awesome-web-scraping",
    url: "https://github.com/lorien/awesome-web-scraping",
    stars_observed: 7914,
    license: "NOASSERTION",
    integration_role: "tool-index",
    boundary: "Research catalog only; tools still need license, safety, and fixture-backed review before use."
  },
  {
    name: "kalil0321/ats-scrapers",
    url: "https://github.com/kalil0321/ats-scrapers",
    stars_observed: 58,
    license: "MIT",
    integration_role: "ats-method-reference",
    boundary: "Provider methods are useful research; do not vendor code without license and correctness review."
  }
];

const PHASES = [
  {
    id: "phase_1",
    name: "research-to-backlog-map",
    goal: "Convert external scraper and ATS method research into repo-local targets that preserve the existing source-module contract."
  },
  {
    id: "phase_2",
    name: "method-profile-and-experiment-runner",
    goal: "Expose source method profiles and make read-only method experiments work beyond the current narrow source allowlist."
  },
  {
    id: "phase_3",
    name: "pilot-source-hardening",
    goal: "Apply the method map to the first high-value existing and expansion ATS lanes with raw fixtures and quality gates."
  },
  {
    id: "phase_4",
    name: "external-evidence-provider-sidecar",
    goal: "Add optional rendered or markdown evidence providers only after deterministic parser truth remains enforced."
  }
];

const TARGETS = [
  {
    ats_key: "teamtailor",
    target_type: "existing-source-method-repair",
    internal_source_module: "server/ingestion/sources/teamtailor",
    external_refs: ["kalil0321/ats-scrapers:teamtailor.py"],
    current_gap: "Repo certification notes still call for stable raw source certification beyond brittle HTML card parsing.",
    recommended_action: "Research a stable endpoint or fixture-backed HTML method, then add source method profile and raw/expected/invalid fixtures.",
    phases: ["phase_1", "phase_2", "phase_3"],
    priority: 1
  },
  {
    ats_key: "icims",
    target_type: "existing-detail-evidence-repair",
    internal_source_module: "server/ingestion/sources/icims",
    external_refs: ["kalil0321/ats-scrapers:icims.py"],
    current_gap: "Large live field-gap source where list pages often need bounded detail evidence.",
    recommended_action: "Use method profiles to compare list, paged iframe, and bounded detail fetch evidence without weakening parser gates.",
    phases: ["phase_1", "phase_2", "phase_3"],
    priority: 2
  },
  {
    ats_key: "applitrack",
    target_type: "existing-detail-evidence-repair",
    internal_source_module: "server/ingestion/sources/applitrack",
    external_refs: ["lorien/awesome-web-scraping:browser-rendering-tools"],
    current_gap: "Certified but high live geo/remote gaps; repair requires polite detail-page evidence, not generic scraping.",
    recommended_action: "Profile Output.asp list fetch versus bounded detail fetches and keep detail output as fixture-backed parser evidence.",
    phases: ["phase_1", "phase_2", "phase_3"],
    priority: 3
  },
  {
    ats_key: "personio",
    target_type: "expansion-candidate",
    internal_source_module: "",
    external_refs: ["kalil0321/ats-scrapers:personio.py", "Personio XML feed"],
    current_gap: "Not configured in this repo, but existing docs already identify it as a Wave 1 expansion candidate.",
    recommended_action: "Add a new source only after endpoint review for the public XML feed, raw XML fixture, expected normalized fixture, and invalid-shape fixture.",
    phases: ["phase_1", "phase_3"],
    priority: 4
  },
  {
    ats_key: "recruiterbox",
    target_type: "expansion-candidate",
    internal_source_module: "",
    external_refs: ["kalil0321/ats-scrapers:recruiterbox.py", "Trakstar Hire frontend API"],
    current_gap: "Not configured; repo docs list Trakstar Hire / Recruiterbox as a Wave 1 candidate.",
    recommended_action: "Review public frontend openings API, define tenant discovery, then certify source ids, canonical URLs, geo, date, and remote behavior.",
    phases: ["phase_1", "phase_3"],
    priority: 5
  },
  {
    ats_key: "workable",
    target_type: "expansion-candidate",
    internal_source_module: "",
    external_refs: ["kalil0321/ats-scrapers:workable.py"],
    current_gap: "Not configured; repo docs list Workable as a Wave 2 candidate because public token/config handling needs review.",
    recommended_action: "Do not implement until public widget/API token handling is documented and fixture-backed.",
    phases: ["phase_1", "phase_3"],
    priority: 6
  },
  {
    ats_key: "successfactors",
    target_type: "existing-alias-method-review",
    internal_source_module: "server/ingestion/sources/saphrcloud",
    external_refs: ["kalil0321/ats-scrapers:successfactors.py"],
    current_gap: "Repo canonical source is saphrcloud; external methods use SuccessFactors naming.",
    recommended_action: "Treat as alias research for saphrcloud, not a new ATS family.",
    phases: ["phase_1", "phase_2"],
    priority: 7
  },
  {
    ats_key: "oracle",
    target_type: "existing-source-method-repair",
    internal_source_module: "server/ingestion/sources/oracle",
    external_refs: ["kalil0321/ats-scrapers:oracle.py"],
    current_gap: "Certified source exists, but tenant site/language variants remain a known enterprise risk.",
    recommended_action: "Use method profiles to capture site/language/pagination variants before broader promotion.",
    phases: ["phase_1", "phase_2", "phase_3"],
    priority: 8
  },
  {
    ats_key: "workday",
    target_type: "existing-source-method-repair",
    internal_source_module: "server/ingestion/sources/workday",
    external_refs: ["kalil0321/ats-scrapers:workday.py"],
    current_gap: "Certified source exists, but pagination and detail-description variants remain open.",
    recommended_action: "Benchmark source method variants and add pagination/detail fixtures before throughput expansion.",
    phases: ["phase_1", "phase_2", "phase_3"],
    priority: 9
  },
  {
    ats_key: "greenhouse",
    target_type: "existing-baseline-reference",
    internal_source_module: "server/ingestion/sources/greenhouse",
    external_refs: ["kalil0321/ats-scrapers:greenhouse.py"],
    current_gap: "Already strong direct JSON baseline.",
    recommended_action: "Use as the positive direct-JSON control when method profiles are added.",
    phases: ["phase_1", "phase_2"],
    priority: 10
  },
  {
    ats_key: "lever",
    target_type: "existing-baseline-reference",
    internal_source_module: "server/ingestion/sources/lever",
    external_refs: ["kalil0321/ats-scrapers:lever.py"],
    current_gap: "Already strong direct JSON baseline; pagination variants still useful.",
    recommended_action: "Use as a second direct-JSON control and add skip/limit fixture variants when touched.",
    phases: ["phase_1", "phase_2"],
    priority: 11
  },
  {
    ats_key: "phenom",
    target_type: "future-research-candidate",
    internal_source_module: "",
    external_refs: ["kalil0321/ats-scrapers:phenom.py"],
    current_gap: "Not configured and not in the immediate repo expansion list.",
    recommended_action: "Keep as research-only until configured source demand exists.",
    phases: ["phase_1"],
    priority: 12
  }
];

const PHASE_TARGETS = {
  phase_1: TARGETS.map((target) => target.ats_key),
  phase_2: ["teamtailor", "icims", "applitrack", "successfactors", "oracle", "workday", "greenhouse", "lever"],
  phase_3: ["teamtailor", "icims", "applitrack", "personio", "recruiterbox", "workable", "oracle", "workday"],
  phase_4: ["crawlee-sidecar", "firecrawl-evidence-provider", "crawl4ai-evidence-provider"]
};

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    mapPath: DEFAULT_MAP_PATH
  };

  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg.startsWith("--map=")) options.mapPath = arg.slice("--map=".length);
  }

  return options;
}

function buildExternalMethodMap(options = {}) {
  const now = options.now || new Date().toISOString();
  const snapshotDate = String(now).slice(0, 10);
  return {
    ok: true,
    generated_at: now,
    snapshot_date: snapshotDate,
    source: "openjobslots-external-ats-method-research",
    truth_boundary: "External scraper output is evidence only. Public posting fields must still come from deterministic source modules, raw fixtures, expected fixtures, parser tests, source-quality gates, and Postgres/Meili parity.",
    repositories: REPOSITORIES,
    phases: PHASES,
    phase_targets: PHASE_TARGETS,
    targets: TARGETS
  };
}

function validateExternalMethodMap(payload) {
  const errors = [];
  const phaseIds = new Set((payload.phases || []).map((phase) => phase.id));
  const targetKeys = new Set((payload.targets || []).map((target) => target.ats_key));

  if (!payload || payload.ok !== true) errors.push("payload.ok must be true");
  if ((payload.phases || []).length !== 4) errors.push("exactly four phases are required");
  if (!String(payload.truth_boundary || "").match(/evidence only/i)) {
    errors.push("truth_boundary must preserve evidence-only external output");
  }

  for (const target of payload.targets || []) {
    if (!target.ats_key) errors.push("target missing ats_key");
    if (!Array.isArray(target.phases) || target.phases.length === 0) {
      errors.push(`${target.ats_key} missing phases`);
    }
    for (const phase of target.phases || []) {
      if (!phaseIds.has(phase)) errors.push(`${target.ats_key} references unknown phase ${phase}`);
    }
    if (!String(target.recommended_action || "").trim()) {
      errors.push(`${target.ats_key} missing recommended_action`);
    }
  }

  for (const [phase, targets] of Object.entries(payload.phase_targets || {})) {
    if (!phaseIds.has(phase)) errors.push(`phase_targets references unknown phase ${phase}`);
    for (const target of targets) {
      if (String(target).endsWith("-sidecar") || String(target).endsWith("-evidence-provider")) continue;
      if (!targetKeys.has(target)) errors.push(`phase_targets.${phase} references unknown target ${target}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function renderMarkdown(payload) {
  const lines = [
    "# ATS External Method Map",
    "",
    `Generated: ${payload.generated_at}`,
    "",
    payload.truth_boundary,
    "",
    "## Phase Targets",
    ""
  ];

  for (const phase of payload.phases) {
    lines.push(`- ${phase.id}: ${phase.name} - ${phase.goal}`);
  }

  lines.push("", "## Priority Targets", "");
  for (const target of payload.targets.slice().sort((a, b) => a.priority - b.priority)) {
    lines.push(`- ${target.ats_key}: ${target.target_type}; ${target.recommended_action}`);
  }

  return `${lines.join("\n")}\n`;
}

function loadOrBuildMap(options = {}) {
  if (options.mapPath && fs.existsSync(options.mapPath)) {
    return JSON.parse(fs.readFileSync(options.mapPath, "utf8"));
  }
  return buildExternalMethodMap(options);
}

function main() {
  const options = parseArgs();
  const payload = loadOrBuildMap(options);
  const validation = validateExternalMethodMap(payload);
  if (!validation.ok) {
    console.error(JSON.stringify(validation, null, 2));
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  process.stdout.write(renderMarkdown(payload));
}

if (require.main === module) {
  main();
}

module.exports = {
  buildExternalMethodMap,
  loadOrBuildMap,
  parseArgs,
  renderMarkdown,
  validateExternalMethodMap
};
