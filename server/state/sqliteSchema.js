const fs = require("fs");
const path = require("path");

function missingDependency(name) {
  return () => {
    throw new Error(`createSqliteSchemaRuntime requires dependency: ${name}`);
  };
}

function createDbProxy(getDb) {
  return new Proxy({}, {
    get(_target, property) {
      const handle = getDb();
      if (!handle) {
        throw new Error("SQLite database handle is not initialized");
      }
      const value = handle[property];
      return typeof value === "function" ? value.bind(handle) : value;
    }
  });
}

function createSqliteSchemaRuntime(dependencies = {}) {
  const getDb = typeof dependencies.getDb === "function" ? dependencies.getDb : () => null;
  const db = createDbProxy(getDb);
  const DB_PATH = String(dependencies.dbPath || "").trim();
  const BUNDLED_DB_PATH = String(dependencies.bundledDbPath || "").trim();
  const nowEpochSeconds = typeof dependencies.nowEpochSeconds === "function"
    ? dependencies.nowEpochSeconds
    : missingDependency("nowEpochSeconds");
  const setPostingLocationState = typeof dependencies.setPostingLocationState === "function"
    ? dependencies.setPostingLocationState
    : () => {};

  async function ensureCompaniesTableSchema() {
    const tableInfo = await db.all(`PRAGMA table_info('companies');`);
    const columns = new Set(tableInfo.map((column) => String(column?.name || "")));
  }

  async function hydratePostingLocationMapFromDb() {
    const rows = await db.all(
      `
        SELECT job_posting_url, location
        FROM Postings
        WHERE location IS NOT NULL
          AND TRIM(location) <> '';
      `
    );
  
    const nextPostingLocationByJobUrl = new Map();
    for (const row of rows) {
      const url = String(row?.job_posting_url || "").trim();
      const location = String(row?.location || "").trim();
      if (url && location) {
        nextPostingLocationByJobUrl.set(url, location);
      }
    }
    setPostingLocationState(nextPostingLocationByJobUrl);
  }
  
  async function ensureJobIndustryTables() {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS job_industry_categories (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        industry_key TEXT NOT NULL UNIQUE,
        industry_label TEXT NOT NULL,
        priority INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
  
      CREATE TABLE IF NOT EXISTS job_position_industry (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        job_title TEXT NOT NULL,
        normalized_job_title TEXT NOT NULL UNIQUE,
        industry_key TEXT NOT NULL,
        industry_label TEXT NOT NULL,
        matched_rules TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        rule_version TEXT NOT NULL DEFAULT 'rule_bootstrap_v4',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (industry_key) REFERENCES job_industry_categories(industry_key)
      );
  
      CREATE INDEX IF NOT EXISTS idx_job_position_industry_key
        ON job_position_industry(industry_key);
    `);
  }
  
  async function ensureStateLocationIndexTable() {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS state_location_index (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        location_type TEXT NOT NULL CHECK (location_type IN ('city', 'county')),
        state_usps TEXT NOT NULL,
        state_geoid TEXT,
        location_geoid TEXT NOT NULL,
        ansicode TEXT,
        location_name TEXT NOT NULL,
        search_location_name TEXT NOT NULL,
        normalized_location_name TEXT NOT NULL,
        normalized_search_location_name TEXT NOT NULL,
        lsad_code TEXT,
        funcstat TEXT,
        aland INTEGER,
        awater INTEGER,
        aland_sqmi REAL,
        awater_sqmi REAL,
        intptlat REAL,
        intptlong REAL,
        source_file TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(location_type, location_geoid)
      );
    `);
  }
  
  async function getTableCount(tableName) {
    const row = await db.get(`SELECT COUNT(*) AS count FROM ${tableName};`);
    return Number(row?.count || 0);
  }
  
  async function seedReferenceTableWhenEmpty(tableName, columns) {
    const source = await db.get(
      `
        SELECT name
        FROM seed_ref.sqlite_master
        WHERE type = 'table'
          AND name = ?;
      `,
      [tableName]
    );
    if (!source?.name) return 0;
  
    const targetCount = await getTableCount(tableName);
    if (targetCount > 0) return 0;
  
    const columnList = columns.join(", ");
    const result = await db.run(
      `
        INSERT OR IGNORE INTO ${tableName} (${columnList})
        SELECT ${columnList}
        FROM seed_ref.${tableName};
      `
    );
    return Number(result?.changes || 0);
  }
  
  async function seedReferenceDataFromBundledDb() {
    const resolvedDbPath = path.resolve(DB_PATH);
    const resolvedBundledDbPath = path.resolve(BUNDLED_DB_PATH);
    if (resolvedDbPath === resolvedBundledDbPath || !fs.existsSync(resolvedBundledDbPath)) {
      return;
    }
  
    try {
      await db.run(`ATTACH DATABASE ? AS seed_ref;`, [resolvedBundledDbPath]);
      await seedReferenceTableWhenEmpty("companies", ["company_name", "url_string", "ATS_name"]);
      await seedReferenceTableWhenEmpty("job_industry_categories", [
        "industry_key",
        "industry_label",
        "priority",
        "created_at"
      ]);
      await seedReferenceTableWhenEmpty("job_position_industry", [
        "job_title",
        "normalized_job_title",
        "industry_key",
        "industry_label",
        "matched_rules",
        "confidence_score",
        "rule_version",
        "created_at",
        "updated_at"
      ]);
      await seedReferenceTableWhenEmpty("state_location_index", [
        "location_type",
        "state_usps",
        "state_geoid",
        "location_geoid",
        "ansicode",
        "location_name",
        "search_location_name",
        "normalized_location_name",
        "normalized_search_location_name",
        "lsad_code",
        "funcstat",
        "aland",
        "awater",
        "aland_sqmi",
        "awater_sqmi",
        "intptlat",
        "intptlong",
        "source_file",
        "created_at"
      ]);
    } catch (error) {
      console.warn(`[openjobslots API] reference seed skipped: ${String(error?.message || error)}`);
    } finally {
      try {
        await db.exec(`DETACH DATABASE seed_ref;`);
      } catch {}
    }
  }
  
  async function createCanonicalPostingsTable() {
    await db.exec(`
      CREATE TABLE Postings (
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
        description_html TEXT,
        description_plain TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        hidden_at_epoch INTEGER
      );
  
      CREATE INDEX IF NOT EXISTS idx_postings_company_name
        ON Postings(company_name);
  
      CREATE INDEX IF NOT EXISTS idx_postings_position_name
        ON Postings(position_name);
  
      CREATE INDEX IF NOT EXISTS idx_postings_last_seen_epoch
        ON Postings(last_seen_epoch);
  
      CREATE INDEX IF NOT EXISTS idx_postings_first_seen_epoch
        ON Postings(first_seen_epoch);
  
      CREATE INDEX IF NOT EXISTS idx_postings_hidden_first_seen_epoch
        ON Postings(hidden, first_seen_epoch);
  
      CREATE INDEX IF NOT EXISTS idx_postings_hidden_last_seen_epoch
        ON Postings(hidden, last_seen_epoch DESC);
    `);
  }
  
  function isSqliteDuplicateColumnError(error) {
    return String(error?.message || error || "").toLowerCase().includes("duplicate column name");
  }
  
  async function addPostingsColumnIfMissing(columnName, definition) {
    const columns = await db.all(`PRAGMA table_info('Postings');`);
    const existing = new Set(columns.map((column) => String(column?.name || "")));
    if (existing.has(columnName)) return;
    try {
      await db.exec(`ALTER TABLE Postings ADD COLUMN ${columnName} ${definition};`);
    } catch (error) {
      if (isSqliteDuplicateColumnError(error)) return;
      throw error;
    }
  }
  
  async function ensurePostingsTable() {
    const tableInfo = await db.all(`PRAGMA table_info('Postings');`);
  
    if (!Array.isArray(tableInfo) || tableInfo.length === 0) {
      await createCanonicalPostingsTable();
      return;
    }
  
    const requiredColumns = new Set(["id", "company_name", "position_name", "job_posting_url", "posting_date"]);
    const existingColumns = new Set(tableInfo.map((column) => String(column.name)));
    const requiredPresent = Array.from(requiredColumns).every((column) => existingColumns.has(column));
  
    let incompatibleExtraRequiredColumns = false;
    for (const column of tableInfo) {
      const name = String(column.name);
      if (requiredColumns.has(name)) continue;
      if (Number(column.notnull) === 1 && column.dflt_value === null) {
        incompatibleExtraRequiredColumns = true;
        break;
      }
    }
  
    if (!requiredPresent || incompatibleExtraRequiredColumns) {
      await db.exec(`DROP TABLE IF EXISTS Postings;`);
      await createCanonicalPostingsTable();
      return;
    }
  
    if (!existingColumns.has("last_seen_epoch")) {
      await addPostingsColumnIfMissing("last_seen_epoch", "INTEGER");
      await db.run(`UPDATE Postings SET last_seen_epoch = ? WHERE last_seen_epoch IS NULL;`, [nowEpochSeconds()]);
    }
  
    if (!existingColumns.has("first_seen_epoch")) {
      await addPostingsColumnIfMissing("first_seen_epoch", "INTEGER");
    }
    await db.run(
      `
        UPDATE Postings
        SET first_seen_epoch = COALESCE(first_seen_epoch, last_seen_epoch, ?)
        WHERE first_seen_epoch IS NULL;
      `,
      [nowEpochSeconds()]
    );
  
    if (!existingColumns.has("hidden")) {
      await addPostingsColumnIfMissing("hidden", "INTEGER NOT NULL DEFAULT 0");
    }
  
    if (!existingColumns.has("hidden_at_epoch")) {
      await addPostingsColumnIfMissing("hidden_at_epoch", "INTEGER");
    }
  
    if (!existingColumns.has("location")) {
      await addPostingsColumnIfMissing("location", "TEXT");
    }
  
    if (!existingColumns.has("source_job_id")) {
      await addPostingsColumnIfMissing("source_job_id", "TEXT NOT NULL DEFAULT ''");
    }
  
    if (!existingColumns.has("parser_version")) {
      await addPostingsColumnIfMissing("parser_version", "TEXT NOT NULL DEFAULT 'legacy-adapter-v1'");
    }
  
    if (!existingColumns.has("confidence")) {
      await addPostingsColumnIfMissing("confidence", "REAL NOT NULL DEFAULT 0");
    }
  
    if (!existingColumns.has("quality_score")) {
      await addPostingsColumnIfMissing("quality_score", "INTEGER NOT NULL DEFAULT 0");
    }
  
    if (!existingColumns.has("quality_flags")) {
      await addPostingsColumnIfMissing("quality_flags", "TEXT NOT NULL DEFAULT '[]'");
    }
  
    if (!existingColumns.has("rejection_reason")) {
      await addPostingsColumnIfMissing("rejection_reason", "TEXT NOT NULL DEFAULT ''");
    }
  
    if (!existingColumns.has("description_html")) {
      await addPostingsColumnIfMissing("description_html", "TEXT");
    }
  
    if (!existingColumns.has("description_plain")) {
      await addPostingsColumnIfMissing("description_plain", "TEXT");
    }
  
    await db.run(`UPDATE Postings SET last_seen_epoch = ? WHERE last_seen_epoch IS NULL;`, [nowEpochSeconds()]);
  
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_postings_job_posting_url
        ON Postings(job_posting_url);
  
      CREATE INDEX IF NOT EXISTS idx_postings_company_name
        ON Postings(company_name);
  
      CREATE INDEX IF NOT EXISTS idx_postings_position_name
        ON Postings(position_name);
  
      CREATE INDEX IF NOT EXISTS idx_postings_last_seen_epoch
        ON Postings(last_seen_epoch);
  
      CREATE INDEX IF NOT EXISTS idx_postings_first_seen_epoch
        ON Postings(first_seen_epoch);
  
      CREATE INDEX IF NOT EXISTS idx_postings_hidden_first_seen_epoch
        ON Postings(hidden, first_seen_epoch);
  
      CREATE INDEX IF NOT EXISTS idx_postings_hidden_last_seen_epoch
        ON Postings(hidden, last_seen_epoch DESC);
    `);
  }

  return {
    addPostingsColumnIfMissing,
    createCanonicalPostingsTable,
    ensureCompaniesTableSchema,
    ensureJobIndustryTables,
    ensurePostingsTable,
    ensureStateLocationIndexTable,
    getTableCount,
    hydratePostingLocationMapFromDb,
    isSqliteDuplicateColumnError,
    seedReferenceDataFromBundledDb,
    seedReferenceTableWhenEmpty
  };
}

module.exports = {
  createSqliteSchemaRuntime
};
