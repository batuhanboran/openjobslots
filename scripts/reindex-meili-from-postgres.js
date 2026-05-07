const { createPostgresPool, ensurePostgresSchema } = require("../server/backends/postgres");
const { ensureMeiliPostingsIndex, upsertMeiliPostings } = require("../server/search/meili");

const BATCH_SIZE = Math.max(100, Math.min(5000, Number(process.env.OPENJOBSLOTS_REINDEX_BATCH_SIZE || 1000)));

async function main() {
  const pool = createPostgresPool();
  let indexed = 0;
  let lastCanonicalUrl = "";

  try {
    await ensurePostgresSchema(pool);
    await ensureMeiliPostingsIndex();

    while (true) {
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
            last_seen_epoch,
            hidden
          FROM postings
          WHERE hidden = false
            AND canonical_url > $1
          ORDER BY canonical_url ASC
          LIMIT $2;
        `,
        [lastCanonicalUrl, BATCH_SIZE]
      );

      if (result.rows.length === 0) break;
      await upsertMeiliPostings(result.rows);
      indexed += result.rows.length;
      lastCanonicalUrl = String(result.rows[result.rows.length - 1].canonical_url || "");
      console.log(`Indexed ${indexed} postings into Meilisearch`);
    }

    console.log(`Reindexed ${indexed} visible postings into Meilisearch`);
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
