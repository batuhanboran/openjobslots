const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { ensureIngestionTables } = require("../../server/ingestion/schema");

const repoRoot = path.resolve(__dirname, "..", "..");
const fixtureSource = path.join(repoRoot, "jobs.db");
const preferredTestRoot = process.env.OPENJOBSLOTS_TEST_ROOT || "C:\\tmp\\openjobslots-test";
const fallbackTestRoot = path.join(repoRoot, ".tmp", "openjobslots-test");
let testRoot = preferredTestRoot;
let testDbPath = process.env.DB_PATH || path.join(testRoot, "jobs.db");

function ensureTestRoot() {
  if (process.env.DB_PATH) {
    fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
    return;
  }

  try {
    fs.mkdirSync(testRoot, { recursive: true });
  } catch (error) {
    if (process.env.OPENJOBSLOTS_TEST_ROOT || process.env.DB_PATH) {
      throw error;
    }
    testRoot = fallbackTestRoot;
    testDbPath = path.join(testRoot, "jobs.db");
    fs.mkdirSync(testRoot, { recursive: true });
    console.warn(`Unable to create ${preferredTestRoot}; using isolated fallback ${testRoot}`);
  }
}

function switchToFallback(error) {
  if (process.env.OPENJOBSLOTS_TEST_ROOT || process.env.DB_PATH) {
    throw error;
  }
  testRoot = fallbackTestRoot;
  testDbPath = path.join(testRoot, "jobs.db");
  fs.mkdirSync(testRoot, { recursive: true });
  console.warn(`Unable to use ${preferredTestRoot}; using isolated fallback ${testRoot}`);
}

async function main() {
  ensureTestRoot();
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      const filePath = `${testDbPath}${suffix}`;
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  } catch (error) {
    switchToFallback(error);
    for (const suffix of ["", "-wal", "-shm"]) {
      const filePath = `${testDbPath}${suffix}`;
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  }

  if (fs.existsSync(fixtureSource)) {
    fs.copyFileSync(fixtureSource, testDbPath);
  } else {
    await createMinimalFixtureDb(testDbPath);
  }

  const db = await open({
    filename: testDbPath,
    driver: sqlite3.Database
  });

  try {
    await db.exec("PRAGMA journal_mode = WAL;");
    await ensurePostingsColumns(db);
    await ensureIngestionTables(db);
    await ensureReferenceTables(db);
    await seedFixtureRows(db);
    await seedDiagnosticsRows(db);
  } finally {
    await db.close();
  }

  console.log(`Prepared isolated OpenJobSlots test DB at ${testDbPath}`);
}

async function createMinimalFixtureDb(targetPath) {
  const db = await open({
    filename: targetPath,
    driver: sqlite3.Database
  });

  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        url_string TEXT NOT NULL,
        ATS_name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS Postings (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        position_name TEXT NOT NULL,
        job_posting_url TEXT NOT NULL UNIQUE,
        location TEXT,
        posting_date TEXT,
        first_seen_epoch INTEGER,
        last_seen_epoch INTEGER,
        source_job_id TEXT NOT NULL DEFAULT '',
        parser_version TEXT NOT NULL DEFAULT 'legacy-adapter-v1',
        confidence REAL NOT NULL DEFAULT 0,
        quality_score INTEGER NOT NULL DEFAULT 0,
        quality_flags TEXT NOT NULL DEFAULT '[]',
        rejection_reason TEXT NOT NULL DEFAULT '',
        hidden INTEGER NOT NULL DEFAULT 0,
        hidden_at_epoch INTEGER
      );
    `);
  } finally {
    await db.close();
  }
}

async function addColumnIfMissing(db, tableName, columnName, ddl) {
  const columns = await db.all(`PRAGMA table_info('${tableName}');`);
  if (!columns.some((column) => String(column.name) === columnName)) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${ddl};`);
  }
}

async function ensurePostingsColumns(db) {
  await addColumnIfMissing(db, "Postings", "location", "location TEXT");
  await addColumnIfMissing(db, "Postings", "first_seen_epoch", "first_seen_epoch INTEGER");
  await addColumnIfMissing(db, "Postings", "hidden", "hidden INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "Postings", "hidden_at_epoch", "hidden_at_epoch INTEGER");
  await addColumnIfMissing(db, "Postings", "source_job_id", "source_job_id TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "Postings", "parser_version", "parser_version TEXT NOT NULL DEFAULT 'legacy-adapter-v1'");
  await addColumnIfMissing(db, "Postings", "confidence", "confidence REAL NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "Postings", "quality_score", "quality_score INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "Postings", "quality_flags", "quality_flags TEXT NOT NULL DEFAULT '[]'");
  await addColumnIfMissing(db, "Postings", "rejection_reason", "rejection_reason TEXT NOT NULL DEFAULT ''");
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_postings_job_posting_url
      ON Postings(job_posting_url);
  `);
}

async function ensureReferenceTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS job_position_industry (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      job_title TEXT NOT NULL,
      normalized_job_title TEXT NOT NULL,
      industry_key TEXT NOT NULL,
      industry_label TEXT NOT NULL,
      matched_rules TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      rule_version TEXT NOT NULL DEFAULT 'test-fixture-v1',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_job_position_industry_key
      ON job_position_industry(industry_key);
  `);
}

async function seedFixtureRows(db) {
  const now = Math.floor(Date.now() / 1000);
  const companies = [
    {
      company_name: "QA Greenhouse Turkey",
      url_string: "https://boards.greenhouse.io/openjobslotsqa",
      ATS_name: "greenhouse"
    },
    {
      company_name: "QA Lever Remote",
      url_string: "https://jobs.lever.co/openjobslotsqa",
      ATS_name: "lever"
    },
    {
      company_name: "QA Ashby Europe",
      url_string: "https://jobs.ashbyhq.com/openjobslotsqa",
      ATS_name: "ashby"
    }
  ];
  const postings = [
    {
      company_name: "QA Greenhouse Turkey",
      position_name: "Turkish Customer Success Specialist",
      job_posting_url: "https://boards.greenhouse.io/openjobslotsqa/jobs/1001",
      location: "Istanbul, Türkiye",
      posting_date: "2026-05-06T08:00:00+03:00"
    },
    {
      company_name: "QA Lever Remote",
      position_name: "Remote Backend Engineer",
      job_posting_url: "https://jobs.lever.co/openjobslotsqa/remote-backend-engineer",
      location: "Remote - EMEA",
      posting_date: "2026-05-05T12:00:00Z",
      last_seen_epoch: now - 10 * 24 * 60 * 60
    },
    {
      company_name: "QA Ashby Europe",
      position_name: "Platform Engineer",
      job_posting_url: "https://jobs.ashbyhq.com/openjobslotsqa/ashby-platform-engineer",
      location: "Ankara, Turkey",
      posting_date: "2026-05-04"
    }
  ];
  for (let index = 1; index <= 28; index += 1) {
    const isTurkey = index % 3 === 0;
    const isStale = index % 7 === 0;
    postings.push({
      company_name: isTurkey ? "QA Greenhouse Turkey" : "QA Lever Remote",
      position_name: `Remote QA Engineer ${index}`,
      job_posting_url: isTurkey
        ? `https://boards.greenhouse.io/openjobslotsqa/jobs/scroll-${index}`
        : `https://jobs.lever.co/openjobslotsqa/scroll-${index}`,
      location: isTurkey ? "Istanbul, Turkey" : "Remote - EMEA",
      posting_date: `2026-05-${String(Math.max(1, 24 - (index % 20))).padStart(2, "0")}`,
      last_seen_epoch: isStale ? now - 10 * 24 * 60 * 60 : now
    });
  }

  for (const company of companies) {
    await db.run(
      `
        INSERT INTO companies (
          company_name,
          url_string,
          ATS_name
        ) VALUES (?, ?, ?);
      `,
      [
        company.company_name,
        company.url_string,
        company.ATS_name
      ]
    );
  }

  for (const posting of postings) {
    await db.run(
      `
        INSERT INTO Postings (
          company_name,
          position_name,
          job_posting_url,
          location,
          posting_date,
          first_seen_epoch,
          last_seen_epoch,
          hidden
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(job_posting_url) DO UPDATE SET
          company_name = excluded.company_name,
          position_name = excluded.position_name,
          location = excluded.location,
          posting_date = excluded.posting_date,
          first_seen_epoch = COALESCE(Postings.first_seen_epoch, excluded.first_seen_epoch),
          last_seen_epoch = excluded.last_seen_epoch,
          hidden = 0;
      `,
      [
        posting.company_name,
        posting.position_name,
        posting.job_posting_url,
        posting.location,
        posting.posting_date,
        now,
        Number(posting.last_seen_epoch || now)
      ]
    );
  }

  await db.run(
    `
      INSERT INTO job_position_industry (
        job_title,
        normalized_job_title,
        industry_key,
        industry_label,
        matched_rules,
        confidence_score,
        rule_version,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'));
    `,
    ["Backend Engineer", "backend engineer", "technology", "Technology", "[\"test-fixture\"]", 0.95, "test-fixture-v1"]
  );
}

async function seedDiagnosticsRows(db) {
  const now = Math.floor(Date.now() / 1000);
  const run = await db.run(
    `
      INSERT INTO ingestion_runs (
        status,
        started_at_epoch,
        finished_at_epoch,
        total_targets,
        success_count,
        failure_count,
        rejected_count,
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `,
    ["completed_with_errors", now - 60, now - 30, 1, 0, 1, 1, "Parser rejected missing title"]
  );
  await db.run(
    `
      INSERT INTO ingestion_run_errors (
        run_id,
        ats_key,
        company_url,
        company_name,
        error_type,
        error_message,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'));
    `,
    [
      Number(run.lastID || 0),
      "careerplug",
      "https://example.careerplug.com/jobs",
      "QA CareerPlug Bad",
      "parser_validation",
      "missing required title"
    ]
  );
  await db.run(
    `
      INSERT INTO posting_cache (
        canonical_url,
        ats_key,
        company_name,
        position_name,
        location,
        posting_date,
        raw_payload_hash,
        source_company_url,
        first_seen_epoch,
        last_seen_epoch,
        parser_version,
        quality_score,
        quality_flags,
        rejection_reason,
        validation_status,
        validation_error,
        raw_metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_url) DO UPDATE SET
        validation_status = excluded.validation_status,
        validation_error = excluded.validation_error,
        rejection_reason = excluded.rejection_reason,
        quality_flags = excluded.quality_flags,
        updated_at = datetime('now');
    `,
    [
      "https://example.careerplug.com/jobs/bad-title",
      "careerplug",
      "QA CareerPlug Bad",
      "",
      "",
      null,
      "test-raw-hash",
      "https://example.careerplug.com/jobs",
      now,
      now,
      "careerplug-parser-v1",
      0,
      JSON.stringify(["missing_title", "rejected"]),
      "missing required title",
      "invalid",
      "missing required title",
      "{}"
    ]
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
