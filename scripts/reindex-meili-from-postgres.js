const { createPostgresPool, ensurePostgresSchema } = require("../server/backends/postgres");
const { ensureMeiliPostingsIndex, getMeiliConfig, upsertMeiliPostings } = require("../server/search/meili");

const BATCH_SIZE = Math.max(100, Math.min(5000, Number(process.env.OPENJOBSLOTS_REINDEX_BATCH_SIZE || 1000)));
const REPLACE_INDEX = String(process.env.OPENJOBSLOTS_REINDEX_REPLACE || "").trim() === "1";

async function meiliRequest(config, path, options = {}) {
  const response = await fetch(`${config.host}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 404 && options.allowNotFound) return {};
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meilisearch request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  if (response.status === 204) return {};
  return response.json();
}

async function waitForMeiliTask(config, task, timeoutMs = 60000) {
  const taskUid = Number(task?.taskUid ?? task?.uid ?? 0);
  if (!taskUid) return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await meiliRequest(config, `/tasks/${taskUid}`);
    if (current?.status === "succeeded") return;
    if (current?.status === "failed" || current?.status === "canceled") {
      throw new Error(`Meilisearch task ${taskUid} ${current.status}: ${current?.error?.message || "unknown error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Meilisearch task ${taskUid} did not finish within ${timeoutMs}ms`);
}

async function resetMeiliIndexIfRequested() {
  if (!REPLACE_INDEX) return;
  const config = getMeiliConfig();
  if (!config.enabled) return;
  const deleteTask = await meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}`, {
    method: "DELETE",
    allowNotFound: true
  });
  await waitForMeiliTask(config, deleteTask);
  console.log(`Deleted Meilisearch index ${config.indexName} before rebuild`);
}

async function main() {
  const pool = createPostgresPool();
  let indexed = 0;
  let lastCanonicalUrl = "";

  try {
    await ensurePostgresSchema(pool);
    const reindexStartedAtResult = await pool.query("SELECT now() AS started_at");
    const reindexStartedAt = reindexStartedAtResult.rows[0]?.started_at;
    await resetMeiliIndexIfRequested();
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
    if (REPLACE_INDEX && reindexStartedAt) {
      const processed = await pool.query(
        `
          UPDATE search_index_outbox
          SET processed_at = now()
          WHERE processed_at IS NULL
            AND created_at <= $1;
        `,
        [reindexStartedAt]
      );
      console.log(`Marked ${processed.rowCount || 0} pre-reindex search outbox rows as processed`);
    }
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
