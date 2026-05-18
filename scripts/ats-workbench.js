const fs = require("fs");
const path = require("path");
const { ATS_FILTER_OPTION_ITEMS } = require("../server");
const {
  ADAPTER_CERTIFICATION_DETAILS,
  getAdapterMetadata,
  isAtsEnabledByDefault
} = require("../server/ingestion/adapter-metadata");
const { buildAtsCertificationRecords } = require("../server/ingestion/ats-certification");
const {
  buildAtsScoreboard,
  buildSummary: buildScoreboardSummary
} = require("./audit-ats-quality");

const DEFAULT_WORKBENCH_DIR = path.join("docs", "reference", "ats-workbench");
const DEFAULT_SCOREBOARD_PATH = path.join(DEFAULT_WORKBENCH_DIR, "scoreboard.json");
const FIXTURE_DIR = path.join("server", "ingestion", "fixtures");
const SOURCE_MODULE_DIR = path.join("server", "ingestion", "sources");
const DIRECT_JSON_API_REPAIR_SOURCES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "bamboohr",
  "manatal",
  "recruitcrm",
  "pinpointhq",
  "fountain",
  "zoho"
]);

const OFFICIAL_DOCS = Object.freeze({
  ashby: "https://developers.ashbyhq.com/docs/public-job-posting-api",
  greenhouse: "https://developer.greenhouse.io/job-board.html",
  icims: "https://developer-community.icims.com/applications/applicant-tracking/job-portal",
  lever: "https://github.com/lever/postings-api",
  recruitee: "https://docs.recruitee.com/reference/intro-to-careers-site-api",
  smartrecruiters: "https://developers.smartrecruiters.com/docs/endpoints",
  teamtailor: "https://support.teamtailor.com/en/articles/5963369-use-our-teamtailor-api"
});

const OBSERVED_ENDPOINTS = Object.freeze({
  adp_myjobs: "Observed ADP MyJobs board token plus apply-custom-filters JSON.",
  adp_workforcenow: "Observed ADP Workforce Now content links and requisition JSON.",
  applicantai: "Observed ApplicantAI public careers HTML.",
  applicantpro: "Observed ApplicantPro board HTML plus core jobs JSON.",
  applitrack: "Observed Applitrack Output.asp?all=1 plus JobPostings/view.asp detail pages.",
  bamboohr: "Observed BambooHR careers list JSON.",
  brassring: "Observed BrassRing board bootstrap plus matched jobs JSON.",
  breezy: "Observed Breezy portal HTML cards.",
  careerplug: "Observed CareerPlug public jobs HTML.",
  careerpuck: "Observed CareerPuck public board JSON.",
  careerspage: "Observed CareersPage public HTML.",
  eightfold: "Observed Eightfold careers HTML plus search API.",
  fountain: "Observed Fountain board .json openings endpoint.",
  freshteam: "Observed Freshteam public board HTML.",
  gem: "Observed Gem public GraphQL batch response.",
  getro: "Observed Getro Next.js __NEXT_DATA__ jobs payload.",
  governmentjobs: "Observed GovernmentJobs public AJAX/list HTML.",
  hibob: "Observed HiBob careers board plus job-ad API.",
  hirebridge: "Observed Hirebridge list HTML plus detail pages.",
  hrmdirect: "Observed HRMDirect employment table HTML.",
  isolvisolvedhire: "Observed iSolved Hire board domain id plus core jobs API.",
  jobaps: "Observed JobAps public agency/company page.",
  jobvite: "Observed Jobvite careers HTML tables.",
  join: "Observed JOIN Next.js embedded jobs data.",
  k12jobspot: "Observed K12JobSpot public JSON API.",
  loxo: "Observed Loxo public board HTML.",
  manatal: "Observed Manatal careers-page runtime config plus public jobs API.",
  oracle: "Observed Oracle CandidateExperience requisition API.",
  pageup: "Observed PageUp search/list HTML plus detail pages.",
  paylocity: "Observed Paylocity embedded pageData Jobs JSON.",
  peopleforce: "Observed PeopleForce public careers HTML.",
  pinpointhq: "Observed PinpointHQ postings.json API.",
  policeapp: "Observed PoliceApp public AJAX/list endpoint.",
  recruitcrm: "Observed RecruitCRM public jobs API.",
  rippling: "Observed Rippling public ATS JSON.",
  sagehr: "Observed SageHR public vacancies HTML.",
  saphrcloud: "Observed SAP SuccessFactors/SAP HR Cloud recruiting HTML or jobs API.",
  schoolspring: "Observed SchoolSpring public JSON API.",
  simplicant: "Observed Simplicant public board HTML.",
  statejobsny: "Observed StateJobsNY public dated HTML table.",
  taleo: "Observed Taleo bootstrap, REST requisition search, and AJAX fallback.",
  talentreef: "Observed TalentReef alias/search API.",
  talentlyft: "Observed TalentLyft landing config and paged fragments.",
  talexio: "Observed Talexio public jobs JSON.",
  theapplicantmanager: "Observed The Applicant Manager public careers HTML.",
  ultipro: "Observed UKG/UltiPro opportunities JSON.",
  usajobs: "Observed USAJobs official Search API.",
  workday: "Observed Workday CXS job postings API.",
  zoho: "Observed Zoho Recruit hidden jobs JSON in careers page."
});

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    source: "",
    json: false,
    outputDir: DEFAULT_WORKBENCH_DIR,
    scoreboardPath: DEFAULT_SCOREBOARD_PATH,
    write: true
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--no-write") options.write = false;
    else if (arg.startsWith("--source=")) options.source = arg.slice("--source=".length).trim().toLowerCase();
    else if (arg.startsWith("--output-dir=")) options.outputDir = arg.slice("--output-dir=".length);
    else if (arg.startsWith("--scoreboard=")) options.scoreboardPath = arg.slice("--scoreboard=".length);
  }
  return options;
}

function readJsonIfExists(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function fixtureInventory(rootDir = FIXTURE_DIR) {
  const resolved = path.resolve(rootDir);
  const sourceResolved = path.resolve(SOURCE_MODULE_DIR);
  const stack = [];
  if (fs.existsSync(resolved)) stack.push(resolved);
  if (fs.existsSync(sourceResolved)) stack.push(sourceResolved);
  if (stack.length === 0) return [];
  const files = [];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const itemPath = path.join(current, item.name);
      if (item.isDirectory()) stack.push(itemPath);
      else files.push(path.relative(process.cwd(), itemPath).replace(/\\/g, "/"));
    }
  }
  return files.sort();
}

function clean(value) {
  return String(value ?? "").trim();
}

function tierToSourceFamily(tier, atsKey) {
  if (tier === "direct-json-stable") return "direct_json";
  if (tier === "enterprise-direct") return "enterprise_api";
  if (tier === "public-sector-education") return "public_sector";
  if (tier === "brittle-high-risk") return "brittle";
  if (tier === "embedded-or-semi-structured") {
    if (["applicantpro", "isolvisolvedhire", "zoho"].includes(atsKey)) return "embedded_json";
    return "html_detail";
  }
  if (tier === "vendor-specific") {
    if (["careerpuck", "gem", "manatal", "rippling", "talexio"].includes(atsKey)) return "direct_json";
    return "html_detail";
  }
  return "brittle";
}

function methodForFamily(sourceFamily) {
  if (sourceFamily === "direct_json") {
    return {
      source_discovery_method: "derive tenant/board identifier from company ATS URL, then use the public JSON endpoint when available",
      list_fetch_method: "bounded GET/POST to source JSON list endpoint through the source runner",
      detail_fetch_method: "not required for core fields unless the list payload omits description or normalized geo evidence",
      pagination_method: "use source offset/limit/page cursor when documented; otherwise cap single-list fetches",
      rate_limit: "default per-host serialization plus source daily budget; lower for uncertified tenants"
    };
  }
  if (sourceFamily === "enterprise_api") {
    return {
      source_discovery_method: "extract tenant, site, portal, or requisition API identifiers from configured company URL",
      list_fetch_method: "bounded API request to candidate/search endpoint through source runner",
      detail_fetch_method: "detail fetch only when list response lacks geo/date/remote and parser certification covers detail shape",
      pagination_method: "use documented limit/offset/cursor; stop on empty page, error, or job budget",
      rate_limit: "conservative tenant-level budget, per-host serialization, retry/backoff on 429/5xx"
    };
  }
  if (sourceFamily === "embedded_json") {
    return {
      source_discovery_method: "fetch public board HTML and extract embedded JSON or domain id before parsing",
      list_fetch_method: "fetch public board or discovered JSON endpoint with bounded response size",
      detail_fetch_method: "optional detail fetch only when list evidence is insufficient and fixture-backed",
      pagination_method: "follow documented list or embedded next-page data; avoid unbounded DOM crawling",
      rate_limit: "one host request at a time with source daily budget and block-rate stop"
    };
  }
  if (sourceFamily === "html_detail") {
    return {
      source_discovery_method: "fetch public board HTML and parse validated cards/links only",
      list_fetch_method: "bounded HTML list fetch through source runner",
      detail_fetch_method: "detail page required when list cards omit location/date/remote; use only fixture-backed extractors",
      pagination_method: "only follow known next-page/list links with max-page and max-row limits",
      rate_limit: "strict host serialization, jitter, retry cap, and high block-rate stop"
    };
  }
  if (sourceFamily === "public_sector") {
    return {
      source_discovery_method: "use configured agency/board URL and official/list endpoint where visible",
      list_fetch_method: "bounded public-sector feed/API/HTML list request",
      detail_fetch_method: "detail fetch for date/location only when fixture-backed and polite",
      pagination_method: "respect source page controls; do not brute-force ids",
      rate_limit: "strict public-board rate limit with long cooldown after 429/403"
    };
  }
  return {
    source_discovery_method: "manual source-specific discovery required before public enablement",
    list_fetch_method: "brittle source-specific fetch only in canary mode until certified",
    detail_fetch_method: "disabled unless raw fixture and parser test prove detail extraction",
    pagination_method: "no broad pagination until source shape is certified",
    rate_limit: "quarantine-only or disabled; canary budget only"
  };
}

function ruleFromCertification(record, fieldName, fallback) {
  const field = record?.fieldDecisions?.[fieldName];
  if (!field) return fallback;
  return `${field.status}: ${field.evidence}`;
}

function qualityThresholdFor(row) {
  if (row.current_status === "unsupported" || row.current_status === "disabled") {
    return {
      mode: "disabled",
      minimum_confidence: 1,
      public_write_rule: "no public writes until adapter and fixtures exist"
    };
  }
  if (row.current_status !== "certified") {
    return {
      mode: "quarantine_or_canary",
      minimum_confidence: 0.85,
      public_write_rule: "source canary only; public writes require raw parser fixture, expected normalized fixture, and passing parser tests"
    };
  }
  if (!row.should_be_public_enabled) {
    return {
      mode: "certified_but_quarantine_risk",
      minimum_confidence: 0.8,
      public_write_rule: "certified parser exists, but live quality gaps require quarantine/detail-refetch before broad public writes"
    };
  }
  return {
    mode: "public_enabled",
    minimum_confidence: 0.7,
    public_write_rule: "accepted rows must pass title/company/canonical_url and row-level quality gate"
  };
}

function fixtureStatusFor(atsKey, metadata, fixtures) {
  const normalizedKey = String(atsKey || "").toLowerCase();
  const ownFixtures = fixtures.filter((file) => {
    const normalizedFile = String(file || "").replace(/\\/g, "/").toLowerCase();
    return path.basename(normalizedFile).includes(normalizedKey) ||
      normalizedFile.includes(`/sources/${normalizedKey}/fixtures/`);
  });
  const hasRawFixture = metadata.parserFixtureStatus === "parser-fixture-backed";
  const missing = [];
  if (!hasRawFixture) missing.push("raw source fixture");
  if (!hasRawFixture) missing.push("expected normalized fixture");
  if (!hasRawFixture) missing.push("parser rejection tests");
  return {
    status: metadata.parserFixtureStatus,
    files: ownFixtures,
    present: ownFixtures.length > 0 ? ownFixtures : [],
    missing
  };
}

function publicDocsOrObservedEndpoint(atsKey, record, certification) {
  if (OFFICIAL_DOCS[atsKey]) return OFFICIAL_DOCS[atsKey];
  if (certification?.sourceEndpointPattern) return certification.sourceEndpointPattern;
  return OBSERVED_ENDPOINTS[atsKey] || record.sourcePattern || "observed endpoint pending";
}

function sourceIdRule(record, certification) {
  if (certification?.sourceEndpointPattern && certification?.canonicalUrlRule) {
    return certification.canonicalUrlRule.includes("id")
      ? `preserve strongest raw id or URL id; ${certification.canonicalUrlRule}`
      : "preserve strongest raw id, requisition id, job id, vacancy id, or stable URL id";
  }
  return ruleFromCertification(record, "sourceId", "preserve strongest raw id, requisition id, job id, vacancy id, or stable URL id");
}

function buildSourceWorkbenchRecord({ item, row, record, metadata, fixtures }) {
  const atsKey = item.value.toLowerCase();
  const sourceFamily = tierToSourceFamily(metadata.tier, atsKey);
  const method = methodForFamily(sourceFamily);
  const certification = ADAPTER_CERTIFICATION_DETAILS[atsKey] || metadata.certification || null;
  const fixtureStatus = fixtureStatusFor(atsKey, metadata, fixtures);
  const publicEnabled = Boolean(row.should_be_public_enabled && isAtsEnabledByDefault(atsKey));
  const hasDedicatedSourceModule = fs.existsSync(path.join(SOURCE_MODULE_DIR, atsKey, "index.js"));
  const sourceModulePath = hasDedicatedSourceModule
    ? `server/ingestion/sources/${atsKey}/index.js`
    : "";
  return {
    ats_key: atsKey,
    display_name: item.label || atsKey,
    current_status: row.current_status,
    source_family: sourceFamily,
    official_public_docs_or_observed_endpoint: publicDocsOrObservedEndpoint(atsKey, record, certification),
    source_discovery_method: method.source_discovery_method,
    list_fetch_method: method.list_fetch_method,
    detail_fetch_method: certification?.detailPageRequirement || method.detail_fetch_method,
    pagination_method: certification?.paginationBehavior || method.pagination_method,
    canonical_url_rule: certification?.canonicalUrlRule || "use source canonical/apply URL, absolutize relative URLs, strip tracking noise, and keep stable path identity",
    source_job_id_rule: sourceIdRule(record, certification),
    title_company_rule: "reject rows missing title, company context, or usable canonical/apply URL; reject placeholders and blank titles",
    location_text_rule: ruleFromCertification(record, "geo", "use source location text only; do not invent country, city, or region"),
    country_region_city_rule: ruleFromCertification(record, "geo", "normalize country/region/city only from deterministic source evidence"),
    remote_type_rule: certification?.remoteParsingRule || ruleFromCertification(record, "remote", "set remote/hybrid/on-site only from explicit source evidence"),
    posting_date_rule: certification?.dateParsingRule || ruleFromCertification(record, "date", "parse posted_at only from trustworthy source date fields; otherwise leave null"),
    rate_limit: method.rate_limit,
    parser_fixtures: fixtureStatus,
    source_module: {
      present: hasDedicatedSourceModule,
      path: sourceModulePath,
      fixtures_dir: hasDedicatedSourceModule ? `server/ingestion/sources/${atsKey}/fixtures` : "",
      parser_version: hasDedicatedSourceModule ? `source-${atsKey}-v1` : ""
    },
    quality_threshold: qualityThresholdFor(row),
    public_enabled: publicEnabled,
    quarantine_reason: publicEnabled ? "" : row.reason,
    failure_log: {
      known_failure_modes: certification?.expectedFailureModes || [],
      parser_attention_count_24h: row.parser_attention_count_24h,
      rejected_count: row.rejected_count,
      quarantined_count: row.quarantined_count,
      latest_parser_error: row.latest_parser_error || ""
    },
    production_quality: {
      rows: row.current_production_row_count,
      missing_country_pct: row.missing_country_pct,
      missing_city_pct: row.missing_city_pct,
      missing_any_geo_pct: row.missing_any_geo_pct,
      weak_remote_pct: row.weak_remote_pct,
      risk_score: row.risk_score,
      wave_priority: row.wave_priority,
      detail_refetch_needed: row.detail_refetch_needed
    },
    parser_method: {
      path: record.parserPath,
      parser_version_status: metadata.parserFixtureStatus,
      confidence: row.parser_confidence || metadata.confidence
    },
    runner_interface: {
      discover: hasDedicatedSourceModule ? `server/ingestion/sources/${atsKey}/discover.js` : method.source_discovery_method,
      fetchList: hasDedicatedSourceModule ? `server/ingestion/sources/${atsKey}/fetchList.js` : method.list_fetch_method,
      fetchDetail: hasDedicatedSourceModule ? `server/ingestion/sources/${atsKey}/fetchDetail.js` : certification?.detailPageRequirement || method.detail_fetch_method,
      parseList: hasDedicatedSourceModule ? `server/ingestion/sources/${atsKey}/parse.js` : record.parserPath,
      parseDetail: hasDedicatedSourceModule ? `server/ingestion/sources/${atsKey}/parse.js` : record.parserPath,
      normalize: hasDedicatedSourceModule ? `server/ingestion/sources/${atsKey}/normalize.js` : "server/ingestion/parserContract.js normalized posting shape plus source-specific normalizer",
      validate: hasDedicatedSourceModule ? `server/ingestion/sources/${atsKey}/validate.js` : "server/ingestion/publicPostingGate.js row-level quality gate",
      writeAccepted: "source runner accepted path updates public read model only after validation",
      writeQuarantine: "source runner quarantine path records reason and keeps row out of public index"
    },
    next_action: row.exact_next_parser_action,
    certification_blockers: row.certification_blockers
  };
}

function loadScoreboard(options) {
  const existing = readJsonIfExists(options.scoreboardPath);
  if (existing?.items?.length) return existing.items;
  return buildAtsScoreboard();
}

function currentStatusFromMetadata(metadata) {
  if (metadata.parserFixtureStatus === "unsupported") return "unsupported";
  if (!metadata.enabledByDefault) return "disabled";
  if (metadata.parserFixtureStatus === "parser-fixture-backed") return "certified";
  if (metadata.fixtureStatus === "fixture-backed") return "partial";
  return "fallback";
}

function normalizeScoreboardRows(rows) {
  return rows.map((row) => {
    const metadata = getAdapterMetadata(row.ats_key, row.display_name);
    const currentStatus = currentStatusFromMetadata(metadata);
    return {
      ...row,
      current_status: currentStatus,
      fixture_status: metadata.fixtureStatus,
      parser_fixture_status: metadata.parserFixtureStatus,
      parser_confidence: metadata.confidence,
      adapter_tier: metadata.tier,
      enabled_by_default: metadata.enabledByDefault,
      should_be_public_enabled: currentStatus === "unsupported" || currentStatus === "disabled"
        ? false
        : Boolean(row.should_be_public_enabled)
    };
  });
}

function easiestImprovementScore(row) {
  const certifiedFactor = row.current_status === "certified" ? 1.2 : row.current_status === "partial" ? 0.9 : 0.55;
  const publicFactor = row.should_be_public_enabled ? 1 : 0.45;
  const volume = Math.log10(Number(row.current_production_row_count || 0) + 1);
  const gap = Number(row.missing_any_geo_pct || 0) * 0.7 + Number(row.weak_remote_pct || 0) * 0.3;
  return Number((volume * gap * certifiedFactor * publicFactor).toFixed(2));
}

function buildIndexPayload(records, scoreboard) {
  const statusCounts = {};
  const sourceFamilyCounts = {};
  for (const record of records) {
    statusCounts[record.current_status] = Number(statusCounts[record.current_status] || 0) + 1;
    sourceFamilyCounts[record.source_family] = Number(sourceFamilyCounts[record.source_family] || 0) + 1;
  }
  const publicEnabled = records.filter((record) => record.public_enabled).map((record) => record.ats_key).sort();
  const quarantineOrDisabled = records.filter((record) => !record.public_enabled).map((record) => ({
    ats_key: record.ats_key,
    status: record.current_status,
    reason: record.quarantine_reason
  }));
  const topQualityRisk = [...scoreboard].slice(0, 15).map((row) => ({
    ats_key: row.ats_key,
    risk_score: row.risk_score,
    rows: row.current_production_row_count,
    missing_any_geo_pct: row.missing_any_geo_pct,
    weak_remote_pct: row.weak_remote_pct,
    reason: row.reason
  }));
  const easiestExpectedImprovement = [...scoreboard]
    .filter((row) => Number(row.current_production_row_count || 0) > 0)
    .map((row) => ({ ...row, easiest_improvement_score: easiestImprovementScore(row) }))
    .sort((a, b) => b.easiest_improvement_score - a.easiest_improvement_score)
    .slice(0, 15)
    .map((row) => ({
      ats_key: row.ats_key,
      easiest_improvement_score: row.easiest_improvement_score,
      status: row.current_status,
      rows: row.current_production_row_count,
      missing_any_geo_pct: row.missing_any_geo_pct,
      weak_remote_pct: row.weak_remote_pct,
      next_action: row.exact_next_parser_action
    }));
  return {
    generated_at: new Date().toISOString(),
    ats_count: records.length,
    status_counts: statusCounts,
    source_family_counts: sourceFamilyCounts,
    top_15_quality_risk: topQualityRisk,
    top_15_easiest_expected_improvement: easiestExpectedImprovement,
    public_enabled_sources: publicEnabled,
    quarantine_or_disabled_sources: quarantineOrDisabled,
    fixture_gaps: records
      .filter((record) => record.parser_fixtures.missing.length > 0)
      .map((record) => ({
        ats_key: record.ats_key,
        missing: record.parser_fixtures.missing,
        next_action: record.next_action
      })),
    sources: records.map((record) => ({
      ats_key: record.ats_key,
      file: `sources/${record.ats_key}.json`,
      current_status: record.current_status,
      source_family: record.source_family,
      public_enabled: record.public_enabled,
      risk_score: record.production_quality.risk_score
    })),
    source_documents_used: {
      greenhouse: OFFICIAL_DOCS.greenhouse,
      lever: OFFICIAL_DOCS.lever,
      ashby: OFFICIAL_DOCS.ashby,
      smartrecruiters: OFFICIAL_DOCS.smartrecruiters,
      recruitee: OFFICIAL_DOCS.recruitee,
      icims: OFFICIAL_DOCS.icims,
      teamtailor: OFFICIAL_DOCS.teamtailor
    }
  };
}

function buildWorkbench(options = parseArgs()) {
  const fixtureFiles = fixtureInventory();
  const scoreboard = normalizeScoreboardRows(loadScoreboard(options));
  const scoreboardByKey = new Map(scoreboard.map((row) => [row.ats_key, row]));
  const certificationRecords = buildAtsCertificationRecords(ATS_FILTER_OPTION_ITEMS.map((item) => item.value));
  const selectedItems = ATS_FILTER_OPTION_ITEMS
    .filter((item) => !options.source || item.value.toLowerCase() === options.source)
    .sort((a, b) => a.value.localeCompare(b.value));
  const records = selectedItems.map((item) => {
    const atsKey = item.value.toLowerCase();
    const metadata = getAdapterMetadata(atsKey, item.label);
    const row = scoreboardByKey.get(atsKey) || buildAtsScoreboard({ atsItems: [item] })[0];
    return buildSourceWorkbenchRecord({
      item,
      row,
      record: certificationRecords[atsKey],
      metadata,
      fixtures: fixtureFiles
    });
  });
  return {
    ok: true,
    summary: buildIndexPayload(records, selectedItems.length === ATS_FILTER_OPTION_ITEMS.length ? scoreboard : records.map((record) => ({
      ats_key: record.ats_key,
      risk_score: record.production_quality.risk_score,
      current_status: record.current_status,
      current_production_row_count: record.production_quality.rows,
      missing_any_geo_pct: record.production_quality.missing_any_geo_pct,
      weak_remote_pct: record.production_quality.weak_remote_pct,
      should_be_public_enabled: record.public_enabled,
      exact_next_parser_action: record.next_action,
      reason: record.quarantine_reason || "source has acceptable current evidence"
    }))),
    sources: records,
    scoreboard_summary: buildScoreboardSummary(scoreboard)
  };
}

function writeWorkbench(payload, options) {
  const outputDir = path.resolve(options.outputDir);
  const sourcesDir = path.join(outputDir, "sources");
  fs.mkdirSync(sourcesDir, { recursive: true });
  for (const source of payload.sources) {
    fs.writeFileSync(path.join(sourcesDir, `${source.ats_key}.json`), `${JSON.stringify(source, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(outputDir, "index.json"), `${JSON.stringify(payload.summary, null, 2)}\n`);
}

function main() {
  const options = parseArgs();
  const payload = buildWorkbench(options);
  if (options.write) writeWorkbench(payload, options);
  if (options.json || options.source) {
    process.stdout.write(`${JSON.stringify(options.source ? payload.sources[0] || null : payload.summary, null, 2)}\n`);
  } else {
    process.stdout.write(`Generated ATS workbench for ${payload.sources.length} source(s) in ${options.outputDir}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  buildIndexPayload,
  buildSourceWorkbenchRecord,
  buildWorkbench,
  easiestImprovementScore,
  fixtureInventory,
  parseArgs,
  tierToSourceFamily
};
