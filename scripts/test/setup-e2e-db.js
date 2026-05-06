const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const repoRoot = path.resolve(__dirname, "..", "..");
const fixtureSource = path.join(repoRoot, "jobs.db");
const preferredTestRoot = process.env.OPENPOSTINGS_TEST_ROOT || "C:\\tmp\\openpostings-test";
const fallbackTestRoot = path.join(repoRoot, ".tmp", "openpostings-test");
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
    if (process.env.OPENPOSTINGS_TEST_ROOT || process.env.DB_PATH) {
      throw error;
    }
    testRoot = fallbackTestRoot;
    testDbPath = path.join(testRoot, "jobs.db");
    fs.mkdirSync(testRoot, { recursive: true });
    console.warn(`Unable to create ${preferredTestRoot}; using isolated fallback ${testRoot}`);
  }
}

function switchToFallback(error) {
  if (process.env.OPENPOSTINGS_TEST_ROOT || process.env.DB_PATH) {
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

  fs.copyFileSync(fixtureSource, testDbPath);

  const db = await open({
    filename: testDbPath,
    driver: sqlite3.Database
  });

  try {
    await db.exec("PRAGMA journal_mode = WAL;");
    await ensurePostingsColumns(db);
    await ensureReferenceTables(db);
    await seedFixtureRows(db);
  } finally {
    await db.close();
  }

  console.log(`Prepared isolated OpenPostings test DB at ${testDbPath}`);
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
  const postings = [
    {
      company_name: "QA Greenhouse Turkey",
      position_name: "Turkish Customer Success Specialist",
      job_posting_url: "https://boards.greenhouse.io/openpostingsqa/jobs/1001",
      location: "Istanbul, Türkiye",
      posting_date: "2026-05-06T08:00:00+03:00"
    },
    {
      company_name: "QA Lever Remote",
      position_name: "Remote Backend Engineer",
      job_posting_url: "https://jobs.lever.co/openpostingsqa/remote-backend-engineer",
      location: "Remote - EMEA",
      posting_date: "2026-05-05T12:00:00Z"
    },
    {
      company_name: "QA Ashby Europe",
      position_name: "Platform Engineer",
      job_posting_url: "https://jobs.ashbyhq.com/openpostingsqa/ashby-platform-engineer",
      location: "Ankara, Turkey",
      posting_date: "2026-05-04"
    }
  ];

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
        now
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
