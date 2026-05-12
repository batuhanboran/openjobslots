const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { hashPayload, stableStringify, writePostingCache } = require("./cache");
const { ensureIngestionTables } = require("./schema");

test("stableStringify produces stable object key ordering", () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));
});

test("hashPayload changes when normalized posting changes", () => {
  const first = hashPayload({
    company_name: "Acme",
    position_name: "Engineer",
    job_posting_url: "https://example.com/job/1"
  });
  const second = hashPayload({
    company_name: "Acme",
    position_name: "Senior Engineer",
    job_posting_url: "https://example.com/job/1"
  });

  assert.notEqual(first, second);
});

test("unchanged posting cache payload touches freshness without rewriting parser fields", async () => {
  const db = await open({
    filename: ":memory:",
    driver: sqlite3.Database
  });
  try {
    await ensureIngestionTables(db);
    const posting = {
      ats_key: "greenhouse",
      company_name: "Acme",
      position_name: "Support Engineer",
      job_posting_url: "https://example.com/jobs/1",
      location: "Remote - Turkey",
      posting_date: "2026-05-08"
    };

    const first = await writePostingCache(db, posting, {
      nowEpoch: 100,
      parserVersion: "parser-v1",
      sourceCompanyUrl: "https://boards.example.com/acme",
      validation: { ok: true, error: "" }
    });
    const second = await writePostingCache(db, posting, {
      nowEpoch: 200,
      parserVersion: "parser-v1",
      sourceCompanyUrl: "https://boards.example.com/acme",
      validation: { ok: true, error: "" }
    });
    const row = await db.get("SELECT first_seen_epoch, last_seen_epoch, parser_version, raw_payload_hash FROM posting_cache WHERE canonical_url = ?;", [
      "https://example.com/jobs/1"
    ]);

    assert.equal(first.cached, true);
    assert.equal(first.changed, true);
    assert.equal(second.cached, true);
    assert.equal(second.changed, false);
    assert.equal(Number(row.first_seen_epoch), 100);
    assert.equal(Number(row.last_seen_epoch), 200);
    assert.equal(row.parser_version, "parser-v1");
    assert.equal(row.raw_payload_hash, first.hash);
  } finally {
    await db.close();
  }
});

test("changed posting cache payload preserves first seen and updates normalized metadata", async () => {
  const db = await open({
    filename: ":memory:",
    driver: sqlite3.Database
  });
  try {
    await ensureIngestionTables(db);
    const base = {
      ats_key: "lever",
      company_name: "Acme",
      position_name: "Engineer",
      job_posting_url: "https://example.com/jobs/2"
    };

    await writePostingCache(db, base, {
      nowEpoch: 100,
      parserVersion: "parser-v1",
      validation: { ok: true, error: "" }
    });
    const changed = await writePostingCache(db, {
      ...base,
      position_name: "Senior Engineer"
    }, {
      nowEpoch: 300,
      parserVersion: "parser-v2",
      validation: { ok: true, error: "" }
    });
    const row = await db.get("SELECT first_seen_epoch, last_seen_epoch, position_name, parser_version FROM posting_cache WHERE canonical_url = ?;", [
      "https://example.com/jobs/2"
    ]);

    assert.equal(changed.changed, true);
    assert.equal(Number(row.first_seen_epoch), 100);
    assert.equal(Number(row.last_seen_epoch), 300);
    assert.equal(row.position_name, "Senior Engineer");
    assert.equal(row.parser_version, "parser-v2");
  } finally {
    await db.close();
  }
});

test("posting cache stores quarantined visibility evidence", async () => {
  const db = await open({
    filename: ":memory:",
    driver: sqlite3.Database
  });
  try {
    await ensureIngestionTables(db);
    await writePostingCache(db, {
      ats_key: "fixture",
      company_name: "Acme",
      position_name: "Engineer",
      job_posting_url: "https://example.com/jobs/quarantine"
    }, {
      nowEpoch: 100,
      parserVersion: "parser-v1",
      validation: {
        ok: false,
        status: "quarantined",
        error: "no_geo_no_remote",
        reason_codes: ["no_geo_no_remote"],
        evidence: { country: { present: false } },
        retry_detail_refetch_eligible: true
      }
    });
    const row = await db.get("SELECT validation_status, validation_error, raw_metadata FROM posting_cache WHERE canonical_url = ?;", [
      "https://example.com/jobs/quarantine"
    ]);
    const metadata = JSON.parse(row.raw_metadata);

    assert.equal(row.validation_status, "quarantined");
    assert.equal(row.validation_error, "no_geo_no_remote");
    assert.deepEqual(metadata.reason_codes, ["no_geo_no_remote"]);
    assert.equal(metadata.retry_detail_refetch_eligible, true);
    assert.equal(metadata.evidence.country.present, false);
  } finally {
    await db.close();
  }
});
