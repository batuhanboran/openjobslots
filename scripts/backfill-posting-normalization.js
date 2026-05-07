const { createPostgresPool, ensurePostgresSchema } = require("../server/backends/postgres");
const {
  normalizePosting,
  normalizeRegionFromCountry
} = require("../server/ingestion/posting");

const BATCH_SIZE = Math.max(100, Math.min(10000, Number(process.env.OPENJOBSLOTS_BACKFILL_BATCH_SIZE || 2000)));
const LIMIT = Math.max(0, Number(process.env.OPENJOBSLOTS_BACKFILL_LIMIT || 0));
const DRY_RUN = String(process.env.OPENJOBSLOTS_BACKFILL_DRY_RUN || "").trim() === "1";
const ATS_FILTER = String(process.env.OPENJOBSLOTS_BACKFILL_ATS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function shouldChange(row, normalized) {
  const currentCountry = String(row.country || "").trim();
  const currentRegion = String(row.region || "").trim();
  const currentRemoteType = String(row.remote_type || "unknown").trim() || "unknown";
  const nextCountry = currentCountry || String(normalized.country || "").trim();
  const nextRegion = currentRegion || String(normalized.region || normalizeRegionFromCountry(nextCountry) || "").trim();
  const nextRemoteType =
    currentRemoteType === "unknown"
      ? String(normalized.remote_type || "unknown").trim() || "unknown"
      : currentRemoteType;

  return {
    changed: nextCountry !== currentCountry || nextRegion !== currentRegion || nextRemoteType !== currentRemoteType,
    nextCountry,
    nextRegion,
    nextRemoteType
  };
}

function toSearchPayload(row, nextCountry, nextRegion, nextRemoteType) {
  return {
    canonical_url: row.canonical_url,
    company_name: row.company_name,
    position_name: row.position_name,
    apply_url: row.apply_url,
    location_text: row.location_text,
    country: nextCountry,
    region: nextRegion,
    remote_type: nextRemoteType,
    industry: row.industry,
    ats_key: row.ats_key,
    source_job_id: row.source_job_id,
    posting_date: row.posting_date,
    posted_at_epoch: row.posted_at_epoch,
    last_seen_epoch: row.last_seen_epoch,
    hidden: row.hidden
  };
}

async function main() {
  const pool = createPostgresPool();
  let scanned = 0;
  let changed = 0;
  let lastCanonicalUrl = "";
  const changedByAts = new Map();

  try {
    await ensurePostgresSchema(pool);

    while (true) {
      if (LIMIT > 0 && scanned >= LIMIT) break;
      const remainingLimit = LIMIT > 0 ? Math.min(BATCH_SIZE, LIMIT - scanned) : BATCH_SIZE;
      const params = [lastCanonicalUrl, remainingLimit];
      let atsClause = "";
      if (ATS_FILTER.length > 0) {
        params.push(ATS_FILTER);
        atsClause = `AND ats_key = ANY($${params.length}::text[])`;
      }

      const result = await pool.query(
        `
          SELECT
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
            confidence
          FROM postings
          WHERE hidden = false
            AND canonical_url > $1
            AND (
              country = ''
              OR region = ''
              OR remote_type = 'unknown'
            )
            AND (
              coalesce(location_text, '') <> ''
              OR position_name ~* '(remote|hybrid|telework|work from home|home office)'
            )
            ${atsClause}
          ORDER BY canonical_url ASC
          LIMIT $2;
        `,
        params
      );

      const rows = result.rows || [];
      if (rows.length === 0) break;

      if (!DRY_RUN) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const row of rows) {
            scanned += 1;
            lastCanonicalUrl = String(row.canonical_url || "");
            const normalized = normalizePosting(
              {
                ...row,
                job_posting_url: row.canonical_url
              },
              { company_name: row.company_name },
              row.ats_key,
              {
                parserVersion: row.parser_version,
                confidence: row.confidence,
                firstSeenEpoch: row.first_seen_epoch,
                lastSeenEpoch: row.last_seen_epoch
              }
            );
            const next = shouldChange(row, normalized);
            if (!next.changed) continue;

            await client.query(
              `
                UPDATE postings
                SET country = $2,
                    region = $3,
                    remote_type = $4,
                    updated_at = now()
                WHERE canonical_url = $1;
              `,
              [row.canonical_url, next.nextCountry, next.nextRegion, next.nextRemoteType]
            );
            await client.query(
              `
                UPDATE posting_cache
                SET country = $2,
                    region = $3,
                    remote_type = $4,
                    updated_at = now()
                WHERE canonical_url = $1;
              `,
              [row.canonical_url, next.nextCountry, next.nextRegion, next.nextRemoteType]
            );
            await client.query(
              `
                INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at)
                VALUES ($1, 'upsert', $2::jsonb, now());
              `,
              [row.canonical_url, JSON.stringify(toSearchPayload(row, next.nextCountry, next.nextRegion, next.nextRemoteType))]
            );
            changed += 1;
            changedByAts.set(row.ats_key, (changedByAts.get(row.ats_key) || 0) + 1);
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } else {
        for (const row of rows) {
          scanned += 1;
          lastCanonicalUrl = String(row.canonical_url || "");
          const normalized = normalizePosting({ ...row, job_posting_url: row.canonical_url }, { company_name: row.company_name }, row.ats_key);
          const next = shouldChange(row, normalized);
          if (!next.changed) continue;
          changed += 1;
          changedByAts.set(row.ats_key, (changedByAts.get(row.ats_key) || 0) + 1);
        }
      }

      console.log(JSON.stringify({
        scanned,
        changed,
        dry_run: DRY_RUN,
        changed_by_ats: Object.fromEntries([...changedByAts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20))
      }));
    }

    console.log(JSON.stringify({
      ok: true,
      scanned,
      changed,
      dry_run: DRY_RUN,
      changed_by_ats: Object.fromEntries([...changedByAts.entries()].sort((a, b) => b[1] - a[1]))
    }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
