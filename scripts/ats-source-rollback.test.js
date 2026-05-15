const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseRollbackArgs,
  planRollbackFromChanges,
  runSourceRollback
} = require("../server/ingestion/sourceRollback");

function row(overrides = {}) {
  return {
    canonical_url: "https://jobs.example.com/1",
    ats_key: "applytojob",
    source_job_id: "job-1",
    company_name: "Acme",
    position_name: "Engineer",
    hidden: false,
    ...overrides
  };
}

test("rollback removes rows created by a source run", () => {
  const plan = planRollbackFromChanges([
    {
      id: 1,
      ats_key: "applytojob",
      canonical_url: "https://jobs.example.com/1",
      before_posting: null,
      after_posting: row(),
      before_cache: null,
      after_cache: row()
    }
  ], "applytojob");
  assert.equal(plan.ok, true);
  assert.equal(plan.created_rows_to_delete, 1);
  assert.equal(plan.cache_rows_to_delete, 1);
  assert.equal(plan.outbox_deletes, 1);
  assert.equal(plan.operations.some((operation) => operation.type === "delete_created_public_row"), true);
});

test("rollback restores previous values for updated rows", () => {
  const plan = planRollbackFromChanges([
    {
      id: 2,
      ats_key: "applytojob",
      canonical_url: "https://jobs.example.com/2",
      before_posting: row({ canonical_url: "https://jobs.example.com/2", city: "Old City" }),
      after_posting: row({ canonical_url: "https://jobs.example.com/2", city: "New City" }),
      before_cache: row({ canonical_url: "https://jobs.example.com/2", city: "Old City" }),
      after_cache: row({ canonical_url: "https://jobs.example.com/2", city: "New City" })
    }
  ], "applytojob");
  assert.equal(plan.ok, true);
  assert.equal(plan.updated_rows_to_restore, 1);
  assert.equal(plan.cache_rows_to_restore, 1);
  assert.equal(plan.outbox_upserts, 1);
  assert.equal(plan.operations.some((operation) => operation.type === "restore_updated_public_row"), true);
});

test("rollback refuses non-target source changes", () => {
  const plan = planRollbackFromChanges([
    {
      id: 3,
      ats_key: "breezy",
      canonical_url: "https://jobs.example.com/3",
      before_posting: null,
      after_posting: row({ ats_key: "breezy", canonical_url: "https://jobs.example.com/3" })
    }
  ], "applytojob");
  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.code === "non_target_source_change"));
});

test("rollback refuses production command without confirmation", () => {
  const options = parseRollbackArgs(["--run-id=123", "--source=applytojob"], {});
  assert.equal(options.confirmProduction, false);
});

test("rollback command throws without production confirmation", async () => {
  await assert.rejects(
    () => runSourceRollback({ runId: 123, source: "applytojob", pool: {}, confirmProduction: false }, {}),
    /--confirm-production/
  );
});

console.log("ats source rollback tests passed");
