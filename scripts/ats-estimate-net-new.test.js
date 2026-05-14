const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildExistingLookup,
  classifyCandidateAgainstExisting,
  classifyNonAccepted,
  markCandidateSeen,
  summarizeInventory
} = require("../server/ingestion/netNewEstimator");

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
