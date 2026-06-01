const PRODUCTION_PUBLIC_API_BASE_URL = "https://openjobslots.com";

const PUBLIC_MOBILE_ENDPOINTS = Object.freeze([
  "/postings",
  "/postings/filter-options",
  "/search/suggest",
  "/sync/status",
  "/ingestion/status"
]);

const NATIVE_STORE_PLATFORMS = Object.freeze(["ios", "android"]);

const FLYONUI_NATIVE_POLICY = Object.freeze({
  allowedInNativeApp: false,
  allowedSurface: "web/landing/admin",
  reason: "FlyonUI depends on Tailwind CSS and DOM JavaScript components; the store app uses Expo React Native."
});

function normalizePathname(path) {
  const rawPath = String(path || "").trim();
  if (!rawPath) return "";

  try {
    const parsed = new URL(rawPath, "https://openjobslots.local");
    return parsed.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return rawPath.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  }
}

function isPublicMobileApiPath(path) {
  const pathname = normalizePathname(path);
  return PUBLIC_MOBILE_ENDPOINTS.includes(pathname);
}

function isNativeStorePlatform(platformOs) {
  return NATIVE_STORE_PLATFORMS.includes(String(platformOs || "").toLowerCase());
}

function resolveDefaultApiBaseUrl(platformOs) {
  const platform = String(platformOs || "").toLowerCase();
  if (platform === "web") return "";
  if (platform === "android") return "http://10.0.2.2:8787";
  return "http://localhost:8787";
}

function resolveRuntimeApiBaseUrl(platformOs, configuredApiBaseUrl, options = {}) {
  const configured = String(configuredApiBaseUrl || "").trim();
  if (configured) return configured;

  const isDev = options.isDev !== false;
  if (!isDev && isNativeStorePlatform(platformOs)) {
    return PRODUCTION_PUBLIC_API_BASE_URL;
  }

  return resolveDefaultApiBaseUrl(platformOs);
}

module.exports = {
  FLYONUI_NATIVE_POLICY,
  NATIVE_STORE_PLATFORMS,
  PRODUCTION_PUBLIC_API_BASE_URL,
  PUBLIC_MOBILE_ENDPOINTS,
  isNativeStorePlatform,
  isPublicMobileApiPath,
  normalizePathname,
  resolveDefaultApiBaseUrl,
  resolveRuntimeApiBaseUrl
};
