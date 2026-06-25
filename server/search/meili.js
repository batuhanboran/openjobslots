const crypto = require("crypto");
const {
  normalizeCountryFromLocation,
  normalizeRegionFromCountry,
  normalizeRemoteType: normalizePostingRemoteType
} = require("../ingestion/posting");
const {
  COUNTRY_FILTER_ALIASES,
  MEILI_POSTINGS_INDEX,
  MEILI_POSTINGS_SETTINGS,
  REGION_FILTER_ALIASES,
  normalizeAtsKey,
  normalizeFilterValue,
  normalizeSearchQuery,
  normalizeText,
  preprocessSearchOptions
} = require("./config");

let meiliSettingsStatus = {
  ok: null,
  indexName: "",
  applied_at_epoch: 0,
  last_error: ""
};

const DEFAULT_MEILI_TASK_TIMEOUT_MS = 300000;
const MIN_MEILI_TASK_TIMEOUT_MS = 5000;
const MAX_MEILI_TASK_TIMEOUT_MS = 1800000;
const PLACEHOLDER_TITLE_PATTERN = /^(untitled|unknown|n\/?a|not available|job opening|new job|open position|position)$/i;

function inferCountryFromLocation(location) {
  return normalizeCountryFromLocation(location);
}

function inferRegionFromCountry(country) {
  return normalizeRegionFromCountry(country);
}

function inferRemoteTypeFromLocation(location) {
  return normalizePostingRemoteType(location);
}

function normalizeRemoteType(value, location = "") {
  const normalized = normalizeText(value);
  if (normalized === "remote" || normalized === "hybrid" || normalized === "onsite") return normalized;
  const inferred = inferRemoteTypeFromLocation(location);
  return inferred || "unknown";
}

function getMeiliConfig(env = process.env) {
  return {
    enabled: String(env.OPENJOBSLOTS_SEARCH_BACKEND || "sqlite").trim().toLowerCase() === "meili",
    host: String(env.MEILI_HOST || "http://meilisearch:7700").trim(),
    apiKey: String(env.MEILI_MASTER_KEY || env.MEILI_API_KEY || "").trim(),
    indexName: String(env.MEILI_POSTINGS_INDEX || MEILI_POSTINGS_INDEX).trim() || MEILI_POSTINGS_INDEX,
    taskTimeoutMs: resolveMeiliTaskTimeoutMs(env)
  };
}

function resolveMeiliTaskTimeoutMs(env = process.env) {
  const raw = env.OPENJOBSLOTS_MEILI_TASK_TIMEOUT_MS ?? env.MEILI_TASK_TIMEOUT_MS ?? DEFAULT_MEILI_TASK_TIMEOUT_MS;
  const timeoutMs = Number(raw);
  if (!Number.isFinite(timeoutMs)) return DEFAULT_MEILI_TASK_TIMEOUT_MS;
  return Math.max(MIN_MEILI_TASK_TIMEOUT_MS, Math.min(MAX_MEILI_TASK_TIMEOUT_MS, Math.floor(timeoutMs)));
}

async function meiliRequest(config, path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
  };
  const response = await fetch(`${config.host}${path}`, {
    headers,
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meilisearch request failed (${response.status}): ${text.slice(0, 240)}`);
  }
  if (response.status === 204) return {};
  return response.json();
}

async function waitForMeiliTask(config, task, timeoutMs = resolveMeiliTaskTimeoutMs()) {
  const taskUid = Number(task?.taskUid ?? task?.uid ?? 0);
  if (!taskUid) return task;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await meiliRequest(config, `/tasks/${taskUid}`);
    const status = String(current?.status || "");
    if (status === "succeeded") return current;
    if (status === "failed" || status === "canceled") {
      throw new Error(`Meilisearch task ${taskUid} ${status}: ${current?.error?.message || "unknown error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Meilisearch task ${taskUid} did not finish within ${timeoutMs}ms`);
}

function isMeiliTaskTimeoutError(error) {
  return /Meilisearch task \d+ did not finish within \d+ms/i.test(String(error?.message || error));
}

function setMeiliSettingsStatus(nextStatus) {
  meiliSettingsStatus = {
    ...meiliSettingsStatus,
    ...nextStatus,
    applied_at_epoch: Math.floor(Date.now() / 1000)
  };
}

function getMeiliSettingsStatus() {
  return { ...meiliSettingsStatus };
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

function settingsMatch(actual, expected) {
  if (!actual) return false;
  for (const key of ["searchableAttributes", "filterableAttributes", "sortableAttributes", "rankingRules", "stopWords"]) {
    if (!arraysEqual(actual[key], expected[key])) return false;
  }
  const actualTypo = actual.typoTolerance || {};
  const expectedTypo = expected.typoTolerance || {};
  if (actualTypo.enabled !== expectedTypo.enabled) return false;
  if (!arraysEqual(actualTypo.disableOnAttributes, expectedTypo.disableOnAttributes)) return false;
  if (!arraysEqual(actualTypo.disableOnWords, expectedTypo.disableOnWords)) return false;
  if (actualTypo.minWordSizeForTypos?.oneTypo !== expectedTypo.minWordSizeForTypos?.oneTypo) return false;
  if (actualTypo.minWordSizeForTypos?.twoTypos !== expectedTypo.minWordSizeForTypos?.twoTypos) return false;

  const actualSynonyms = actual.synonyms || {};
  const expectedSynonyms = expected.synonyms || {};
  const actualKeys = Object.keys(actualSynonyms);
  const expectedKeys = Object.keys(expectedSynonyms);
  if (actualKeys.length !== expectedKeys.length) return false;
  for (const key of expectedKeys) {
    if (!arraysEqual(actualSynonyms[key], expectedSynonyms[key])) return false;
  }
  return true;
}

async function ensureMeiliPostingsIndex(config = getMeiliConfig()) {
  if (!config.enabled) {
    setMeiliSettingsStatus({ ok: true, skipped: true, indexName: config.indexName, last_error: "" });
    return { ok: true, skipped: true };
  }

  try {
    const taskTimeoutMs = Number.isFinite(Number(config.taskTimeoutMs))
      ? Number(config.taskTimeoutMs)
      : resolveMeiliTaskTimeoutMs();
    let existingIndex = null;
    try {
      existingIndex = await meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}`);
    } catch {
      existingIndex = null;
    }

    if (existingIndex && existingIndex.primaryKey && existingIndex.primaryKey !== "id") {
      const deleteTask = await meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}`, {
        method: "DELETE"
      });
      await waitForMeiliTask(config, deleteTask, taskTimeoutMs);
      existingIndex = null;
    }

    if (!existingIndex) {
      const createTask = await meiliRequest(config, "/indexes", {
        method: "POST",
        body: JSON.stringify({
          uid: config.indexName,
          primaryKey: "id"
        })
      });
      try {
        await waitForMeiliTask(config, createTask, taskTimeoutMs);
      } catch (error) {
        if (!/already exists/i.test(String(error?.message || error))) {
          throw error;
        }
      }
    }

    let existingSettings = null;
    if (existingIndex) {
      try {
        existingSettings = await meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/settings`);
      } catch (err) {
        console.warn("[openjobslots meili] failed to fetch existing settings; proceeding with PATCH:", err.message);
      }
    }

    if (existingIndex && existingSettings && settingsMatch(existingSettings, MEILI_POSTINGS_SETTINGS)) {
      setMeiliSettingsStatus({ ok: true, skipped: false, indexName: config.indexName, last_error: "" });
      return { ok: true, indexName: config.indexName };
    }

    const settingsTask = await meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/settings`, {
      method: "PATCH",
      body: JSON.stringify(MEILI_POSTINGS_SETTINGS)
    });
    try {
      await waitForMeiliTask(config, settingsTask, taskTimeoutMs);
    } catch (error) {
      if (existingIndex && isMeiliTaskTimeoutError(error)) {
        setMeiliSettingsStatus({
          ok: false,
          skipped: false,
          pending: true,
          indexName: config.indexName,
          last_error: String(error?.message || error).slice(0, 500)
        });
        console.warn("[openjobslots meili] settings task still processing; continuing API startup:", String(error?.message || error).slice(0, 240));
        return {
          ok: true,
          indexName: config.indexName,
          settings_pending: true,
          settings_task_uid: Number(settingsTask?.taskUid ?? settingsTask?.uid ?? 0) || null
        };
      }
      throw error;
    }
    setMeiliSettingsStatus({ ok: true, skipped: false, indexName: config.indexName, last_error: "" });
    return { ok: true, indexName: config.indexName };
  } catch (error) {
    setMeiliSettingsStatus({
      ok: false,
      skipped: false,
      indexName: config.indexName,
      last_error: String(error?.message || error).slice(0, 500)
    });
    throw error;
  }
}

function toMeiliDocumentId(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("base64url");
}

function normalizeBooleanFlag(value, defaultValue = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

const ROLE_PHRASE_TAIL_TERMS = new Set([
  "accountant",
  "administrator",
  "analyst",
  "architect",
  "associate",
  "consultant",
  "coordinator",
  "developer",
  "director",
  "engineer",
  "executive",
  "lead",
  "manager",
  "nurse",
  "operator",
  "owner",
  "recruiter",
  "representative",
  "researcher",
  "scientist",
  "specialist",
  "teacher",
  "technician"
]);

const LOCATION_QUERY_TERMS = new Set([
  "apac",
  "emea",
  "global",
  "hybrid",
  "near",
  "onsite",
  "remote",
  "uk",
  "united kingdom",
  "united states",
  "us",
  "usa",
  "worldwide",
  ...COUNTRY_FILTER_ALIASES.keys(),
  ...REGION_FILTER_ALIASES.keys()
]);

function shouldUseExactRolePhrase(rawSearch, normalizedQuery) {
  const raw = String(rawSearch || "").trim();
  const normalized = normalizeText(normalizedQuery);
  if (!raw || !normalized) return false;
  if (/[,/]/.test(raw)) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return false;
  if (tokens.some((token) => token === "in" || token === "at" || token === "near")) return false;
  if (LOCATION_QUERY_TERMS.has(normalized)) return false;
  if (tokens.some((token) => LOCATION_QUERY_TERMS.has(token))) return false;
  return ROLE_PHRASE_TAIL_TERMS.has(tokens[tokens.length - 1]);
}

function buildMeiliSearchQuery(rawSearch) {
  const normalizedQuery = normalizeSearchQuery(rawSearch);
  if (!normalizedQuery) return "";
  if (shouldUseExactRolePhrase(rawSearch, normalizedQuery)) {
    return `"${String(normalizedQuery).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return normalizedQuery;
}

function toMeiliPostingDocument(posting) {
  const canonicalUrl = String(posting?.canonical_url || posting?.job_posting_url || "").trim();
  const title = String(posting?.title || posting?.position_name || "").trim();
  const company = String(posting?.company || posting?.company_name || "").trim();
  const location = String(posting?.location || posting?.location_text || "").trim();
  const country = String(posting?.country || inferCountryFromLocation(location)).trim();
  const region = String(posting?.region || inferRegionFromCountry(country)).trim();
  return {
    id: toMeiliDocumentId(canonicalUrl),
    canonical_url: canonicalUrl,
    title,
    title_normalized: normalizeText(title),
    company,
    company_normalized: normalizeText(company),
    location,
    location_normalized: normalizeText(location),
    city: String(posting?.city || "").trim(),
    state: String(posting?.state || posting?.province || "").trim(),
    country,
    region,
    remote_type: normalizeRemoteType(posting?.remote_type, location),
    industry: String(posting?.industry || "").trim(),
    department: String(posting?.department || "").trim(),
    employment_type: String(posting?.employment_type || "").trim(),
    ats_key: normalizeAtsKey(posting?.ats_key || posting?.ATS_name),
    source_job_id: String(posting?.source_job_id || "").trim(),
    description_plain: String(posting?.description_plain || "").trim(),
    hidden: normalizeBooleanFlag(posting?.hidden, false),
    last_seen_epoch: Number(posting?.last_seen_epoch || 0),
    posted_at_epoch: Number(posting?.posted_at_epoch || posting?.posting_date_epoch || 0),
    posting_date: String(posting?.posting_date || "").trim()
  };
}

async function upsertMeiliPostings(postings, config = getMeiliConfig()) {
  if (!config.enabled) return { ok: true, skipped: true, count: 0 };
  const documents = (Array.isArray(postings) ? postings : [])
    .map(toMeiliPostingDocument)
    .filter((item) => /^https?:\/\//i.test(item.canonical_url) && item.title && item.company && !PLACEHOLDER_TITLE_PATTERN.test(item.title));
  if (documents.length === 0) return { ok: true, count: 0 };
  return meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/documents`, {
    method: "POST",
    body: JSON.stringify(documents)
  });
}

async function deleteMeiliPostingsByCanonicalUrls(canonicalUrls, config = getMeiliConfig()) {
  if (!config.enabled) return { ok: true, skipped: true, count: 0 };
  const ids = (Array.isArray(canonicalUrls) ? canonicalUrls : [])
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .map(toMeiliDocumentId);
  if (ids.length === 0) return { ok: true, count: 0 };
  return meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/documents/delete-batch`, {
    method: "POST",
    body: JSON.stringify(ids)
  });
}

async function searchMeiliPostings(options = {}, config = getMeiliConfig()) {
  options = preprocessSearchOptions(options);
  if (!config.enabled) return { ok: true, skipped: true, hits: [], estimatedTotalHits: 0 };
  const filters = ["hidden = false"];
  const sortBy = String(options.sort_by || "relevance")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const pushInFilter = (field, values) => {
    const items = (Array.isArray(values) ? values : []).map((item) => String(item || "").trim()).filter(Boolean);
    if (items.length === 0) return;
    filters.push(`${field} IN [${items.map(quote).join(", ")}]`);
  };

  pushInFilter("ats_key", options.ats);
  pushInFilter("country", (Array.isArray(options.countries) ? options.countries : []).map((item) => normalizeFilterValue(item, COUNTRY_FILTER_ALIASES)));
  pushInFilter("region", (Array.isArray(options.regions) ? options.regions : []).map((item) => normalizeFilterValue(item, REGION_FILTER_ALIASES)));
  pushInFilter("industry", options.industries);
  if (options.remote && options.remote !== "all") {
    if (options.remote === "non_remote") {
      filters.push('remote_type NOT IN ["remote", "hybrid"]');
    } else {
      filters.push(`remote_type = ${quote(options.remote)}`);
    }
  }
  if (options.hide_no_date) {
    filters.push("(posting_date EXISTS AND posting_date IS NOT EMPTY AND posting_date IS NOT NULL)");
  }
  const freshnessDays = Number(options.freshness_days || 0);
  if ([3, 7, 30].includes(freshnessDays)) {
    filters.push(`last_seen_epoch >= ${Math.floor(Date.now() / 1000) - freshnessDays * 24 * 60 * 60}`);
  }
  const sort =
    sortBy === "last_seen" || sortBy === "recent" || sortBy === "fresh_source"
      ? ["last_seen_epoch:desc"]
      : sortBy === "posted_date" || sortBy === "posted_at"
        ? ["posted_at_epoch:desc", "last_seen_epoch:desc"]
        : undefined;

  const normalizedQuery = normalizeSearchQuery(options.search);
  const q = buildMeiliSearchQuery(options.search);
  const queryTokenCount = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean).length : 0;
  const matchingStrategy = queryTokenCount >= 5 ? "last" : "all";
  const payload = {
    q,
    limit: Math.max(1, Math.min(2000, Number(options.limit || 500))),
    offset: Math.max(0, Number(options.offset || 0)),
    filter: filters.length > 0 ? filters.join(" AND ") : undefined,
    matchingStrategy,
    ...(sort ? { sort } : {})
  };
  const facets = (Array.isArray(options.facets) ? options.facets : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (facets.length > 0) {
    payload.facets = facets;
  }
  const attributesToRetrieve = (Array.isArray(options.attributesToRetrieve) ? options.attributesToRetrieve : Array.isArray(options.attributes_to_retrieve) ? options.attributes_to_retrieve : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (attributesToRetrieve.length > 0) {
    payload.attributesToRetrieve = attributesToRetrieve;
  }

  const result = await meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/search`, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (q && q !== normalizedQuery && Number(result?.estimatedTotalHits || 0) === 0) {
    return meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/search`, {
      method: "POST",
      body: JSON.stringify({ ...payload, q: normalizedQuery })
    });
  }

  return result;
}

module.exports = {
  MEILI_POSTINGS_SETTINGS,
  MEILI_POSTINGS_INDEX,
  deleteMeiliPostingsByCanonicalUrls,
  ensureMeiliPostingsIndex,
  getMeiliConfig,
  getMeiliSettingsStatus,
  resolveMeiliTaskTimeoutMs,
  searchMeiliPostings,
  toMeiliDocumentId,
  toMeiliPostingDocument,
  upsertMeiliPostings,
  waitForMeiliTask
};
