const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildExistingLookup,
  classifyCandidateAgainstExisting,
  classifyNonAccepted,
  classifyEstimateDecision,
  markCandidateSeen,
  parseEstimatorArgs,
  summarizeInventory
} = require("../server/ingestion/netNewEstimator");
const {
  buildMarkdownEvidenceSnapshot
} = require("../server/ingestion/markdownEvidence");

function cleanCandidate(overrides = {}) {
  return {
    ats_key: "lever",
    canonical_url: "https://jobs.lever.co/acme/1",
    apply_url: "https://jobs.lever.co/acme/1/apply",
    source_job_id: "job-1",
    position_name: "Engineer",
    company_name: "Acme",
    country: "United States",
    region: "California",
    city: "San Francisco",
    remote_type: "onsite",
    ...overrides
  };
}

test("same canonical URL is not counted as net-new", () => {
  const lookup = buildExistingLookup([
    cleanCandidate({ canonical_url: "https://jobs.lever.co/acme/1", source_job_id: "other-id", hidden: false })
  ]);
  const result = classifyCandidateAgainstExisting(
    cleanCandidate({ source_job_id: "job-2" }),
    lookup,
    { sourceJobKeys: new Set(), urlKeys: new Set() }
  );
  assert.equal(result.classification, "already_public_same_canonical_url");
});

test("same source_job_id is not counted as net-new", () => {
  const lookup = buildExistingLookup([
    cleanCandidate({ canonical_url: "https://jobs.lever.co/acme/existing", source_job_id: "job-1", hidden: false })
  ]);
  const result = classifyCandidateAgainstExisting(
    cleanCandidate({ canonical_url: "https://jobs.lever.co/acme/new-url", source_job_id: "job-1" }),
    lookup,
    { sourceJobKeys: new Set(), urlKeys: new Set() }
  );
  assert.equal(result.classification, "already_public_same_source_job_id");
});

test("different URL but same source job id is duplicate", () => {
  const lookup = buildExistingLookup([
    cleanCandidate({ canonical_url: "https://jobs.lever.co/acme/old", source_job_id: "stable-123", hidden: false })
  ]);
  const result = classifyCandidateAgainstExisting(
    cleanCandidate({ canonical_url: "https://jobs.lever.co/acme/new", source_job_id: "stable-123" }),
    lookup,
    { sourceJobKeys: new Set(), urlKeys: new Set() }
  );
  assert.equal(result.classification, "already_public_same_source_job_id");
});

test("hidden or stale row is reported separately, not counted as new", () => {
  const lookup = buildExistingLookup([
    cleanCandidate({ canonical_url: "https://jobs.lever.co/acme/hidden", source_job_id: "hidden-1", hidden: true })
  ]);
  const result = classifyCandidateAgainstExisting(
    cleanCandidate({ canonical_url: "https://jobs.lever.co/acme/hidden", source_job_id: "hidden-1" }),
    lookup,
    { sourceJobKeys: new Set(), urlKeys: new Set() }
  );
  assert.equal(result.classification, "stale_or_hidden_reactivation_candidate");
});

test("no_geo_no_remote is excluded from net-new candidates", () => {
  const classification = classifyNonAccepted("quarantined", {
    error: "no_geo_no_remote",
    reason_codes: ["no_geo_no_remote"]
  });
  assert.equal(classification, "no_geo_no_remote");
});

test("runner cap without full coverage marks estimate as unproven", () => {
  const inventory = summarizeInventory({
    configuredTargets: 2403,
    targetsScanned: 1000,
    requestedLimit: 1500,
    effectiveLimit: 1000,
    offset: 0
  });
  assert.equal(inventory.limit_capped, true);
  assert.equal(inventory.cannot_prove_remaining_inventory, true);
  assert.equal(inventory.runner_limit_cap_unproven_inventory, true);
  assert.equal(inventory.offset_resume_supported, true);
});

test("estimator accepts all-source read-only report flags", () => {
  const options = parseEstimatorArgs([
    "--all",
    "--include-disabled",
    "--limit=25",
    "--source-timeout-ms=90000",
    "--markdown-output=reports/ats-evidence.md",
    "--json"
  ]);
  assert.equal(options.all, true);
  assert.equal(options.includeDisabled, true);
  assert.equal(options.limit, 25);
  assert.equal(options.sourceTimeoutMs, 90000);
  assert.equal(options.markdownOutput, "reports/ats-evidence.md");
  assert.equal(options.json, true);
});

test("estimate decision buckets separate pass candidates and blocked sources", () => {
  assert.equal(classifyEstimateDecision({
    configured_targets: 454,
    exitCode: 0,
    ok: true,
    targets_scanned: 25,
    rows_fetched: 25,
    rows_parsed: 557,
    clean_candidates: 557,
    net_new_clean_public_candidates: 557,
    quarantine_count: 0,
    rejected_count: 0,
    quality_risk_of_net_new_rows: { no_geo_no_remote: 0, missing_any_geo: 139, weak_unknown_remote: 127 },
    classifications: {}
  }), "candidate_after_full_inventory");

  assert.equal(classifyEstimateDecision({
    configured_targets: 169,
    exitCode: 0,
    ok: true,
    targets_scanned: 25,
    rows_fetched: 20,
    rows_parsed: 1896,
    clean_candidates: 1862,
    net_new_clean_public_candidates: 1861,
    quarantine_count: 34,
    rejected_count: 0,
    quality_risk_of_net_new_rows: { no_geo_no_remote: 0, missing_any_geo: 1861, weak_unknown_remote: 1827 },
    classifications: { source_fetch_failure: 5 }
  }), "needs_geo_remote_fix");

  assert.equal(classifyEstimateDecision({
    configured_targets: 0,
    exitCode: 0,
    ok: true,
    targets_scanned: 0
  }), "needs_virtual_targets");
});

test("markdown evidence snapshots are bounded review artifacts", () => {
  const markdown = buildMarkdownEvidenceSnapshot({
    source: "jobvite",
    generated_at: "2026-05-18T09:00:00.000Z",
    samples: [
      {
        source_url: "https://jobs.jobvite.com/acme/jobs",
        canonical_url: "https://jobs.jobvite.com/acme/job/o123",
        source_job_id: "o123",
        title: "Support Engineer",
        company: "Acme",
        location: "Remote - United States",
        city: "",
        region: "North America",
        country: "United States",
        remote_type: "remote",
        posting_date: "2026-05-17",
        posted_at_epoch: 1778976000,
        parser_version: "source-jobvite-v1",
        confidence: 0.75,
        quality_score: 75,
        classification: "net_new_clean_public_candidate",
        reason: "accepted_candidate_not_found_in_existing_public_rows",
        description_plain: "A".repeat(900)
      }
    ]
  }, { maxDescriptionLength: 120 });

  assert.match(markdown, /## jobvite \/ o123/);
  assert.match(markdown, /- Source URL: https:\/\/jobs\.jobvite\.com\/acme\/jobs/);
  assert.match(markdown, /- Parsed country: United States/);
  assert.match(markdown, /- Remote evidence: remote/);
  assert.match(markdown, /- Quality gate: net_new_clean_public_candidate/);
  assert.ok(markdown.length < 1400);
});

test("true new clean candidate is counted", () => {
  const seen = { sourceJobKeys: new Set(), urlKeys: new Set() };
  const candidate = cleanCandidate({ canonical_url: "https://jobs.lever.co/acme/new-clean", source_job_id: "new-clean" });
  const result = classifyCandidateAgainstExisting(candidate, buildExistingLookup([]), seen);
  assert.equal(result.classification, "net_new_clean_public_candidate");
  markCandidateSeen(candidate, seen);
  const duplicate = classifyCandidateAgainstExisting(candidate, buildExistingLookup([]), seen);
  assert.equal(duplicate.classification, "already_indexable_duplicate");
});

console.log("ats estimate net-new tests passed");
