const assert = require("node:assert");
const test = require("node:test");

const {
  aliasActionsFromPlan,
  buildAliasConflictReport,
  parseArgs
} = require("./report-ats-alias-conflicts");

function samplePlan() {
  return {
    plan_hash: "alias123",
    targets: [
      {
        ats_key: "adp_workforcenow",
        actions: [
          {
            type: "canonicalize_legacy_alias",
            ats_key: "adp_workforcenow",
            legacy_alias_rows: ["adpworkforcenow"],
            tables_to_review: ["companies", "company_sync_state", "source_payload_shapes", "postings"]
          }
        ]
      },
      {
        ats_key: "workday",
        actions: [{ type: "reset_source_protection_to_canary", ats_key: "workday" }]
      }
    ]
  };
}

function makePool({ conflicts = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (/information_schema\.tables/i.test(text)) return { rows: [{ exists: true }] };
      if (/COUNT\(\*\)::int AS count FROM companies WHERE ats_key/i.test(text)) {
        return { rows: [{ count: params[0] === "adpworkforcenow" ? 3 : 2 }] };
      }
      if (/COUNT\(\*\)::int AS count FROM company_sync_state WHERE ats_key/i.test(text)) {
        return { rows: [{ count: params[0] === "adpworkforcenow" ? 2 : 1 }] };
      }
      if (/COUNT\(\*\)::int AS count FROM source_payload_shapes WHERE ats_key/i.test(text)) {
        return { rows: [{ count: params[0] === "adpworkforcenow" ? 1 : 1 }] };
      }
      if (/COUNT\(\*\)::int AS count FROM postings WHERE ats_key/i.test(text)) return { rows: [{ count: 4 }] };
      if (/FROM companies legacy/i.test(text)) return { rows: conflicts ? [{ url_string: "https://jobs.example.test" }] : [] };
      if (/FROM company_sync_state legacy/i.test(text)) return { rows: [] };
      if (/FROM source_payload_shapes legacy/i.test(text)) return { rows: conflicts ? [{ parser_version: "v1" }] : [] };
      return { rows: [] };
    }
  };
}

test("parseArgs accepts source filters and output path", () => {
  const options = parseArgs(["--json", "--source=adp_workforcenow", "--output=out.json"]);
  assert.equal(options.json, true);
  assert.deepEqual(options.sourceFilters, ["adp_workforcenow"]);
  assert.equal(options.output, "out.json");
});

test("aliasActionsFromPlan selects only canonicalization actions", () => {
  const actions = aliasActionsFromPlan(samplePlan(), { sourceFilters: ["adp_workforcenow"] });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "canonicalize_legacy_alias");
});

test("buildAliasConflictReport passes when unique-key conflicts are absent", async () => {
  const pool = makePool();
  const report = await buildAliasConflictReport({
    plan: samplePlan(),
    options: { sourceFilters: ["adp_workforcenow"] },
    pool
  });
  assert.equal(report.ok, true);
  assert.equal(report.read_only, true);
  assert.equal(report.legacy_rows_total, 10);
  assert.equal(report.conflict_count, 0);
});

test("buildAliasConflictReport fails when alias rows would collide with canonical rows", async () => {
  const pool = makePool({ conflicts: true });
  const report = await buildAliasConflictReport({
    plan: samplePlan(),
    options: { sourceFilters: ["adp_workforcenow"] },
    pool
  });
  assert.equal(report.ok, false);
  assert.equal(report.conflict_count, 2);
  const companies = report.reports[0].tables.find((item) => item.table === "companies");
  assert.deepEqual(companies.conflict_keys, [{ url_string: "https://jobs.example.test" }]);
});
