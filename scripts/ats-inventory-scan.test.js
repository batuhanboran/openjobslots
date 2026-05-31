const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  parseInventoryArgs,
  runInventoryScan
} = require("../server/ingestion/inventoryScanner");

function makeTargets(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const id = offset + index;
    return {
      company: { id, company_name: `Company ${id}`, url_string: `https://jobs.example.com/${id}`, ATS_name: "hrmdirect" },
      atsKey: "hrmdirect",
      companyUrl: `https://jobs.example.com/${id}`,
      host: "jobs.example.com",
      adapter: {}
    };
  });
}

function makeWindowReport(options = {}) {
  const scanned = options.targets.length;
  return {
    inventory: {
      targets_scanned: scanned
    },
    classifications: {},
    parser_failure_reasons: {},
    http_status_counts: {},
    errors: [],
    samples: [],
    rows_fetched: scanned,
    rows_parsed: scanned * 2,
    clean_candidates: scanned,
    net_new_clean_public_candidates: scanned,
    duplicate_count: 0,
    update_count: 0,
    stale_or_hidden_reactivation_candidates: 0,
    quarantine_count: 0,
    rejected_count: 0,
    expected_public_row_gain: scanned,
    quality_risk_of_net_new_rows: {
      missing_country: 0,
      missing_region: 0,
      missing_city: 0,
      missing_any_geo: 0,
      missing_all_geo: 0,
      weak_unknown_remote: 0,
      no_geo_no_remote: 0
    }
  };
}

async function runMockScan(argv, configuredTargets, overrides = {}) {
  const offsets = [];
  const options = {
    ...parseInventoryArgs(argv, {}),
    pool: {},
    countConfiguredTargets: async () => configuredTargets,
    discoverTargets: async (_pool, page) => makeTargets(Math.min(page.limit, Math.max(0, configuredTargets - page.offset)), page.offset),
    estimateWindow: async (windowOptions) => {
      offsets.push(windowOptions.offset);
      return makeWindowReport(windowOptions);
    },
    ...overrides
  };
  const report = await runInventoryScan(options, {});
  return { report, offsets };
}

test("capped runner is detected and paged instead of truncated", async () => {
  const { report, offsets } = await runMockScan(
    ["--source=hrmdirect", "--company-limit=1500", "--row-limit=10000"],
    1500
  );
  assert.equal(report.runner_cap_detected, true);
  assert.equal(report.runner_cap_fixed_by_pagination, true);
  assert.deepEqual(offsets, [0, 1000]);
  assert.equal(report.scanned_targets, 1500);
});

test("offset scan continues after the first batch", async () => {
  const { report, offsets } = await runMockScan(
    ["--source=hrmdirect", "--company-limit=2200", "--row-limit=10000"],
    2200
  );
  assert.deepEqual(offsets, [0, 1000, 2000]);
  assert.equal(report.windows.at(-1).targets_scanned, 200);
  assert.equal(report.candidate_pool_exhausted, true);
});

test("checkpoint resume starts from next offset and does not duplicate targets", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ats-inventory-scan-"));
  const checkpoint = path.join(tempDir, "checkpoint.json");
  fs.writeFileSync(checkpoint, JSON.stringify({
    source: "hrmdirect",
    next_offset: 1000,
    configured_targets: 1500
  }));
  const { report, offsets } = await runMockScan(
    ["--source=hrmdirect", "--company-limit=1500", "--row-limit=10000", "--resume", `--checkpoint=${checkpoint}`],
    1500
  );
  assert.deepEqual(offsets, [1000]);
  assert.equal(report.scanned_targets, 500);
  assert.equal(report.next_offset, 1500);
});

test("exhausted pool reports true when all configured targets are scanned", async () => {
  const { report } = await runMockScan(
    ["--source=breezy", "--company-limit=2000", "--row-limit=10000"],
    1200
  );
  assert.equal(report.candidate_pool_exhausted, true);
  assert.equal(report.cannot_prove_remaining_inventory, false);
  assert.equal(report.estimate_confidence, "high");
});

test("unproven pool reports false when configured targets remain", async () => {
  const { report } = await runMockScan(
    ["--source=hrmdirect", "--company-limit=1500", "--row-limit=10000"],
    2403
  );
  assert.equal(report.candidate_pool_exhausted, false);
  assert.equal(report.cannot_prove_remaining_inventory, true);
  assert.equal(report.stop_reason, "company_limit_reached");
  assert.equal(report.unscanned_targets, 903);
});

test("max fetches caps the current window instead of only stopping after an oversized page", async () => {
  const { report, offsets } = await runMockScan(
    ["--source=zoho", "--company-limit=200", "--row-limit=10000", "--max-fetches=25"],
    200
  );
  assert.deepEqual(offsets, [0]);
  assert.equal(report.scanned_targets, 25);
  assert.equal(report.next_offset, 25);
  assert.equal(report.stop_reason, "max_fetches_reached");
  assert.equal(report.unscanned_targets, 175);
  assert.equal(report.windows[0].requested_limit, 25);
});

test("source timeout option is forwarded to each estimate window", async () => {
  let observedTimeout = 0;
  await runMockScan(
    ["--source=zoho", "--company-limit=25", "--row-limit=10000", "--source-timeout-ms=90000"],
    25,
    {
      estimateWindow: async (windowOptions) => {
        observedTimeout = windowOptions.sourceTimeoutMs;
        return makeWindowReport(windowOptions);
      }
    }
  );
  assert.equal(observedTimeout, 90000);
});

console.log("ats inventory scan tests passed");
