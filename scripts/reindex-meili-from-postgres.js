const { createPostgresPool, ensurePostgresSchema } = require("../server/backends/postgres");
const { withHeavyJobLock } = require("../server/backends/heavyJobLock");
const fs = require("node:fs");
const path = require("node:path");
const {
  getMeiliConfig,
  MEILI_POSTINGS_SETTINGS,
  toMeiliDocumentId,
  toMeiliPostingDocument,
  upsertMeiliPostings
} = require("../server/search/meili");
const { normalizeSearchQuery } = require("../server/search/config");
const { writeMeiliReindexStatus } = require("../server/search/reindexStatus");

const DEFAULT_SAMPLE_QUERIES = Object.freeze([
  "",
  "turkish jobs",
  "t\u00fcrkiye",
  "turkiye",
  "remote jobs",
  "software",
  "engineer"
]);

function parseNumberOption(value, fallback, min, max) {
  const parsed = Number(value);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function parseBooleanEnv(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseReindexArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    apply: parseBooleanEnv(env.OPENJOBSLOTS_REINDEX_APPLY),
    batchSize: parseNumberOption(env.OPENJOBSLOTS_REINDEX_BATCH_SIZE || 1000, 1000, 100, 5000),
    check: parseBooleanEnv(env.OPENJOBSLOTS_REINDEX_CHECK),
    confirmProduction: parseBooleanEnv(env.OPENJOBSLOTS_REINDEX_CONFIRM_PRODUCTION),
    dryRun: parseBooleanEnv(env.OPENJOBSLOTS_REINDEX_DRY_RUN),
    replaceIndex: false,
    replaceMode: parseBooleanEnv(env.OPENJOBSLOTS_REINDEX_REPLACE_MODE),
    json: parseBooleanEnv(env.OPENJOBSLOTS_REINDEX_JSON),
    output: String(env.OPENJOBSLOTS_REINDEX_OUTPUT || "").trim(),
    sampleLimit: parseNumberOption(env.OPENJOBSLOTS_REINDEX_SAMPLE_LIMIT || 25, 25, 0, 200),
    taskTimeoutMs: parseNumberOption(env.OPENJOBSLOTS_REINDEX_TASK_TIMEOUT_MS || 120000, 120000, 30000, 300000),
    tempIndexSuffix: String(env.OPENJOBSLOTS_REINDEX_TEMP_SUFFIX || "").trim(),
    validateOnly: parseBooleanEnv(env.OPENJOBSLOTS_REINDEX_VALIDATE_ONLY),
    skipOutboxUpdate: parseBooleanEnv(env.OPENJOBSLOTS_REINDEX_SKIP_OUTBOX_UPDATE),
    writeStatus: true
  };

  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    if (arg === "--check") options.check = true;
    if (arg === "--confirm-production") options.confirmProduction = true;
    if (arg === "--dry-run") {
      options.check = true;
      options.dryRun = true;
    }
    if (arg === "--replace" || arg === "--replace-mode") {
      options.replaceMode = true;
      options.replaceIndex = true;
    }
    if (arg === "--json") options.json = true;
    if (arg === "--validate-only") {
      options.check = true;
      options.validateOnly = true;
    }
    if (arg === "--skip-outbox-update") options.skipOutboxUpdate = true;
    if (arg.startsWith("--batch-size=")) {
      options.batchSize = parseNumberOption(arg.slice("--batch-size=".length), options.batchSize, 100, 5000);
    }
    if (arg.startsWith("--sample-limit=")) {
      options.sampleLimit = parseNumberOption(arg.slice("--sample-limit=".length), options.sampleLimit, 0, 200);
    }
    if (arg.startsWith("--temp-index-suffix=")) {
      options.tempIndexSuffix = String(arg.slice("--temp-index-suffix=".length) || "").trim();
    }
    if (arg.startsWith("--output=")) {
      options.output = String(arg.slice("--output=".length) || "").trim();
    }
  }
  return options;
}

function writeResultOutput(result, options = {}) {
  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result));
  return result;
}

async function meiliRequest(config, requestPath, options = {}) {
  const response = await fetch(`${config.host}${requestPath}`, {
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
    throw new Error(`Meilisearch request failed (${response.status}): ${text.slice(0, 300)}`);
  }
  if (response.status === 204) return {};
  return response.json();
}

async function waitForMeiliTask(config, task, timeoutMs = 60000) {
  const taskUid = Number(task?.taskUid ?? task?.uid ?? 0);
  if (!taskUid) return task;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await meiliRequest(config, `/tasks/${taskUid}`);
    if (current?.status === "succeeded") return current;
    if (current?.status === "failed" || current?.status === "canceled") {
      throw new Error(`Meilisearch task ${taskUid} ${current.status}: ${current?.error?.message || "unknown error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Meilisearch task ${taskUid} did not finish within ${timeoutMs}ms`);
}

function configForIndex(config, indexName) {
  return { ...config, indexName };
}

function encodeIndex(indexName) {
  return encodeURIComponent(String(indexName || ""));
}

async function getMeiliStats(config, indexName = config.indexName) {
  return meiliRequest(config, `/indexes/${encodeIndex(indexName)}/stats`, { allowNotFound: true });
}

async function getMeiliIndex(config, indexName = config.indexName) {
  return meiliRequest(config, `/indexes/${encodeIndex(indexName)}`, { allowNotFound: true });
}

async function getMeiliSettings(config, indexName = config.indexName) {
  return meiliRequest(config, `/indexes/${encodeIndex(indexName)}/settings`, { allowNotFound: true });
}

async function applyMeiliSettings(config, indexName, timeoutMs) {
  const settingsTask = await meiliRequest(config, `/indexes/${encodeIndex(indexName)}/settings`, {
    method: "PATCH",
    body: JSON.stringify(MEILI_POSTINGS_SETTINGS)
  });
  await waitForMeiliTask(config, settingsTask, timeoutMs);
  return { ok: true, indexName };
}

async function ensureMeiliIndex(config, indexName, timeoutMs) {
  let existingIndex = await getMeiliIndex(config, indexName);
  if (existingIndex && existingIndex.primaryKey && existingIndex.primaryKey !== "id") {
    const deleteTask = await meiliRequest(config, `/indexes/${encodeIndex(indexName)}`, {
      method: "DELETE"
    });
    await waitForMeiliTask(config, deleteTask, timeoutMs);
    existingIndex = null;
  }
  if (!existingIndex || !existingIndex.uid) {
    const createTask = await meiliRequest(config, "/indexes", {
      method: "POST",
      body: JSON.stringify({ uid: indexName, primaryKey: "id" })
    });
    try {
      await waitForMeiliTask(config, createTask, timeoutMs);
    } catch (error) {
      if (!/already exists/i.test(String(error?.message || error))) throw error;
    }
  }
  await applyMeiliSettings(config, indexName, timeoutMs);
  return { ok: true, indexName };
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
    mismatches.push({ setting: "typoTolerance.enabled", expected: MEILI_POSTINGS_SETTINGS.typoTolerance.enabled, actual: actualTypo.enabled });
  }
  const typoMismatch = compareSettingList("typoTolerance.disableOnAttributes", actualTypo.disableOnAttributes, MEILI_POSTINGS_SETTINGS.typoTolerance.disableOnAttributes);
  if (typoMismatch) mismatches.push(typoMismatch);
  const disabledWordMismatch = compareSettingList("typoTolerance.disableOnWords", actualTypo.disableOnWords, MEILI_POSTINGS_SETTINGS.typoTolerance.disableOnWords);
  if (disabledWordMismatch) mismatches.push(disabledWordMismatch);
  for (const key of ["oneTypo", "twoTypos"]) {
    const actualValue = Number(actualTypo?.minWordSizeForTypos?.[key] || 0);
    const expectedValue = Number(MEILI_POSTINGS_SETTINGS.typoTolerance.minWordSizeForTypos[key] || 0);
    if (actualValue !== expectedValue) {
      mismatches.push({ setting: `typoTolerance.minWordSizeForTypos.${key}`, expected: expectedValue, actual: actualValue });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function indexablePostingsWhereClause() {
  return `
    hidden = false
    AND canonical_url > ''
    AND (canonical_url LIKE 'http://%' OR canonical_url LIKE 'https://%')
    AND position_name IS NOT NULL
    AND position_name <> ''
    AND company_name IS NOT NULL
    AND company_name <> ''
    AND position_name !~* '^(untitled|unknown|n/?a|not available|job opening|new job|open position|position)$'
  `;
}

function postingSelectColumns() {
  return `
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
  `;
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

function remoteFacetKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "unknown";
}

async function getPostgresIndexableCount(pool) {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM postings WHERE ${indexablePostingsWhereClause()};`);
  return Number(result.rows[0]?.count || 0);
}

async function getPostgresRemoteFacet(pool, options = {}) {
  const facet = {};
  let lastCanonicalUrl = "";
  const batchSize = Math.max(100, Math.min(10000, Number(options.batchSize || 5000)));
  while (true) {
    const result = await pool.query(
      `
        /* meili_remote_facet */
        SELECT ${postingSelectColumns()}
        FROM postings
        WHERE ${indexablePostingsWhereClause()}
          AND canonical_url > $1
        ORDER BY canonical_url ASC
        LIMIT $2;
      `,
      [lastCanonicalUrl, batchSize]
    );
    if (result.rows.length === 0) break;
    for (const row of result.rows) {
      const document = toMeiliPostingDocument(row);
      const key = remoteFacetKey(document.remote_type);
      facet[key] = (facet[key] || 0) + 1;
    }
    lastCanonicalUrl = String(result.rows[result.rows.length - 1].canonical_url || "");
  }
  return facet;
}

async function getMeiliRemoteFacet(config, indexName = config.indexName) {
  const result = await meiliRequest(config, `/indexes/${encodeIndex(indexName)}/search`, {
    method: "POST",
    body: JSON.stringify({
      q: "",
      limit: 0,
      facets: ["remote_type"],
      filter: "hidden = false"
    }),
    allowNotFound: true
  });
  const distribution = result?.facetDistribution?.remote_type || {};
  return Object.fromEntries(Object.entries(distribution).map(([key, value]) => [remoteFacetKey(key), Number(value || 0)]));
}

function compareFacetDistributions(expected, actual) {
  const allKeys = [...new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})])].sort();
  const deltas = {};
  for (const key of allKeys) {
    const expectedValue = Number(expected?.[key] || 0);
    const actualValue = Number(actual?.[key] || 0);
    if (expectedValue !== actualValue) {
      deltas[key] = {
        expected: expectedValue,
        actual: actualValue,
        delta: expectedValue - actualValue
      };
    }
  }
  return {
    ok: Object.keys(deltas).length === 0,
    deltas
  };
}

async function getPostgresBadVisibleRows(pool) {
  const result = await pool.query(
    `
      SELECT COUNT(*)::int AS count
      FROM postings
      WHERE hidden = false
        AND NOT (${indexablePostingsWhereClause()});
    `
  );
  return Number(result.rows[0]?.count || 0);
}

async function getPostgresMissingRequiredFields(pool) {
  const result = await pool.query(
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
  return result.rows[0] || {};
}

async function samplePostgresRows(pool, sampleLimit) {
  if (Number(sampleLimit || 0) <= 0) return [];
  const sampleResult = await pool.query(
    `
      SELECT ${postingSelectColumns()}
      FROM postings
      WHERE ${indexablePostingsWhereClause()}
      ORDER BY last_seen_epoch DESC, canonical_url ASC
      LIMIT $1;
    `,
    [sampleLimit]
  );
  return sampleResult.rows || [];
}

async function getSampleDocumentMismatches(pool, config, indexName, sampleLimit) {
  const rows = await samplePostgresRows(pool, sampleLimit);
  const samples = [];
  for (const row of rows) {
    const id = toMeiliDocumentId(row.canonical_url);
    let document = null;
    let missing = false;
    try {
      document = await meiliRequest(config, `/indexes/${encodeIndex(indexName)}/documents/${encodeURIComponent(id)}`);
    } catch {
      missing = true;
    }
    const mismatches = missing ? [{ field: "id", expected: id, actual: null }] : compareMeiliDocument(row, document);
    if (mismatches.length > 0) {
      samples.push({ canonical_url: row.canonical_url, ats_key: row.ats_key, mismatches });
    }
  }
  return { sampled: rows.length, sample_mismatches: samples };
}

async function runSampleSearches(config, indexName, queries = DEFAULT_SAMPLE_QUERIES) {
  const results = [];
  for (const query of queries) {
    const result = await meiliRequest(config, `/indexes/${encodeIndex(indexName)}/search`, {
      method: "POST",
      body: JSON.stringify({
        q: normalizeSearchQuery(query),
        limit: 5,
        filter: "hidden = false",
        sort: ["last_seen_epoch:desc"]
      })
    });
    results.push({
      query,
      estimated_total_hits: Number(result?.estimatedTotalHits || 0),
      top_canonical_urls: (result?.hits || []).map((item) => item.canonical_url).filter(Boolean).slice(0, 5)
    });
  }
  return results;
}

async function validateMeiliIndexAgainstPostgres(pool, config, indexName, options = {}) {
  const postgresCount = await getPostgresIndexableCount(pool);
  const postgresBadVisibleRows = await getPostgresBadVisibleRows(pool);
  const postgresMissingRequiredFields = await getPostgresMissingRequiredFields(pool);
  const index = config.enabled ? await getMeiliIndex(config, indexName) : { skipped: true };
  const settings = config.enabled ? await getMeiliSettings(config, indexName) : { skipped: true };
  const settingsValidation = config.enabled ? validateMeiliSettings(index, settings) : { ok: false, skipped: true, mismatches: [] };
  const stats = config.enabled ? await getMeiliStats(config, indexName) : { skipped: true, numberOfDocuments: 0 };
  const postgresRemoteFacet = await getPostgresRemoteFacet(pool, options);
  const meiliRemoteFacet = config.enabled && index?.uid ? await getMeiliRemoteFacet(config, indexName) : {};
  const remoteFacetComparison = compareFacetDistributions(postgresRemoteFacet, meiliRemoteFacet);
  const samples = config.enabled && index?.uid
    ? await getSampleDocumentMismatches(pool, config, indexName, options.sampleLimit)
    : { sampled: 0, sample_mismatches: [] };
  const sampleSearches = config.enabled && index?.uid && options.sampleSearches !== false
    ? await runSampleSearches(config, indexName)
    : [];
  const countDelta = postgresCount - Number(stats?.numberOfDocuments || 0);
  const ok =
    Boolean(settingsValidation.ok) &&
    countDelta === 0 &&
    remoteFacetComparison.ok &&
    samples.sample_mismatches.length === 0;
  return {
    ok,
    index_uid: indexName,
    postgres_indexable_count: postgresCount,
    postgres_bad_visible_rows_excluded: postgresBadVisibleRows,
    postgres_missing_required_fields: postgresMissingRequiredFields,
    meili_document_count: Number(stats?.numberOfDocuments || 0),
    count_delta: countDelta,
    postgres_remote_facet: postgresRemoteFacet,
    meili_remote_facet: meiliRemoteFacet,
    remote_facet_delta: remoteFacetComparison.deltas,
    meili_settings_valid: Boolean(settingsValidation.ok),
    meili_settings_mismatches: settingsValidation.mismatches || [],
    sampled: samples.sampled,
    sample_mismatches: samples.sample_mismatches,
    sample_searches: sampleSearches
  };
}

async function checkMeiliParity(pool, config, options) {
  const result = await validateMeiliIndexAgainstPostgres(pool, config, config.indexName, {
    sampleLimit: options.sampleLimit,
    sampleSearches: true
  });
  return {
    ...result,
    check: true
  };
}

async function buildIndexFromPostgres(pool, config, indexName, options) {
  let indexed = 0;
  let lastCanonicalUrl = "";
  while (true) {
    const result = await pool.query(
      `
        SELECT ${postingSelectColumns()}
        FROM postings
        WHERE ${indexablePostingsWhereClause()}
          AND canonical_url > $1
        ORDER BY canonical_url ASC
        LIMIT $2;
      `,
      [lastCanonicalUrl, options.batchSize]
    );

    if (result.rows.length === 0) break;
    const task = await upsertMeiliPostings(result.rows, configForIndex(config, indexName));
    await waitForMeiliTask(config, task, options.taskTimeoutMs);
    indexed += result.rows.length;
    lastCanonicalUrl = String(result.rows[result.rows.length - 1].canonical_url || "");
    if (!options.silent) console.log(`Indexed ${indexed} postings into Meilisearch index ${indexName}`);
  }
  return indexed;
}

function sanitizeIndexPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function tempIndexUid(config, options) {
  const suffix = sanitizeIndexPart(options.tempIndexSuffix) || `replace_${Date.now()}`;
  const uid = `${config.indexName}_${suffix}`;
  if (uid === config.indexName) throw new Error("Temp index UID must differ from the live index UID.");
  return uid;
}

function getReplaceSafetyGate(options) {
  const missing = [];
  if (!options.apply) missing.push("--apply");
  if (!options.confirmProduction) missing.push("--confirm-production");
  if (options.dryRun) missing.push("remove --dry-run");
  return {
    apply_requested: Boolean(options.apply),
    confirm_production: Boolean(options.confirmProduction),
    dry_run: Boolean(options.dryRun),
    authorized: missing.length === 0,
    missing
  };
}

function latestFacetDeltaSummary(delta) {
  const entries = Object.entries(delta || {});
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([key, value]) => [key, Number(value?.delta || 0)]));
}

function writeStatusSafe(status, options, env = process.env) {
  if (options.writeStatus === false) return status;
  try {
    return writeMeiliReindexStatus(status, env);
  } catch (error) {
    return {
      ...status,
      status_write_error: String(error?.message || error).slice(0, 500)
    };
  }
}

async function runReplaceReindex(pool, config, options) {
  const gate = getReplaceSafetyGate(options);
  const tempUid = tempIndexUid(config, options);
  const postgresIndexableCount = await getPostgresIndexableCount(pool);
  const startedAtEpoch = Math.floor(Date.now() / 1000);

  if (!gate.authorized) {
    return {
      ok: true,
      dry_run: true,
      replace_mode: true,
      safety_gate: gate,
      live_index_uid: config.indexName,
      temp_index_uid: tempUid,
      postgres_indexable_count: postgresIndexableCount,
      message: "Replace reindex not executed; required safety flags are missing."
    };
  }

  if (!config.enabled) {
    throw new Error("OPENJOBSLOTS_SEARCH_BACKEND=meili is required for replace-mode reindex.");
  }

  writeStatusSafe({
    ok: true,
    current_index_uid: config.indexName,
    last_task_error: "",
    last_replace_reindex: {
      status: "running",
      started_at_epoch: startedAtEpoch,
      temp_index_uid: tempUid
    }
  }, options);

  try {
    await ensureMeiliIndex(config, tempUid, options.taskTimeoutMs);
    writeStatusSafe({
      last_settings_apply: {
        index_uid: tempUid,
        applied_at_epoch: Math.floor(Date.now() / 1000)
      }
    }, options);
    const indexed = await buildIndexFromPostgres(pool, config, tempUid, options);
    const tempValidation = await validateMeiliIndexAgainstPostgres(pool, config, tempUid, {
      sampleLimit: options.sampleLimit,
      sampleSearches: true
    });

    writeStatusSafe({
      last_count_delta: tempValidation.count_delta,
      last_facet_delta: latestFacetDeltaSummary(tempValidation.remote_facet_delta)
    }, options);

    if (!tempValidation.ok) {
      writeStatusSafe({
        ok: false,
        last_task_error: "Temp index validation failed before swap.",
        last_replace_reindex: {
          status: "failed_validation",
          started_at_epoch: startedAtEpoch,
          temp_index_uid: tempUid,
          indexed
        }
      }, options);
      return {
        ok: false,
        replace_mode: true,
        swapped: false,
        indexed,
        live_index_uid: config.indexName,
        temp_index_uid: tempUid,
        validation: tempValidation,
        error: "Temp index validation failed before swap."
      };
    }

    const swapTask = await meiliRequest(config, "/swap-indexes", {
      method: "POST",
      body: JSON.stringify([{ indexes: [config.indexName, tempUid] }])
    });
    await waitForMeiliTask(config, swapTask, options.taskTimeoutMs);

    const finalValidation = await validateMeiliIndexAgainstPostgres(pool, config, config.indexName, {
      sampleLimit: options.sampleLimit,
      sampleSearches: true
    });
    let processed = { rowCount: 0 };
    if (!options.skipOutboxUpdate) {
      processed = await pool.query(
        `
          UPDATE search_index_outbox
          SET processed_at = now()
          WHERE processed_at IS NULL
            AND created_at <= to_timestamp($1);
        `,
        [startedAtEpoch]
      );
    }

    writeStatusSafe({
      ok: finalValidation.ok,
      current_index_uid: config.indexName,
      last_count_delta: finalValidation.count_delta,
      last_facet_delta: latestFacetDeltaSummary(finalValidation.remote_facet_delta),
      last_task_error: finalValidation.ok ? "" : "Post-swap validation failed.",
      last_replace_reindex: {
        status: finalValidation.ok ? "succeeded" : "post_swap_validation_failed",
        started_at_epoch: startedAtEpoch,
        finished_at_epoch: Math.floor(Date.now() / 1000),
        temp_index_uid: tempUid,
        previous_index_uid: tempUid,
        indexed,
        outbox_processed: Number(processed.rowCount || 0),
        outbox_update_skipped: Boolean(options.skipOutboxUpdate)
      }
    }, options);

    return {
      ok: finalValidation.ok,
      replace_mode: true,
      swapped: true,
      indexed,
      live_index_uid: config.indexName,
      previous_index_uid: tempUid,
      temp_index_uid: tempUid,
      outbox_processed: Number(processed.rowCount || 0),
      outbox_update_skipped: Boolean(options.skipOutboxUpdate),
      validation: finalValidation
    };
  } catch (error) {
    writeStatusSafe({
      ok: false,
      last_task_error: String(error?.message || error).slice(0, 500),
      last_replace_reindex: {
        status: "failed",
        started_at_epoch: startedAtEpoch,
        finished_at_epoch: Math.floor(Date.now() / 1000),
        temp_index_uid: tempUid
      }
    }, options);
    throw error;
  }
}

async function runIncrementalReindex(pool, config, options) {
  await ensurePostgresSchema(pool);
  await ensureMeiliIndex(config, config.indexName, options.taskTimeoutMs);
  const indexed = await buildIndexFromPostgres(pool, config, config.indexName, options);
  return { ok: true, check: false, replace_mode: false, indexed };
}

async function runReindex(pool, options = parseReindexArgs(), env = process.env) {
  const config = getMeiliConfig(env);
  try {
    if (!pool) {
      const skipped = {
        ok: true,
        skipped: true,
        reason: "OPENJOBSLOTS_DB_BACKEND is not postgres; Meili reindex checks require the Postgres source of truth."
      };
      return writeResultOutput(skipped, options);
    }

    if ((options.replaceMode || options.replaceIndex) && !options.validateOnly) {
      const runReplace = () => runReplaceReindex(pool, config, options);
      const result = getReplaceSafetyGate(options).authorized
        ? await withHeavyJobLock(pool, "meili-replace-reindex", runReplace)
        : await runReplace();
      return writeResultOutput(result, options);
    }

    if (options.check || options.validateOnly) {
      const checkResult = await checkMeiliParity(pool, config, options);
      writeStatusSafe({
        ok: checkResult.ok,
        current_index_uid: config.indexName,
        last_count_delta: checkResult.count_delta,
        last_facet_delta: latestFacetDeltaSummary(checkResult.remote_facet_delta),
        last_task_error: checkResult.ok ? "" : "Meili/Postgres validation mismatch."
      }, options, env);
      return writeResultOutput(checkResult, options);
    }

    const result = await runIncrementalReindex(pool, config, options);
    return writeResultOutput(result, options);
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
  applyMeiliSettings,
  buildIndexFromPostgres,
  checkMeiliParity,
  comparableDocumentFields,
  compareFacetDistributions,
  compareMeiliDocument,
  compareSettingList,
  ensureMeiliIndex,
  getMeiliRemoteFacet,
  getPostgresRemoteFacet,
  getReplaceSafetyGate,
  indexablePostingsWhereClause,
  meiliRequest,
  parseReindexArgs,
  runReindex,
  tempIndexUid,
  validateMeiliIndexAgainstPostgres,
  validateMeiliSettings,
  waitForMeiliTask
};
