const assert = require("assert");

const {
  FLYONUI_NATIVE_POLICY,
  PRODUCTION_PUBLIC_API_BASE_URL,
  PUBLIC_MOBILE_ENDPOINTS,
  isNativeStorePlatform,
  isPublicMobileApiPath,
  normalizePathname,
  resolveDefaultApiBaseUrl,
  resolveRuntimeApiBaseUrl
} = require("./publicSurface");

assert.strictEqual(PRODUCTION_PUBLIC_API_BASE_URL, "https://openjobslots.com");
assert.deepStrictEqual(PUBLIC_MOBILE_ENDPOINTS, [
  "/postings",
  "/postings/filter-options",
  "/search/popular",
  "/search/suggest",
  "/sync/status",
  "/ingestion/status"
]);

assert.strictEqual(FLYONUI_NATIVE_POLICY.allowedInNativeApp, false);
assert.strictEqual(FLYONUI_NATIVE_POLICY.allowedSurface, "web/landing/admin");

assert.strictEqual(normalizePathname("/postings?search=engineer"), "/postings");
assert.strictEqual(normalizePathname("https://openjobslots.com/search/suggest?q=dev"), "/search/suggest");

assert.strictEqual(isPublicMobileApiPath("/postings?limit=80"), true);
assert.strictEqual(isPublicMobileApiPath("/postings/filter-options?remote=remote"), true);
assert.strictEqual(isPublicMobileApiPath("/search/popular?language=en&country=US"), true);
assert.strictEqual(isPublicMobileApiPath("/search/suggest?search=design"), true);
assert.strictEqual(isPublicMobileApiPath("/sync/status?_ts=1"), true);
assert.strictEqual(isPublicMobileApiPath("/ingestion/status"), true);
assert.strictEqual(isPublicMobileApiPath("/applications"), false);
assert.strictEqual(isPublicMobileApiPath("/settings/mcp"), false);
assert.strictEqual(isPublicMobileApiPath("/frontend/log"), false);

assert.strictEqual(isNativeStorePlatform("ios"), true);
assert.strictEqual(isNativeStorePlatform("android"), true);
assert.strictEqual(isNativeStorePlatform("web"), false);
assert.strictEqual(resolveDefaultApiBaseUrl("web"), "https://openjobslots.com");
assert.strictEqual(resolveDefaultApiBaseUrl("android"), "https://openjobslots.com");
assert.strictEqual(resolveDefaultApiBaseUrl("ios"), "https://openjobslots.com");
assert.strictEqual(resolveRuntimeApiBaseUrl("android", "", { isDev: true }), "https://openjobslots.com");
assert.strictEqual(resolveRuntimeApiBaseUrl("ios", "", { isDev: true }), "https://openjobslots.com");
assert.strictEqual(resolveRuntimeApiBaseUrl("android", "", { isDev: false }), "https://openjobslots.com");
assert.strictEqual(resolveRuntimeApiBaseUrl("ios", "", { isDev: false }), "https://openjobslots.com");
assert.strictEqual(resolveRuntimeApiBaseUrl("web", "", { isDev: false }), "https://openjobslots.com");
assert.strictEqual(resolveRuntimeApiBaseUrl("android", "https://example.test", { isDev: false }), "https://example.test");
assert.strictEqual(resolveRuntimeApiBaseUrl("android", "http://localhost:8787", { isDev: false }), "https://openjobslots.com");

// Test E2E mode
process.env.EXPO_PUBLIC_E2E = "1";
assert.strictEqual(resolveRuntimeApiBaseUrl("android", "http://localhost:8787", { isDev: false }), "http://localhost:8787");
delete process.env.EXPO_PUBLIC_E2E;

console.log("public mobile surface checks passed");
