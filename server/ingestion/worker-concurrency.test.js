const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const {
  classifyIngestionError,
  computeFailureRetryEpoch,
  computeRetryEpoch,
  createRunCounters,
  dedupeValidPosting,
  extractHttpStatus,
  incrementHttpStatusCount,
  isSqliteBusyError,
  markFetchRateLimitCooldown,
  recordDueTargetsByAts,
  recordSelectedTarget,
  recordSkippedTarget,
  recordTargetOutcome,
  sanitizeLogMessage,
  sanitizeUrlForLog,
  selectPostgresDueTargets,
  sortDueTargetCandidates,
  withTransientWriteRetry,
  withWriteLock
} = require("./worker");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("worker write lock serializes concurrent sqlite transactions", async () => {
  const db = await open({
    filename: ":memory:",
    driver: sqlite3.Database
  });

  try {
    await db.exec("CREATE TABLE writes (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL);");

    async function transactionalWrite(label) {
      await withWriteLock(async () => {
        await db.exec("BEGIN TRANSACTION;");
        try {
          await sleep(15);
          await db.run("INSERT INTO writes (label) VALUES (?);", [label]);
          await db.exec("COMMIT;");
        } catch (error) {
          try {
            await db.exec("ROLLBACK;");
          } catch {
            // Ignore rollback when BEGIN itself failed.
          }
          throw error;
        }
      });
    }

    await Promise.all([transactionalWrite("first"), transactionalWrite("second")]);
    const row = await db.get("SELECT COUNT(*) AS count FROM writes;");
    assert.equal(Number(row?.count || 0), 2);
  } finally {
    await db.close();
  }
});

test("ingestion error classifier separates parser attention from fetch failures", () => {
  assert.equal(classifyIngestionError(new Error("missing job_posting_url")), "parser_validation");
  assert.equal(classifyIngestionError(new Error("source_disabled_by_threshold")), "source_disabled_by_threshold");
  assert.equal(classifyIngestionError(new Error("source_auto_disabled")), "source_quality");
  assert.equal(classifyIngestionError(new Error("source cooldown active")), "cooldown");
  assert.equal(classifyIngestionError(Object.assign(new Error("HTTP 429"), { status: 429 })), "rate_limit");
  assert.equal(classifyIngestionError(Object.assign(new Error("HTTP 401"), { status: 401 })), "auth");
  assert.equal(classifyIngestionError(Object.assign(new Error("source fetch failed with HTTP 404"), { status: 404 })), "source_quality");
  assert.equal(
    classifyIngestionError({ message: "source fetch failed with HTTP 410", ingestionErrorType: "fetch", status: 410 }),
    "source_quality"
  );
  assert.equal(classifyIngestionError(Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })), "timeout");
  assert.equal(classifyIngestionError(Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" })), "network");
  assert.equal(classifyIngestionError(new Error("empty payload returned by source")), "empty_payload");
  assert.equal(classifyIngestionError(new Error("Unexpected token < in JSON")), "invalid_shape");
  assert.equal(classifyIngestionError(new Error("Breezy public portal returned no parseable postings")), "no_jobs");
  assert.equal(
    classifyIngestionError({ message: "Dayforce missing collector", ingestionErrorType: "parser_adapter_not_implemented" }),
    "parser_adapter_not_implemented"
  );
});

test("worker observability counters expose source-safe run summary fields", () => {
  const counters = createRunCounters();

  recordDueTargetsByAts(counters, [
    { ats_key: "bamboohr", due_count: 5 },
    { ats_key: "applytojob", count: 3 }
  ]);
  recordSelectedTarget(counters, { atsKey: "bamboohr" });
  recordSkippedTarget(counters, "applytojob", "source_daily_budget");
  recordTargetOutcome(counters, { atsKey: "bamboohr" }, "success", "ok");
  recordTargetOutcome(counters, { atsKey: "applytojob" }, "failure", new Error("HTTP 429"));

  assert.deepEqual(counters.dueByAts, { bamboohr: 5, applytojob: 3 });
  assert.deepEqual(counters.selectedByAts, { bamboohr: 1 });
  assert.deepEqual(counters.skippedByReason, { source_daily_budget: 1 });
  assert.deepEqual(counters.successByReason, { ok: 1 });
  assert.deepEqual(counters.successByAts, { bamboohr: 1 });
  assert.deepEqual(counters.failureByReason, { rate_limit: 1 });
  assert.deepEqual(counters.failureByAts, { applytojob: 1 });
  assert.deepEqual(counters.failureByAtsAndReason, { applytojob: { rate_limit: 1 } });
});

test("worker log sanitizers strip query strings and keep messages bounded", () => {
  assert.equal(
    sanitizeUrlForLog("https://example.com/jobs/search?token=secret&email=user@example.com#private"),
    "https://example.com/jobs/search"
  );
  const sanitized = sanitizeLogMessage(
    "failed https://example.com/jobs/search?token=secret&email=user@example.com with body <html>bad</html>",
    200
  );

  assert.equal(sanitized.includes("token=secret"), false);
  assert.equal(sanitized.includes("email=user@example.com"), false);
  assert.equal(sanitized.includes("<html>"), false);
  assert.ok(sanitized.length <= 200);
});

test("sqlite write retry observes transient busy failures", async () => {
  let attempts = 0;
  let busyRetries = 0;
  const result = await withTransientWriteRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("SQLITE_BUSY: database is locked");
      error.code = "SQLITE_BUSY";
      throw error;
    }
    return "ok";
  }, {
    onBusyRetry: () => {
      busyRetries += 1;
    }
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.equal(busyRetries, 1);
  assert.equal(isSqliteBusyError(Object.assign(new Error("database is busy"), { code: "SQLITE_BUSY" })), true);
});

test("retry backoff cools down after repeated company failures", () => {
  const base = 1_000_000;
  const early = computeRetryEpoch(base, 2);
  const cooled = computeRetryEpoch(base, 8);

  assert.ok(early > base);
  assert.ok(early < base + 24 * 60 * 60);
  assert.ok(cooled >= base + 7 * 24 * 60 * 60);
});

test("no-jobs failures use daily cooldown without being counted as success", () => {
  const base = 1_000_000;
  const noJobsRetry = computeFailureRetryEpoch(base, 1, "no_jobs");
  const normalRetry = computeFailureRetryEpoch(base, 1, "network");

  assert.ok(noJobsRetry >= base + 24 * 60 * 60);
  assert.equal(normalRetry, computeRetryEpoch(base, 1));
});

test("repeated no-jobs failures progressively back off before the long cooldown", () => {
  const base = 1_000_000;
  const firstNoJobsRetry = computeFailureRetryEpoch(base, 1, "no_jobs");
  const secondNoJobsRetry = computeFailureRetryEpoch(base, 2, "no_jobs");
  const thirdNoJobsRetry = computeFailureRetryEpoch(base, 3, "no_jobs");

  assert.equal(secondNoJobsRetry, base + 2 * (firstNoJobsRetry - base));
  assert.equal(thirdNoJobsRetry, base + 3 * (firstNoJobsRetry - base));
  assert.ok(thirdNoJobsRetry < computeRetryEpoch(base, 8));
});

test("repeated no-jobs failures enter the long failure cooldown", () => {
  const base = 1_000_000;
  const repeatedNoJobsRetry = computeFailureRetryEpoch(base, 8, "no_jobs");

  assert.equal(repeatedNoJobsRetry, computeRetryEpoch(base, 8));
});

test("http status metrics are extracted and counted", () => {
  const counters = createRunCounters();
  incrementHttpStatusCount(counters, extractHttpStatus(new Error("request failed (429)")));
  incrementHttpStatusCount(counters, extractHttpStatus({ statusCode: 502 }));
  incrementHttpStatusCount(counters, extractHttpStatus(new Error("no status")));

  assert.deepEqual(counters.httpStatusCounts, {
    429: 1,
    502: 1
  });
  assert.deepEqual(counters.httpStatusFamilyCounts, {
    "4xx": 1,
    "5xx": 1
  });
});

test("worker persists ATS cooldown after HTTP 429 fetch errors", async () => {
  const calls = [];
  const store = {
    async markRateLimited(key, waitMs) {
      calls.push({ key, waitMs });
    }
  };

  const marked = await markFetchRateLimitCooldown(
    store,
    { atsKey: "bamboohr", settings: { rateLimitMs: 5000 } },
    Object.assign(new Error("source fetch failed with HTTP 429"), { status: 429 }),
    { fallbackMs: 60000 }
  );

  assert.equal(marked, true);
  assert.deepEqual(calls, [{ key: "bamboohr", waitMs: 60000 }]);
});

test("worker does not persist cooldown for non-rate-limit fetch errors", async () => {
  const store = {
    async markRateLimited() {
      throw new Error("should not persist cooldown");
    }
  };

  const marked = await markFetchRateLimitCooldown(
    store,
    { atsKey: "bamboohr", settings: { rateLimitMs: 5000 } },
    Object.assign(new Error("source fetch failed with HTTP 500"), { status: 500 }),
    { fallbackMs: 60000 }
  );

  assert.equal(marked, false);
});

test("duplicate canonical postings are counted before read-model writes", () => {
  const counters = createRunCounters();
  const seen = new Set();
  const first = dedupeValidPosting({ canonical_url: "https://example.com/jobs/1" }, seen, counters);
  const second = dedupeValidPosting({ job_posting_url: "https://example.com/jobs/1" }, seen, counters);
  const third = dedupeValidPosting({ job_posting_url: "https://example.com/jobs/2" }, seen, counters);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(third, true);
  assert.equal(counters.duplicateCount, 1);
});

test("postgres due target selection over-selects when early sources exhaust daily budget", async () => {
  const rows = [
    {
      id: 1,
      company_name: "Budgeted Bamboo One",
      url_string: "https://budgeted-one.bamboohr.com/careers",
      ats_key: "bamboohr",
      protection_status: "normal",
      default_ttl_seconds: 3600,
      rate_limit_ms: 0,
      next_sync_epoch: 1
    },
    {
      id: 2,
      company_name: "Budgeted Bamboo Two",
      url_string: "https://budgeted-two.bamboohr.com/careers",
      ats_key: "bamboohr",
      protection_status: "normal",
      default_ttl_seconds: 3600,
      rate_limit_ms: 0,
      next_sync_epoch: 2
    },
    {
      id: 3,
      company_name: "Healthy ApplyToJob",
      url_string: "https://healthy.applytojob.com/apply",
      ats_key: "applytojob",
      protection_status: "normal",
      default_ttl_seconds: 3600,
      rate_limit_ms: 0,
      next_sync_epoch: 3
    },
    {
      id: 4,
      company_name: "Healthy Breezy",
      url_string: "https://healthy.breezy.hr",
      ats_key: "breezy",
      protection_status: "normal",
      default_ttl_seconds: 3600,
      rate_limit_ms: 0,
      next_sync_epoch: 4
    }
  ];
  let candidateLimit = 0;
  const pool = {
    async query(sql, params) {
      if (String(sql).includes("due_targets AS")) {
        candidateLimit = Number(params[2] || 0);
        return { rows: rows.slice(0, candidateLimit) };
      }
      if (String(sql).includes("FROM company_sync_state")) {
        return { rows: [{ ats_key: "bamboohr", count: 500 }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const targets = await selectPostgresDueTargets(pool, 2, {
    dueByAtsRows: [
      { ats_key: "bamboohr", due_count: 2 },
      { ats_key: "applytojob", due_count: 1 },
      { ats_key: "breezy", due_count: 1 }
    ],
    adaptiveSignals: {
      bamboohr: { due_count: 2, recent_success_count: 20, recent_failure_count: 0, success_rate_pct: 100 },
      applytojob: { due_count: 1, recent_success_count: 20, recent_failure_count: 0, success_rate_pct: 100 },
      breezy: { due_count: 1, recent_success_count: 20, recent_failure_count: 0, success_rate_pct: 100 }
    }
  });

  assert.ok(candidateLimit > 2, "candidate query should over-select beyond the run target limit");
  assert.deepEqual(targets.map((target) => target.atsKey), ["applytojob", "breezy"]);
});

test("postgres due target query clamps candidates per ATS before global candidate limit", async () => {
  let observedSql = "";
  let observedParams = [];
  const pool = {
    async query(sql, params) {
      if (String(sql).includes("due_targets AS")) {
        observedSql = String(sql);
        observedParams = params;
        return { rows: [] };
      }
      if (String(sql).includes("FROM company_sync_state")) {
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  await selectPostgresDueTargets(pool, 25, {
    dueByAtsRows: [],
    adaptiveSignals: {}
  });

  assert.match(observedSql, /WHERE ats_rank <= \$2/);
  assert.equal(observedParams[1], 25);
  assert.ok(observedParams[2] > observedParams[1]);
});

test("postgres due target query excludes quarantine-only sources from automatic worker selection", async () => {
  let observedSql = "";
  const pool = {
    async query(sql) {
      if (String(sql).includes("due_targets AS")) {
        observedSql = String(sql);
        return { rows: [] };
      }
      if (String(sql).includes("FROM company_sync_state")) {
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  await selectPostgresDueTargets(pool, 25, {
    dueByAtsRows: [],
    adaptiveSignals: {}
  });

  assert.match(observedSql, /NOT IN \('disabled', 'auto_disabled', 'quarantine_only'\)/);
});

test("postgres due target selection uses direct column references without CASE alias mapping", async () => {
  let observedSql = "";
  const pool = {
    async query(sql) {
      if (String(sql).includes("due_targets AS")) {
        observedSql = String(sql);
        return {
          rows: [{
            id: 1,
            company_name: "Legacy ADP MyJobs",
            url_string: "https://myjobs.adp.com/example/cx/job-details",
            ats_key: "adp_myjobs",
            protection_status: "canary_only",
            default_ttl_seconds: 3600,
            rate_limit_ms: 0,
            next_sync_epoch: 1,
            ats_rank: 1
          }]
        };
      }
      if (String(sql).includes("FROM company_sync_state")) {
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const targets = await selectPostgresDueTargets(pool, 1, {
    dueByAtsRows: [{ ats_key: "adp_myjobs", due_count: 1 }],
    adaptiveSignals: {
      adp_myjobs: { due_count: 1, recent_success_count: 20, recent_failure_count: 0, success_rate_pct: 100 }
    }
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].atsKey, "adp_myjobs");
  // Verify direct column references are used (no CASE WHEN alias mapping)
  assert.doesNotMatch(observedSql, /CASE LOWER\(BTRIM\(/);
  assert.match(observedSql, /ON s\.ats_key = c\.ats_key/);
  assert.match(observedSql, /PARTITION BY c\.ats_key/);
  // Verify redundant GROUP BY is removed from sync_state CTE
  assert.doesNotMatch(observedSql, /GROUP BY.*company_url/);
});

test("postgres due target selection uses adaptive caps for parser-risk sources", async () => {
  const rows = [
    {
      id: 1,
      company_name: "Healthy Apply One",
      url_string: "https://healthy-one.applytojob.com/apply",
      ats_key: "applytojob",
      protection_status: "normal",
      default_ttl_seconds: 3600,
      rate_limit_ms: 0,
      next_sync_epoch: 1,
      ats_rank: 1
    },
    {
      id: 2,
      company_name: "Healthy Apply Two",
      url_string: "https://healthy-two.applytojob.com/apply",
      ats_key: "applytojob",
      protection_status: "normal",
      default_ttl_seconds: 3600,
      rate_limit_ms: 0,
      next_sync_epoch: 2,
      ats_rank: 2
    },
    {
      id: 3,
      company_name: "Risky Bamboo One",
      url_string: "https://risky-one.bamboohr.com/careers",
      ats_key: "bamboohr",
      protection_status: "normal",
      default_ttl_seconds: 3600,
      rate_limit_ms: 0,
      next_sync_epoch: 3,
      ats_rank: 1
    },
    {
      id: 4,
      company_name: "Risky Bamboo Two",
      url_string: "https://risky-two.bamboohr.com/careers",
      ats_key: "bamboohr",
      protection_status: "normal",
      default_ttl_seconds: 3600,
      rate_limit_ms: 0,
      next_sync_epoch: 4,
      ats_rank: 2
    },
    {
      id: 5,
      company_name: "Risky Bamboo Three",
      url_string: "https://risky-three.bamboohr.com/careers",
      ats_key: "bamboohr",
      protection_status: "normal",
      default_ttl_seconds: 3600,
      rate_limit_ms: 0,
      next_sync_epoch: 5,
      ats_rank: 3
    }
  ];
  const counters = createRunCounters();
  const pool = {
    async query(sql, params) {
      if (String(sql).includes("due_targets AS")) {
        return { rows: rows.slice(0, Number(params[2] || 0)) };
      }
      if (String(sql).includes("FROM company_sync_state")) {
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const targets = await selectPostgresDueTargets(pool, 4, {
    counters,
    dueByAtsRows: [
      { ats_key: "applytojob", due_count: 2 },
      { ats_key: "bamboohr", due_count: 3 }
    ],
    adaptiveSignals: {
      applytojob: { due_count: 2, recent_success_count: 20, recent_failure_count: 0, success_rate_pct: 100 },
      bamboohr: {
        due_count: 3,
        recent_success_count: 0,
        recent_failure_count: 8,
        success_rate_pct: 0,
        failure_reason_counts: { parser_bug: 8 }
      }
    }
  });

  assert.deepEqual(targets.map((target) => target.atsKey), ["applytojob", "applytojob", "bamboohr"]);
  assert.deepEqual(counters.selectedByAts, { applytojob: 2, bamboohr: 1 });
  assert.deepEqual(counters.skippedByReason, { adaptive_source_cap: 2 });
  assert.equal(counters.adaptiveSourceSelectionByAts.bamboohr.lane, "parser_attention");
});

test("postgres due target sorting prioritizes healthy targets before failure-pressure retries", () => {
  const sorted = sortDueTargetCandidates([
    {
      ats_key: "breezy",
      company_name: "Old Failing Breezy",
      next_sync_epoch: 1,
      protection_status: "normal",
      ats_rank: 1,
      consecutive_failures: 3
    },
    {
      ats_key: "breezy",
      company_name: "Healthy Breezy",
      next_sync_epoch: 100,
      protection_status: "normal",
      ats_rank: 1,
      consecutive_failures: 0
    },
    {
      ats_key: "applytojob",
      company_name: "Healthy Apply",
      next_sync_epoch: 50,
      protection_status: "normal",
      ats_rank: 1,
      consecutive_failures: 0
    }
  ]);

  assert.deepEqual(sorted.map((row) => row.company_name), [
    "Healthy Apply",
    "Healthy Breezy",
    "Old Failing Breezy"
  ]);
});
