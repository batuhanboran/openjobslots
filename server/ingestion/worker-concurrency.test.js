const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { classifyIngestionError, withWriteLock } = require("./worker");

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
