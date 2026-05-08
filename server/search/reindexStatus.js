const fs = require("fs");
const path = require("path");

function getReindexStatusPath(env = process.env) {
  const configured = String(env.OPENJOBSLOTS_REINDEX_STATUS_PATH || "").trim();
  if (configured) return configured;
  const dbPath = String(env.DB_PATH || "").trim();
  const dataRoot = dbPath ? path.dirname(dbPath) : path.resolve(process.cwd(), "data");
  return path.join(dataRoot, "search-reindex-status.json");
}

function emptyReindexStatus(env = process.env) {
  return {
    ok: true,
    current_index_uid: String(env.MEILI_POSTINGS_INDEX || "postings").trim() || "postings",
    last_settings_apply: null,
    last_replace_reindex: null,
    last_count_delta: null,
    last_facet_delta: null,
    last_task_error: ""
  };
}

function readMeiliReindexStatus(env = process.env) {
  const fallback = emptyReindexStatus(env);
  const statusPath = getReindexStatusPath(env);
  try {
    if (!fs.existsSync(statusPath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    return {
      ...fallback,
      ...parsed,
      current_index_uid: String(parsed.current_index_uid || fallback.current_index_uid)
    };
  } catch (error) {
    return {
      ...fallback,
      ok: false,
      last_task_error: String(error?.message || error).slice(0, 500)
    };
  }
}

function writeMeiliReindexStatus(nextStatus, env = process.env) {
  const statusPath = getReindexStatusPath(env);
  const previous = readMeiliReindexStatus(env);
  const merged = {
    ...previous,
    ...nextStatus,
    updated_at_epoch: Math.floor(Date.now() / 1000)
  };
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

module.exports = {
  emptyReindexStatus,
  getReindexStatusPath,
  readMeiliReindexStatus,
  writeMeiliReindexStatus
};
