const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const {
  ATS_FILTER_OPTION_ITEMS,
  inferAtsFromJobPostingUrl,
  normalizeAtsFilterValue
} = require("../server/index");
const {
  createPostgresPool,
  ensurePostgresSchema,
  seedPostgresAtsSources
} = require("../server/backends/postgres");
const {
  inferCountry,
  inferRegion,
  inferRemoteType,
  normalizeAtsKey
} = require("../server/backends/postgresStore");
const { ensureMeiliPostingsIndex, upsertMeiliPostings } = require("../server/search/meili");

const SQLITE_DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "jobs.db");
const CHUNK_SIZE = Math.max(100, Number(process.env.MIGRATION_CHUNK_SIZE || 1000));

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function tableExists(db, tableName) {
  const row = await db.get(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
      LIMIT 1;
    `,
    [tableName]
  );
  return Boolean(row?.name);
}

async function countRows(db, tableName) {
  if (!(await tableExists(db, tableName))) return 0;
  const row = await db.get(`SELECT COUNT(*) AS count FROM ${tableName};`);
  return Number(row?.count || 0);
}

async function ensureAtsSource(poolOrClient, atsKey) {
  const key = normalizeAtsKey(atsKey);
  if (!key) return "";
  await poolOrClient.query(
    `
      INSERT INTO ats_sources (ats_key, display_name, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT(ats_key) DO NOTHING;
    `,
    [key, key]
  );
  return key;
}

async function importCompanies(sqliteDb, pool) {
  if (!(await tableExists(sqliteDb, "companies"))) return { imported: 0 };
  const total = await countRows(sqliteDb, "companies");
  let imported = 0;
  for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
    const rows = await sqliteDb.all(
      `
        SELECT id, company_name, url_string, ATS_name
        FROM companies
        ORDER BY id
        LIMIT ? OFFSET ?;
      `,
      [CHUNK_SIZE, offset]
    );
    for (const row of rows) {
      const atsKey = normalizeAtsKey(normalizeAtsFilterValue(row?.ATS_name));
      const companyName = String(row?.company_name || "").trim();
      const url = String(row?.url_string || "").trim();
      if (!atsKey || !companyName || !url) continue;
      await ensureAtsSource(pool, atsKey);
      await pool.query(
        `
          INSERT INTO companies (
            company_name,
            normalized_company_name,
            url_string,
            ats_key,
            updated_at
          ) VALUES ($1, $2, $3, $4, now())
          ON CONFLICT(ats_key, url_string) DO UPDATE SET
            company_name = EXCLUDED.company_name,
            normalized_company_name = EXCLUDED.normalized_company_name,
            updated_at = now();
        `,
        [companyName, normalizeText(companyName), url, atsKey]
      );
      imported += 1;
    }
    console.log(`[migration] companies ${Math.min(offset + CHUNK_SIZE, total)}/${total}`);
  }
  return { imported };
}

async function importApplicationState(sqliteDb, pool) {
  if (!(await tableExists(sqliteDb, "posting_application_state"))) return { imported: 0 };
  const total = await countRows(sqliteDb, "posting_application_state");
  let imported = 0;
  for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
    const rows = await sqliteDb.all(
      `
        SELECT *
        FROM posting_application_state
        ORDER BY rowid
        LIMIT ? OFFSET ?;
      `,
      [CHUNK_SIZE, offset]
    );
    for (const row of rows) {
      const canonicalUrl = String(row?.job_posting_url || row?.canonical_url || "").trim();
      if (!canonicalUrl) continue;
      await pool.query(
        `
          INSERT INTO posting_application_state (
            canonical_url,
            applied,
            applied_by_type,
            applied_by_label,
            applied_at_epoch,
            last_application_id,
            ignored,
            ignored_at_epoch,
            ignored_by_label,
            updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
          ON CONFLICT(canonical_url) DO UPDATE SET
            applied = EXCLUDED.applied,
            applied_by_type = EXCLUDED.applied_by_type,
            applied_by_label = EXCLUDED.applied_by_label,
            applied_at_epoch = EXCLUDED.applied_at_epoch,
            last_application_id = EXCLUDED.last_application_id,
            ignored = EXCLUDED.ignored,
            ignored_at_epoch = EXCLUDED.ignored_at_epoch,
            ignored_by_label = EXCLUDED.ignored_by_label,
            updated_at = now();
        `,
        [
          canonicalUrl,
          Boolean(Number(row?.applied || 0)),
          String(row?.applied_by_type || ""),
          String(row?.applied_by_label || ""),
          row?.applied_at_epoch == null ? null : toNumber(row.applied_at_epoch),
          row?.last_application_id == null ? null : toNumber(row.last_application_id),
          Boolean(Number(row?.ignored || 0)),
          row?.ignored_at_epoch == null ? null : toNumber(row.ignored_at_epoch),
          String(row?.ignored_by_label || "")
        ]
      );
      imported += 1;
    }
  }
  return { imported };
}

async function importPostings(sqliteDb, pool) {
  if (!(await tableExists(sqliteDb, "Postings"))) return { imported: 0, indexed: 0 };
  const total = await countRows(sqliteDb, "Postings");
  let imported = 0;
  let indexed = 0;
  for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
    const rows = await sqliteDb.all(
      `
        SELECT
          company_name,
          position_name,
          job_posting_url,
          location,
          posting_date,
          first_seen_epoch,
          last_seen_epoch,
          hidden
        FROM Postings
        ORDER BY id
        LIMIT ? OFFSET ?;
      `,
      [CHUNK_SIZE, offset]
    );

    const meiliBatch = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of rows) {
        const canonicalUrl = String(row?.job_posting_url || "").trim();
        const companyName = String(row?.company_name || "").trim();
        const title = String(row?.position_name || "").trim();
        if (!canonicalUrl || !companyName || !title) continue;
        const location = String(row?.location || "").trim();
        const country = inferCountry(location);
        const region = inferRegion(country);
        const remoteType = inferRemoteType(location);
        const atsKey = normalizeAtsKey(inferAtsFromJobPostingUrl(canonicalUrl));
        if (!atsKey) continue;
        await ensureAtsSource(client, atsKey);
        const firstSeen = toNumber(row?.first_seen_epoch, toNumber(row?.last_seen_epoch, Math.floor(Date.now() / 1000)));
        const lastSeen = toNumber(row?.last_seen_epoch, firstSeen);
        const hidden = Boolean(Number(row?.hidden || 0));

        await client.query(
          `
            INSERT INTO postings (
              canonical_url,
              company_name,
              position_name,
              apply_url,
              location_text,
              country,
              region,
              remote_type,
              industry,
              ats_key,
              source_job_id,
              posting_date,
              posted_at_epoch,
              first_seen_epoch,
              last_seen_epoch,
              hidden,
              parser_version,
              confidence,
              updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9,'',$10,NULL,$11,$12,$13,'sqlite-import-v1',0.5,now())
            ON CONFLICT(canonical_url) DO UPDATE SET
              company_name = EXCLUDED.company_name,
              position_name = EXCLUDED.position_name,
              apply_url = EXCLUDED.apply_url,
              location_text = COALESCE(EXCLUDED.location_text, postings.location_text),
              country = COALESCE(NULLIF(EXCLUDED.country, ''), postings.country),
              region = COALESCE(NULLIF(EXCLUDED.region, ''), postings.region),
              remote_type = EXCLUDED.remote_type,
              ats_key = EXCLUDED.ats_key,
              posting_date = COALESCE(EXCLUDED.posting_date, postings.posting_date),
              first_seen_epoch = LEAST(postings.first_seen_epoch, EXCLUDED.first_seen_epoch),
              last_seen_epoch = GREATEST(postings.last_seen_epoch, EXCLUDED.last_seen_epoch),
              hidden = EXCLUDED.hidden,
              updated_at = now();
          `,
          [
            canonicalUrl,
            companyName,
            title,
            canonicalUrl,
            location || null,
            country,
            region,
            remoteType,
            atsKey,
            row?.posting_date || null,
            firstSeen,
            lastSeen,
            hidden
          ]
        );
        meiliBatch.push({
          canonical_url: canonicalUrl,
          title,
          company: companyName,
          location,
          country,
          region,
          remote_type: remoteType,
          industry: "",
          ats_key: atsKey,
          last_seen_epoch: lastSeen,
          posted_at_epoch: 0
        });
        imported += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const meiliResult = await upsertMeiliPostings(meiliBatch);
    if (!meiliResult?.skipped) indexed += meiliBatch.length;
    console.log(`[migration] postings ${Math.min(offset + CHUNK_SIZE, total)}/${total}`);
  }
  return { imported, indexed };
}

async function main() {
  process.env.OPENJOBSLOTS_DB_BACKEND = "postgres";
  const sqliteDb = await open({
    filename: SQLITE_DB_PATH,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY
  });
  const pool = createPostgresPool();
  await ensurePostgresSchema(pool);
  await seedPostgresAtsSources(pool, ATS_FILTER_OPTION_ITEMS);
  await ensureMeiliPostingsIndex();

  console.log(`[migration] sqlite=${SQLITE_DB_PATH}`);
  const companies = await importCompanies(sqliteDb, pool);
  const postings = await importPostings(sqliteDb, pool);
  const applicationState = await importApplicationState(sqliteDb, pool);
  const countResult = await pool.query("SELECT COUNT(*)::int AS count FROM postings WHERE hidden = false;");
  console.log(JSON.stringify({
    ok: true,
    companies,
    postings,
    applicationState,
    postgres_postings_visible: Number(countResult.rows[0]?.count || 0)
  }, null, 2));

  await sqliteDb.close();
  await pool.end();
}

main().catch((error) => {
  console.error("[migration] failed:", error);
  process.exit(1);
});
