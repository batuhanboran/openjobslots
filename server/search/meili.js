const MEILI_POSTINGS_INDEX = "postings";
const crypto = require("crypto");

const SEARCH_STOP_WORDS = new Set([
  "job",
  "jobs",
  "posting",
  "postings",
  "opening",
  "openings",
  "career",
  "careers",
  "role",
  "roles",
  "position",
  "positions"
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cleanSearchToken(value) {
  return String(value || "")
    .trim()
    .replace(/^[`"“”'‘’]+|[`"“”'‘’]+$/g, "")
    .replace(/[“”]/g, "")
    .trim();
}

function normalizeAtsKey(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, "");
  const aliases = {
    ashbyhq: "ashby",
    leverco: "lever",
    greenhouseio: "greenhouse",
    greenhouse: "greenhouse",
    breezyhr: "breezy",
    oraclecloud: "oracle",
    pinpointhqcom: "pinpointhq",
    recruitcrmio: "recruitcrm",
    loxoco: "loxo",
    icims: "icims",
    applicantai: "applicantai",
    workforcenow: "adp_workforcenow"
  };
  return aliases[normalized] || normalized;
}

function normalizeSearchQuery(value) {
  const tokens = String(value || "")
    .trim()
    .split(/\s+/)
    .map(cleanSearchToken)
    .filter(Boolean);
  if (tokens.length <= 1) return tokens.join(" ");
  const meaningfulTokens = tokens.filter((token) => !SEARCH_STOP_WORDS.has(normalizeText(token)));
  return (meaningfulTokens.length > 0 ? meaningfulTokens : tokens).join(" ");
}

const COUNTRY_FILTER_ALIASES = new Map([
  ["us", "United States"],
  ["usa", "United States"],
  ["u.s.", "United States"],
  ["u.s.a.", "United States"],
  ["united states", "United States"],
  ["united states of america", "United States"],
  ["uk", "United Kingdom"],
  ["u.k.", "United Kingdom"],
  ["gb", "United Kingdom"],
  ["great britain", "United Kingdom"],
  ["turkiye", "Turkey"],
  ["türkiye", "Turkey"],
  ["turkey", "Turkey"],
  ["turkish", "Turkey"],
  ["ca", "Canada"],
  ["can", "Canada"],
  ["canada", "Canada"],
  ["de", "Germany"],
  ["deutschland", "Germany"],
  ["germany", "Germany"],
  ["fr", "France"],
  ["france", "France"]
]);

const REGION_FILTER_ALIASES = new Map([
  ["amer", "North America"],
  ["americas", "North America"],
  ["america", "North America"],
  ["north america", "North America"],
  ["na", "North America"],
  ["northamerica", "North America"],
  ["emea", "EMEA"],
  ["europe", "EMEA"],
  ["europe middle east africa", "EMEA"],
  ["apac", "APAC"],
  ["asia pacific", "APAC"]
]);

function normalizeFilterValue(value, aliases) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = normalizeText(raw).replace(/\s+/g, " ");
  return aliases.get(normalized) || raw;
}

function getMeiliConfig(env = process.env) {
  return {
    enabled: String(env.OPENJOBSLOTS_SEARCH_BACKEND || "sqlite").trim().toLowerCase() === "meili",
    host: String(env.MEILI_HOST || "http://meilisearch:7700").trim(),
    apiKey: String(env.MEILI_MASTER_KEY || env.MEILI_API_KEY || "").trim(),
    indexName: String(env.MEILI_POSTINGS_INDEX || MEILI_POSTINGS_INDEX).trim() || MEILI_POSTINGS_INDEX
  };
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

async function waitForMeiliTask(config, task, timeoutMs = 30000) {
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

async function ensureMeiliPostingsIndex(config = getMeiliConfig()) {
  if (!config.enabled) return { ok: true, skipped: true };

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
    await waitForMeiliTask(config, deleteTask);
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
      await waitForMeiliTask(config, createTask);
    } catch (error) {
      if (!/already exists/i.test(String(error?.message || error))) {
        throw error;
      }
    }
  }

  const settingsTask = await meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      searchableAttributes: [
        "title",
        "company",
        "location",
        "country",
        "region",
        "description_plain",
        "ats_key"
      ],
      filterableAttributes: [
        "ats_key",
        "country",
        "region",
        "remote_type",
        "industry",
        "company",
        "hidden",
        "last_seen_epoch",
        "posted_at_epoch",
        "posting_date"
      ],
      sortableAttributes: ["last_seen_epoch", "posted_at_epoch"],
      synonyms: {
        turkey: ["turkiye", "t\u00fcrkiye", "turkish"],
        turkiye: ["turkey", "t\u00fcrkiye", "turkish"],
        "t\u00fcrkiye": ["turkey", "turkiye", "turkish"],
        turkish: ["turkey", "turkiye", "t\u00fcrkiye"],
        remote: ["wfh", "work from home", "anywhere"]
      },
      typoTolerance: {
        enabled: true,
        disableOnAttributes: ["ats_key"]
      }
    })
  });
  await waitForMeiliTask(config, settingsTask);

  return { ok: true, indexName: config.indexName };
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

function toMeiliPostingDocument(posting) {
  const canonicalUrl = String(posting?.canonical_url || posting?.job_posting_url || "").trim();
  return {
    id: toMeiliDocumentId(canonicalUrl),
    canonical_url: canonicalUrl,
    title: String(posting?.title || posting?.position_name || "").trim(),
    company: String(posting?.company || posting?.company_name || "").trim(),
    location: String(posting?.location || posting?.location_text || "").trim(),
    country: String(posting?.country || "").trim(),
    region: String(posting?.region || "").trim(),
    remote_type: String(posting?.remote_type || "unknown").trim(),
    industry: String(posting?.industry || "").trim(),
    ats_key: normalizeAtsKey(posting?.ats_key || posting?.ATS_name),
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
    .filter((item) => item.canonical_url && item.title && item.company);
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
  if (!config.enabled) return { ok: true, skipped: true, hits: [], estimatedTotalHits: 0 };
  const filters = ["NOT hidden = true"];
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
    filters.push("posted_at_epoch > 0");
  }

  return meiliRequest(config, `/indexes/${encodeURIComponent(config.indexName)}/search`, {
    method: "POST",
    body: JSON.stringify({
      q: normalizeSearchQuery(options.search),
      limit: Math.max(1, Math.min(2000, Number(options.limit || 500))),
      offset: Math.max(0, Number(options.offset || 0)),
      filter: filters.length > 0 ? filters.join(" AND ") : undefined,
      sort: ["last_seen_epoch:desc"]
    })
  });
}

module.exports = {
  MEILI_POSTINGS_INDEX,
  deleteMeiliPostingsByCanonicalUrls,
  ensureMeiliPostingsIndex,
  getMeiliConfig,
  searchMeiliPostings,
  toMeiliPostingDocument,
  upsertMeiliPostings
};
