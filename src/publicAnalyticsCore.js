const MAX_ANALYTICS_VALUE_LENGTH = 80;
const SAFE_EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isLikelyPii(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return true;
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(text)) return true;
  if (/\b[A-Za-z0-9.-]+\.[A-Za-z]{2,}\/\S*/.test(text)) return true;
  const digitCount = (text.match(/\d/g) || []).length;
  return digitCount >= 10 && /^[\d\s()+.-]+$/.test(text);
}

function truncateAnalyticsValue(value) {
  const normalized = collapseWhitespace(value);
  if (!normalized) return "";
  return normalized.slice(0, MAX_ANALYTICS_VALUE_LENGTH);
}

function sanitizeAnalyticsSearchTerm(value) {
  const normalized = truncateAnalyticsValue(value);
  if (!normalized || isLikelyPii(normalized)) return "";
  return normalized;
}

function sanitizeAnalyticsStringValue(value) {
  const normalized = truncateAnalyticsValue(value);
  if (!normalized || isLikelyPii(normalized)) return "";
  return normalized;
}

function sanitizeAnalyticsKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,39}$/.test(normalized) ? normalized : "";
}

function sanitizeAnalyticsParams(params = {}) {
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(params || {})) {
    const key = sanitizeAnalyticsKey(rawKey);
    if (!key) continue;
    if (typeof rawValue === "boolean") {
      result[key] = rawValue;
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      result[key] = rawValue;
    } else {
      const value = sanitizeAnalyticsStringValue(rawValue);
      if (value) result[key] = value;
    }
  }
  return result;
}

function getGtag() {
  if (typeof window === "undefined") return null;
  return typeof window.gtag === "function" ? window.gtag : null;
}

function trackPublicAnalyticsEvent(eventName, params = {}) {
  const normalizedEventName = String(eventName || "").trim();
  if (!SAFE_EVENT_NAME_PATTERN.test(normalizedEventName)) return false;

  const gtag = getGtag();
  if (!gtag) return false;

  const safeParams = sanitizeAnalyticsParams(params);
  gtag("event", normalizedEventName, safeParams);
  return true;
}

function trackPublicSearch(searchTerm, context = {}) {
  const safeTerm = sanitizeAnalyticsSearchTerm(searchTerm);
  if (!safeTerm) return false;

  return trackPublicAnalyticsEvent("search", {
    search_term: safeTerm,
    search_source: context.source || "search_box"
  });
}

function trackPublicFilterChange(filterType) {
  return trackPublicAnalyticsEvent("openjobslots_filter_changed", {
    filter_type: String(filterType || "").trim().toLowerCase()
  });
}

function trackPublicApplyClick(posting = {}) {
  return trackPublicAnalyticsEvent("openjobslots_apply_click", {
    ats: posting?.ats || "unknown"
  });
}

module.exports = {
  sanitizeAnalyticsParams,
  sanitizeAnalyticsSearchTerm,
  trackPublicAnalyticsEvent,
  trackPublicApplyClick,
  trackPublicFilterChange,
  trackPublicSearch
};
