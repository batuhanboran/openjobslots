import { Platform } from "react-native";

const DEFAULT_API_BASE_URL =
  Platform.OS === "web"
    ? ""
    : Platform.OS === "android"
      ? "http://10.0.2.2:8787"
      : "http://localhost:8787";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createHttpError(status, bodyText, path) {
  const plainText = stripHtml(bodyText);
  let message = `Request failed (${status}). Please retry in a moment.`;
  const isTransientBusy = /SQLITE_BUSY|database is locked/i.test(plainText);
  const isAdminAuthError = Number(status) === 401 || Number(status) === 403;

  if (isTransientBusy) {
    message = "The database is busy while sync is writing. Please retry in a moment.";
  } else if (isAdminAuthError) {
    message = "Admin access required.";
  } else if (/SQLITE_ERROR/i.test(plainText)) {
    message = "The backend hit a database error. Details were logged for debugging.";
  } else if (Number(status) >= 500) {
    message = "The backend hit an internal error. Details were logged for debugging.";
  }

  const error = new Error(message);
  error.status = status;
  error.path = path;
  error.isAdminAuthError = isAdminAuthError;
  Object.defineProperty(error, "backendText", {
    value: bodyText,
    enumerable: false
  });
  error.isTransientBusy = isTransientBusy;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const method = String(options?.method || "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 3 : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options
    });

    if (res.ok) {
      return res.json();
    }

    const text = await res.text();
    const error = createHttpError(res.status, text, path);
    lastError = error;

    if (!error.isTransientBusy || attempt >= maxAttempts) {
      throw error;
    }

    await sleep(150 * attempt);
  }

  throw lastError || new Error("Request failed. Please retry in a moment.");
}

export function fetchPostings(search = "", limit = 500, offset = 0, filters = {}) {
  const params = new URLSearchParams({
    search,
    limit: String(limit),
    offset: String(offset),
    include_applied: filters?.include_applied === undefined ? "0" : filters?.include_applied ? "1" : "0",
    include_ignored: filters?.include_ignored === undefined ? "0" : filters?.include_ignored ? "1" : "0"
  });

  const atsArray = Array.isArray(filters?.ats) ? filters.ats.filter(Boolean) : [];
  const atsSingle = !Array.isArray(filters?.ats) ? String(filters?.ats || "").trim().toLowerCase() : "";
  const industries = Array.isArray(filters?.industries) ? filters.industries.filter(Boolean) : [];
  const states = Array.isArray(filters?.states) ? filters.states.filter(Boolean) : [];
  const counties = Array.isArray(filters?.counties) ? filters.counties.filter(Boolean) : [];
  const countries = Array.isArray(filters?.countries) ? filters.countries.filter(Boolean) : [];
  const regions = Array.isArray(filters?.regions) ? filters.regions.filter(Boolean) : [];
  const remote = String(filters?.remote || "all").trim().toLowerCase();
  const freshnessDays = Number(filters?.freshness_days || 0);
  const sortBy = String(filters?.sort_by || "relevance").trim().toLowerCase();

  if (atsArray.length > 0) {
    params.set("ats", atsArray.join(","));
  } else if (atsSingle && atsSingle !== "all") {
    params.set("ats", atsSingle);
  }
  if (industries.length > 0) {
    params.set("industries", industries.join(","));
  }
  if (states.length > 0) {
    params.set("states", states.join(","));
  }
  if (counties.length > 0) {
    params.set("counties", counties.join(","));
  }
  if (countries.length > 0) {
    params.set("countries", countries.join(","));
  }
  if (regions.length > 0) {
    params.set("regions", regions.join(","));
  }
  if (remote && remote !== "all") {
    params.set("remote", remote);
  }
  if (filters?.hide_no_date) {
    params.set("hide_no_date", "1");
  }
  if ([3, 7, 30].includes(freshnessDays)) {
    params.set("freshness_days", String(freshnessDays));
  }
  if (sortBy && sortBy !== "relevance") {
    params.set("sort_by", sortBy);
  } else {
    params.set("sort_by", "relevance");
  }

  return request(`/postings?${params.toString()}`);
}

export function fetchPostingFilterOptions(search = "", filters = {}) {
  const params = new URLSearchParams();
  const query = String(search || "").trim();
  const atsArray = Array.isArray(filters?.ats) ? filters.ats.filter(Boolean) : [];
  const atsSingle = !Array.isArray(filters?.ats) ? String(filters?.ats || "").trim().toLowerCase() : "";
  const industries = Array.isArray(filters?.industries) ? filters.industries.filter(Boolean) : [];
  const states = Array.isArray(filters?.states) ? filters.states.filter(Boolean) : [];
  const counties = Array.isArray(filters?.counties) ? filters.counties.filter(Boolean) : [];
  const countries = Array.isArray(filters?.countries) ? filters.countries.filter(Boolean) : [];
  const regions = Array.isArray(filters?.regions) ? filters.regions.filter(Boolean) : [];
  const remote = String(filters?.remote || "all").trim().toLowerCase();
  const freshnessDays = Number(filters?.freshness_days || 0);

  if (query) params.set("search", query);
  if (atsArray.length > 0) params.set("ats", atsArray.join(","));
  else if (atsSingle && atsSingle !== "all") params.set("ats", atsSingle);
  if (industries.length > 0) params.set("industries", industries.join(","));
  if (states.length > 0) params.set("states", states.join(","));
  if (counties.length > 0) params.set("counties", counties.join(","));
  if (countries.length > 0) params.set("countries", countries.join(","));
  if (regions.length > 0) params.set("regions", regions.join(","));
  if (remote && remote !== "all") params.set("remote", remote);
  if (filters?.hide_no_date) params.set("hide_no_date", "1");
  if ([3, 7, 30].includes(freshnessDays)) params.set("freshness_days", String(freshnessDays));
  const suffix = params.toString();
  return request(`/postings/filter-options${suffix ? `?${suffix}` : ""}`);
}

export function fetchSearchSuggestions(search = "", limit = 8) {
  const params = new URLSearchParams({
    search,
    limit: String(limit),
    _ts: String(Date.now())
  });
  return request(`/search/suggest?${params.toString()}`);
}

export function fetchPublicPreferences() {
  return request(`/public/preferences?_ts=${Date.now()}`);
}

export function fetchApplications(limit = 500, offset = 0, status = "") {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    _ts: String(Date.now())
  });
  if (String(status || "").trim()) {
    params.set("status", String(status).trim());
  }
  return request(`/applications?${params.toString()}`);
}

export function createApplication(payload) {
  return request("/applications", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function ignorePosting(payload) {
  return request("/postings/ignore", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function updateApplicationStatus(applicationId, status) {
  return request(`/applications/${applicationId}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function deleteApplication(applicationId) {
  return request(`/applications/${applicationId}`, {
    method: "DELETE"
  });
}

export function fetchSyncStatus() {
  return request(`/sync/status?_ts=${Date.now()}`);
}

export function triggerWorkdaySync(wait = false) {
  const suffix = wait ? "?wait=1" : "";
  return request(`/sync/ats${suffix}`, { method: "POST" });
}

export function startSync(wait = false) {
  const suffix = wait ? "?wait=1" : "";
  return request(`/sync/start${suffix}`, { method: "POST" });
}

export function stopSync() {
  return request("/sync/stop", { method: "POST" });
}

export function fetchPersonalInformation() {
  return request("/settings/personal-information");
}

export function savePersonalInformation(payload) {
  return request("/settings/personal-information", {
    method: "PUT",
    body: JSON.stringify(payload || {})
  });
}

export function fetchMcpSettings() {
  return request("/settings/mcp");
}

export function saveMcpSettings(payload) {
  return request("/settings/mcp", {
    method: "PUT",
    body: JSON.stringify(payload || {})
  });
}

export function fetchSyncServiceSettings() {
  return request("/settings/sync");
}

export function saveSyncServiceSettings(payload) {
  return request("/settings/sync", {
    method: "PUT",
    body: JSON.stringify(payload || {})
  });
}

export function fetchBlockedCompanies() {
  return request("/settings/sync/blocked-companies");
}

export function blockCompany(payload) {
  return request("/settings/sync/blocked-companies", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function unblockCompany(payload) {
  return request("/settings/sync/blocked-companies/unblock", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function migrateDatabaseSettings(payload) {
  return request("/settings/migrate-db", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function fetchMcpCandidates(filters = {}) {
  const params = new URLSearchParams();
  const limit = Number(filters?.limit || 0);

  if (filters?.search) params.set("search", String(filters.search).trim());
  if (Array.isArray(filters?.ats) && filters.ats.length > 0) {
    params.set("ats", filters.ats.filter(Boolean).join(","));
  } else if (filters?.ats && String(filters.ats).trim().toLowerCase() !== "all") {
    params.set("ats", String(filters.ats).trim().toLowerCase());
  }
  if (Array.isArray(filters?.industries) && filters.industries.length > 0) {
    params.set("industries", filters.industries.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.states) && filters.states.length > 0) {
    params.set("states", filters.states.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.counties) && filters.counties.length > 0) {
    params.set("counties", filters.counties.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.countries) && filters.countries.length > 0) {
    params.set("countries", filters.countries.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.regions) && filters.regions.length > 0) {
    params.set("regions", filters.regions.filter(Boolean).join(","));
  }
  if (filters?.remote) params.set("remote", String(filters.remote));
  if (filters?.include_applied !== undefined) {
    params.set("include_applied", filters.include_applied ? "1" : "0");
  }
  if (filters?.use_settings !== undefined) {
    params.set("use_settings", filters.use_settings ? "1" : "0");
  }
  if (Number.isFinite(limit) && limit > 0) {
    params.set("limit", String(limit));
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/mcp/candidates${suffix}`);
}

export function fetchMcpCoverLetterDraft(payload) {
  return request("/mcp/cover-letter-draft", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function completeMcpApplication(payload) {
  return request("/mcp/applications/complete", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export async function postFrontendLog(payload) {
  try {
    return await request("/frontend/log", {
      method: "POST",
      body: JSON.stringify(payload || {})
    });
  } catch {
    return { ok: false };
  }
}

export { API_BASE_URL };
