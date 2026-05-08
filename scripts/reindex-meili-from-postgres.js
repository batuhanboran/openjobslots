const { createPostgresPool, ensurePostgresSchema } = require("../server/backends/postgres");
const {
  ensureMeiliPostingsIndex,
  getMeiliConfig,
  MEILI_POSTINGS_SETTINGS,
  toMeiliDocumentId,
  toMeiliPostingDocument,
  upsertMeiliPostings
} = require("../server/search/meili");

function parseNumberOption(value, fallback, min, max) {
  const parsed = Number(value);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function parseReindexArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    batchSize: parseNumberOption(env.OPENJOBSLOTS_REINDEX_BATCH_SIZE || 1000, 1000, 100, 5000),
    check: String(env.OPENJOBSLOTS_REINDEX_CHECK || "").trim() === "1",
    replaceIndex: String(env.OPENJOBSLOTS_REINDEX_REPLACE || "").trim() === "1",
    sampleLimit: parseNumberOption(env.OPENJOBSLOTS_REINDEX_SAMPLE_LIMIT || 25, 25, 0, 200),
    taskTimeoutMs: parseNumberOption(env.OPENJOBSLOTS_REINDEX_TASK_TIMEOUT_MS || 120000, 120000, 30000, 300000)
  };

  for (const arg of argv) {
    if (arg === "--check" || arg === "--dry-run") options.check = true;
    if (arg === "--replace") options.replaceIndex = true;
    if (arg.startsWith("--batch-size=")) {
      options.batchSize = parseNumberOption(arg.slice("--batch-size=".length), options.batchSize, 100, 5000);
    }
    if (arg.startsWith("--sample-limit=")) {
      options.sampleLimit = parseNumberOption(arg.slice("--sample-limit=".length), options.sampleLimit, 0, 200);
    }
  }
  return options;
}

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

async function resetMeiliIndexIfRequested(config, replaceIndex) {
  if (!replaceIndex) return;
  if (!config.enabled) return;
  const deleteTask = await meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}`, {
    method: "DELETE",
    allowNotFound: true
  });
  await waitForMeiliTask(config, deleteTask);
  console.log(`Deleted Meilisearch index ${config.indexName} before rebuild`);
}

function indexablePostingsWhereClause() {
  return `
    hidden = false
    AND btrim(coalesce(canonical_url, '')) ~* '^https?://'
    AND btrim(coalesce(position_name, '')) <> ''
    AND btrim(coalesce(company_name, '')) <> ''
    AND position_name !~* '^(untitled|unknown|n/?a|not available|job opening|new job|open position|position)$'
  `;
}

async function getMeiliStats(config) {
  return meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/stats`, { allowNotFound: true });
}

async function getMeiliIndex(config) {
  return meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}`, { allowNotFound: true });
}

async function getMeiliSettings(config) {
  return meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/settings`, { allowNotFound: true });
}

function normalizeSettingList(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(item || "")).filter(Boolean).sort();
}

function compareSettingList(name, actual, expected) {
  const actualItems = normalizeSettingList(actual);
  const expectedItems = normalizeSettingList(expected);
  const actualSet = new Set(actualItems);
  const expectedSet = new Set(expectedItems);
  const missing = expectedItems.filter((item) => !actualSet.has(item));
  const extra = actualItems.filter((item) => !expectedSet.has(item));
  return missing.length || extra.length ? { setting: name, missing, extra } : null;
}

function compareSynonyms(actual, expected) {
  const mismatches = [];
  const actualSynonyms = actual && typeof actual === "object" ? actual : {};
  const expectedSynonyms = expected && typeof expected === "object" ? expected : {};
  for (const [key, expectedValues] of Object.entries(expectedSynonyms)) {
    const mismatch = compareSettingList(`synonyms.${key}`, actualSynonyms[key], expectedValues);
    if (mismatch) mismatches.push(mismatch);
  }
  return mismatches;
}

function validateMeiliSettings(index, settings) {
  const mismatches = [];
  if (index?.primaryKey !== "id") {
    mismatches.push({ setting: "primaryKey", expected: "id", actual: index?.primaryKey || null });
  }
  for (const key of ["searchableAttributes", "filterableAttributes", "sortableAttributes", "rankingRules", "stopWords"]) {
    const mismatch = compareSettingList(key, settings?.[key], MEILI_POSTINGS_SETTINGS[key]);
    if (mismatch) mismatches.push(mismatch);
  }
  mismatches.push(...compareSynonyms(settings?.synonyms, MEILI_POSTINGS_SETTINGS.synonyms));
  const actualTypo = settings?.typoTolerance || {};
  if (actualTypo.enabled !== MEILI_POSTINGS_SETTINGS.typoTolerance.enabled) {
    mismatches.push({
      setting: "typoTolerance.enabled",
      expected: MEILI_POSTINGS_SETTINGS.typoTolerance.enabled,
      actual: actualTypo.enabled
    });
  }
  const typoMismatch = compareSettingList(
    "typoTolerance.disableOnAttributes",
    actualTypo.disableOnAttributes,
    MEILI_POSTINGS_SETTINGS.typoTolerance.disableOnAttributes
  );
  if (typoMismatch) mismatches.push(typoMismatch);
  const disabledWordMismatch = compareSettingList(
    "typoTolerance.disableOnWords",
    actualTypo.disableOnWords,
    MEILI_POSTINGS_SETTINGS.typoTolerance.disableOnWords
  );
  if (disabledWordMismatch) mismatches.push(disabledWordMismatch);
  for (const key of ["oneTypo", "twoTypos"]) {
    const actualValue = Number(actualTypo?.minWordSizeForTypos?.[key] || 0);
    const expectedValue = Number(MEILI_POSTINGS_SETTINGS.typoTolerance.minWordSizeForTypos[key] || 0);
    if (actualValue !== expectedValue) {
      mismatches.push({
        setting: `typoTolerance.minWordSizeForTypos.${key}`,
        expected: expectedValue,
        actual: actualValue
      });
    }
  }
  return {
    ok: mismatches.length === 0,
    mismatches
  };
}

function comparableDocumentFields(postgresRow) {
  const document = toMeiliPostingDocument(postgresRow);
  return {
    canonical_url: document.canonical_url,
    title: document.title,
    company: document.company,
    location: document.location,
    city: document.city,
    country: document.country,
    region: document.region,
    remote_type: document.remote_type,
    ats_key: document.ats_key,
    source_job_id: document.source_job_id,
    posted_at_epoch: document.posted_at_epoch,
    hidden: document.hidden
  };
}

function compareMeiliDocument(postgresRow, meiliDocument) {
  const expected = comparableDocumentFields(postgresRow);
  const mismatches = [];
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = meiliDocument?.[field];
    if (String(actualValue ?? "") !== String(expectedValue ?? "")) {
      mismatches.push({ field, expected: expectedValue, actual: actualValue ?? null });
    }
  }
  return mismatches;
}

async function checkMeiliParity(pool, config, options) {
  const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM postings WHERE ${indexablePostingsWhereClause()};`);
  const badRowsResult = await pool.query(
    `
      SELECT COUNT(*)::int AS count
      FROM postings
      WHERE hidden = false
        AND NOT (${indexablePostingsWhereClause()});
    `
  );
  const missingRequiredResult = await pool.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE btrim(coalesce(canonical_url, '')) = '')::int AS missing_canonical_url,
        COUNT(*) FILTER (WHERE btrim(coalesce(canonical_url, '')) <> '' AND btrim(coalesce(canonical_url, '')) !~* '^https?://')::int AS invalid_canonical_url,
        COUNT(*) FILTER (WHERE btrim(coalesce(position_name, '')) = '')::int AS missing_title,
        COUNT(*) FILTER (WHERE btrim(coalesce(company_name, '')) = '')::int AS missing_company,
        COUNT(*) FILTER (WHERE lower(btrim(coalesce(position_name, ''))) ~ '^(untitled|unknown|n/?a|not available|job opening|new job|open position|position)$')::int AS placeholder_title
      FROM postings
      WHERE hidden = false;
    `
  );
  const index = config.enabled ? await getMeiliIndex(config) : { skipped: true };
  const settings = config.enabled ? await getMeiliSettings(config) : { skipped: true };
  const settingsValidation = config.enabled ? validateMeiliSettings(index, settings) : { ok: false, skipped: true, mismatches: [] };
  const stats = config.enabled ? await getMeiliStats(config) : { skipped: true, numberOfDocuments: 0 };
  const sampleResult = await pool.query(
    `
      SELECT
        canonical_url,
        company_name,
        position_name,
        apply_url,
        location_text,
        city,
        country,
        region,
        remote_type,
        industry,
        department,
        employment_type,
        description_plain,
        ats_key,
        source_job_id,
        posting_date,
        posted_at_epoch,
        last_seen_epoch,
        hidden
      FROM postings
      WHERE ${indexablePostingsWhereClause()}
      ORDER BY last_seen_epoch DESC, canonical_url ASC
      LIMIT $1;
    `,
    [options.sampleLimit]
  );

  const samples = [];
  if (config.enabled) {
    for (const row of sampleResult.rows || []) {
      const id = toMeiliDocumentId(row.canonical_url);
      let document = null;
      let missing = false;
      try {
        document = await meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/documents/${encodeURIComponent(id)}`);
      } catch {
        missing = true;
      }
      const mismatches = missing ? [{ field: "id", expected: id, actual: null }] : compareMeiliDocument(row, document);
      if (mismatches.length > 0) {
        samples.push({
          canonical_url: row.canonical_url,
          ats_key: row.ats_key,
          mismatches
        });
      }
    }
  }

  return {
    ok: true,
    check: true,
    postgres_indexable_count: Number(countResult.rows[0]?.count || 0),
    postgres_bad_visible_rows_excluded: Number(badRowsResult.rows[0]?.count || 0),
    postgres_missing_required_fields: missingRequiredResult.rows[0] || {},
    meili_document_count: Number(stats?.numberOfDocuments || 0),
    count_delta: Number(countResult.rows[0]?.count || 0) - Number(stats?.numberOfDocuments || 0),
    meili_settings_valid: Boolean(settingsValidation.ok),
    meili_settings_mismatches: settingsValidation.mismatches || [],
    sampled: sampleResult.rows.length,
    sample_mismatches: samples
  };
}

async function runReindex(pool, options = parseReindexArgs()) {
  const config = getMeiliConfig();
  let indexed = 0;
  let lastCanonicalUrl = "";

  try {
    if (!pool) {
      const skipped = {
        ok: true,
        skipped: true,
        reason: "OPENJOBSLOTS_DB_BACKEND is not postgres; Meili reindex checks require the Postgres source of truth."
      };
      console.log(JSON.stringify(skipped));
      return skipped;
    }

    if (options.check) {
      const checkResult = await checkMeiliParity(pool, config, options);
      console.log(JSON.stringify(checkResult));
      return checkResult;
    }

    await ensurePostgresSchema(pool);
    const reindexStartedAtResult = await pool.query("SELECT now() AS started_at");
    const reindexStartedAt = reindexStartedAtResult.rows[0]?.started_at;
    await resetMeiliIndexIfRequested(config, options.replaceIndex);
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
            city,
            country,
            region,
            remote_type,
            industry,
            department,
            employment_type,
            description_plain,
            ats_key,
            source_job_id,
            posting_date,
            posted_at_epoch,
            last_seen_epoch,
            hidden
          FROM postings
          WHERE ${indexablePostingsWhereClause()}
            AND canonical_url > $1
          ORDER BY canonical_url ASC
          LIMIT $2;
        `,
        [lastCanonicalUrl, options.batchSize]
      );

      if (result.rows.length === 0) break;
      const task = await upsertMeiliPostings(result.rows);
      await waitForMeiliTask(config, task, options.taskTimeoutMs);
      indexed += result.rows.length;
      lastCanonicalUrl = String(result.rows[result.rows.length - 1].canonical_url || "");
      console.log(`Indexed ${indexed} postings into Meilisearch`);
    }

    console.log(`Reindexed ${indexed} visible postings into Meilisearch`);
    if (options.replaceIndex && reindexStartedAt) {
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
    return { ok: true, check: false, indexed };
  } finally {
    if (pool && typeof pool.end === "function") await pool.end();
  }
}

async function main() {
  const pool = createPostgresPool();
  await runReindex(pool, parseReindexArgs());
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  checkMeiliParity,
  comparableDocumentFields,
  compareMeiliDocument,
  compareSettingList,
  indexablePostingsWhereClause,
  parseReindexArgs,
  runReindex,
  validateMeiliSettings
};
