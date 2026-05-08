const { createPostgresPool, ensurePostgresSchema } = require("../server/backends/postgres");

async function main() {
  const pool = createPostgresPool();
  try {
    await ensurePostgresSchema(pool);
    const result = await pool.query(`
      SELECT
        ats_key,
        count(*) FILTER (WHERE hidden = false) AS active,
        count(*) FILTER (WHERE hidden = false AND coalesce(location_text, '') = '') AS blank_location_text,
        count(*) FILTER (
          WHERE hidden = false
            AND coalesce(location_text, '') <> ''
            AND (coalesce(country, '') = '' OR coalesce(region, '') = '')
        ) AS has_location_but_missing_geo,
        count(*) FILTER (WHERE hidden = false AND (coalesce(country, '') = '' OR coalesce(region, '') = '')) AS missing_geo,
        count(*) FILTER (WHERE hidden = false AND (posting_date IS NULL OR btrim(posting_date) = '')) AS missing_date,
        count(*) FILTER (WHERE hidden = false AND posted_at_epoch IS NULL) AS missing_posted_at_epoch,
        count(*) FILTER (
          WHERE hidden = false
            AND (remote_type IS NULL OR btrim(remote_type) = '' OR remote_type = 'unknown')
        ) AS unknown_remote,
        count(*) FILTER (WHERE hidden = false AND coalesce(source_job_id, '') = '') AS missing_source_id
      FROM postings
      GROUP BY ats_key
      HAVING count(*) FILTER (WHERE hidden = false) > 0
      ORDER BY missing_geo DESC, active DESC;
    `);

    const rows = result.rows.map((row) => ({
      ats_key: row.ats_key,
      active: Number(row.active || 0),
      blank_location_text: Number(row.blank_location_text || 0),
      has_location_but_missing_geo: Number(row.has_location_but_missing_geo || 0),
      missing_geo: Number(row.missing_geo || 0),
      missing_date: Number(row.missing_date || 0),
      missing_posted_at_epoch: Number(row.missing_posted_at_epoch || 0),
      unknown_remote: Number(row.unknown_remote || 0),
      missing_source_id: Number(row.missing_source_id || 0)
    }));

    console.log(JSON.stringify({ ok: true, rows }, null, 2));
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
