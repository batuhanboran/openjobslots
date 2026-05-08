const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const {
  classifyIngestionError,
  computeRetryEpoch,
  createRunCounters,
  dedupeValidPosting,
  extractHttpStatus,
  incrementHttpStatusCount,
  isSqliteBusyError,
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
  assert.equal(classifyIngestionError(new Error("placeholder company_name")), "source_discovery");
  assert.equal(classifyIngestionError(new Error("Unexpected token < in JSON")), "parser_parse");
  assert.equal(classifyIngestionError(new Error("iCIMS request failed (502)")), "fetch");
  assert.equal(
    classifyIngestionError({ message: "Dayforce missing collector", ingestionErrorType: "parser_adapter_not_implemented" }),
    "parser_adapter_not_implemented"
  );
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

test("http status metrics are extracted and counted", () => {
  const counters = createRunCounters();
  incrementHttpStatusCount(counters, extractHttpStatus(new Error("request failed (429)")));
  incrementHttpStatusCount(counters, extractHttpStatus({ statusCode: 502 }));
  incrementHttpStatusCount(counters, extractHttpStatus(new Error("no status")));

  assert.deepEqual(counters.httpStatusCounts, {
    429: 1,
    502: 1
  });
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
