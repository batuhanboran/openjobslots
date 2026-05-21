const assert = require("node:assert/strict");
const test = require("node:test");
const {
  attachDetailEvidenceSnapshot,
  buildCandidateReport,
  buildQualityGapFlags,
  candidateDetailEvidenceUrl,
  classifySourceCandidateErrorType,
  getSafetyGate,
  parseArgs,
  discoverSourceTargets,
  runWithLimitedConcurrency,
  sourceHost
} = require("./sourceRunner");

test("source runner apply requires explicit production safety flags", () => {
  const dryRun = parseArgs(["--source=greenhouse", "--limit=5"]);
  assert.equal(dryRun.source, "greenhouse");
  assert.equal(dryRun.limit, 5);
  assert.equal(getSafetyGate(dryRun).authorized, false);

  const companyLimitAlias = parseArgs(["--source=icims", "--company-limit=7"]);
  assert.equal(companyLimitAlias.limit, 7);

  const detailEvidence = parseArgs([
    "--source=icims",
    "--detail-evidence",
    "--detail-evidence-provider=local",
    "--detail-evidence-sample=20"
  ]);
  assert.equal(detailEvidence.detailEvidence, true);
  assert.equal(detailEvidence.detailEvidenceProvider, "local");
  assert.equal(detailEvidence.detailEvidenceSample, 20);

  const offsetRun = parseArgs(["--source=hrmdirect", "--limit=1500", "--offset=1000"]);
  assert.equal(offsetRun.limit, 1000);
  assert.equal(offsetRun.offset, 1000);

  const missingMax = parseArgs(["--source=greenhouse", "--apply", "--confirm-production"]);
  const missingMaxGate = getSafetyGate(missingMax);
  assert.equal(missingMaxGate.authorized, false);
  assert.deepEqual(missingMaxGate.missing, ["--max-updates=N"]);

  const authorized = parseArgs([
    "--mode=apply",
    "--source=greenhouse",
    "--apply",
    "--confirm-production",
    "--max-updates=25"
  ]);
  const gate = getSafetyGate(authorized);
  assert.equal(gate.apply_requested, true);
  assert.equal(gate.authorized, true);
  assert.deepEqual(gate.missing, []);
});

test("source runner normalizes hosts for per-host concurrency", () => {
  assert.equal(sourceHost("https://jobs.example.com/path?a=1"), "jobs.example.com");
  assert.equal(sourceHost("not a url"), "");
});

test("source runner host concurrency serializes same host while allowing different hosts", async () => {
  const runningByHost = new Map();
  const peakByHost = new Map();
  const items = [
    { host: "a.example" },
    { host: "a.example" },
    { host: "b.example" }
  ];
  await runWithLimitedConcurrency(
    items,
    async (item) => {
      const running = Number(runningByHost.get(item.host) || 0) + 1;
      runningByHost.set(item.host, running);
      peakByHost.set(item.host, Math.max(Number(peakByHost.get(item.host) || 0), running));
      await new Promise((resolve) => setTimeout(resolve, 10));
      runningByHost.set(item.host, Number(runningByHost.get(item.host) || 0) - 1);
    },
    { concurrency: 3, hostConcurrency: 1 }
  );
  assert.equal(peakByHost.get("a.example"), 1);
  assert.equal(peakByHost.get("b.example"), 1);
});

test("source runner exposes virtual targets for public aggregate boards in include-disabled estimates", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM companies c/i.test(sql)) return { rows: [] };
      if (/FROM ats_sources s/i.test(sql)) {
        return {
          rows: [{
            ats_key: "governmentjobs",
            enabled: false,
            protection_status: "normal",
            disabled_reason: "",
            rate_limit_ms: 0
          }]
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const targets = await discoverSourceTargets(pool, {
    source: "governmentjobs",
    includeDisabled: true,
    limit: 25,
    offset: 0
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].company.company_name, "GovernmentJobs (virtual)");
  assert.equal(targets[0].company.url_string, "https://www.governmentjobs.com/jobs");
  assert.equal(targets[0].atsKey, "governmentjobs");
  assert.equal(targets[0].source.enabled, false);
  assert.ok(targets[0].adapter, "virtual targets should still use the normal source adapter");
  assert.equal(queries.length, 2);
});

test("source runner does not expose disabled virtual targets without include-disabled", async () => {
  const pool = {
    async query(sql) {
      if (/FROM companies c/i.test(sql)) return { rows: [] };
      if (/FROM ats_sources s/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const targets = await discoverSourceTargets(pool, {
    source: "governmentjobs",
    includeDisabled: false,
    limit: 25,
    offset: 0
  });

  assert.deepEqual(targets, []);
});

test("source runner report classifies geo/remote gaps without assigning missing fields", () => {
  const flags = buildQualityGapFlags({
    country: "",
    region: "",
    city: "",
    location_text: "",
    remote_type: "unknown"
  }, "quarantined", ["no_geo_no_remote"]);

  assert.equal(flags.missing_any_geo, true);
  assert.equal(flags.missing_all_geo, true);
  assert.equal(flags.weak_unknown_remote, true);
  assert.equal(flags.no_geo_no_remote, true);
  assert.equal(flags.detail_evidence_found, false);
});

test("source runner keeps source-quality blocks out of parser validation errors", () => {
  assert.equal(classifySourceCandidateErrorType("source_disabled_by_threshold"), "source_quality");
  assert.equal(classifySourceCandidateErrorType("missing source_job_id"), "parser_validation");
});

test("source runner detail evidence sampling is dry-run only and bounded", async () => {
  const normalized = {
    canonical_url: "https://jobs.example.com/1",
    position_name: "Engineer",
    country: "",
    region: "",
    city: "",
    remote_type: "unknown"
  };
  const summary = {
    detail_evidence_sampled_count: 0,
    detail_evidence_failure_count: 0,
    detail_evidence_status_counts: {}
  };

  assert.equal(candidateDetailEvidenceUrl(normalized), "https://jobs.example.com/1");
  await attachDetailEvidenceSnapshot(normalized, {
    mode: "dry-run",
    detailEvidence: true,
    detailEvidenceSample: 1,
    detailEvidenceProvider: "local",
    detailEvidenceFetcher: async () => ({
      ok: true,
      status: 200,
      url: "https://jobs.example.com/1",
      headers: { get: () => "" },
      async text() {
        return "<p>Location: Austin</p><p>Hybrid role</p>";
      }
    }),
    detailEvidenceLookup: async () => [{ address: "93.184.216.34", family: 4 }]
  }, summary);

  assert.equal(summary.detail_evidence_sampled_count, 1);
  assert.equal(summary.detail_evidence_status_counts.fetched, 1);
  assert.equal(normalized.detail_evidence.status, "fetched");
  assert.equal(normalized.detail_evidence.country, undefined);

  const second = { ...normalized, canonical_url: "https://jobs.example.com/2", detail_evidence: null };
  await attachDetailEvidenceSnapshot(second, {
    mode: "dry-run",
    detailEvidence: true,
    detailEvidenceSample: 1,
    detailEvidenceProvider: "local"
  }, summary);
  assert.equal(second.detail_evidence, null);

  const applyMode = { canonical_url: "https://jobs.example.com/3" };
  await attachDetailEvidenceSnapshot(applyMode, {
    mode: "apply",
    detailEvidence: true,
    detailEvidenceSample: 10
  }, { detail_evidence_sampled_count: 0 });
  assert.equal(applyMode.detail_evidence, undefined);
});

test("source runner candidate reports include source family and detail evidence summary", () => {
  const report = buildCandidateReport(
    {
      companyUrl: "https://jobs.example.com",
      host: "jobs.example.com",
      adapter: { metadata: { sourceFamily: "html_detail" } }
    },
    {
      canonical_url: "https://jobs.example.com/1",
      source_job_id: "job-1",
      position_name: "Engineer",
      country: "",
      region: "",
      city: "",
      remote_type: "unknown",
      detail_evidence: {
        status: "fetched",
        extractor: "local",
        final_url: "https://jobs.example.com/1",
        content_hash: "abc",
        markdown_length: 42,
        evidence_spans: [{ kind: "location", excerpt: "Location: Austin" }]
      }
    },
    "quarantined",
    { status: "quarantined", public: false, ok: false, reason: "no_geo_no_remote" },
    { error: "no_geo_no_remote", reason_codes: ["no_geo_no_remote"] },
    { failure_reasons: [] }
  );

  assert.equal(report.source_family, "html_detail");
  assert.equal(report.detail_evidence_summary.present, true);
  assert.equal(report.detail_evidence_summary.extractor, "local");
  assert.equal(report.quality_gap_flags.detail_evidence_found, true);
  assert.equal(report.quality_gap_flags.no_geo_no_remote, true);
  assert.equal(report.country, undefined);
  assert.equal(report.remote_type, undefined);
});

console.log("source runner tests passed");
