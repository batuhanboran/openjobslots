const assert = require("assert");

const {
  FLYONUI_NATIVE_POLICY,
  PRODUCTION_PUBLIC_API_BASE_URL,
  PUBLIC_MOBILE_ENDPOINTS,
  isNativeStorePlatform,
  isPublicMobileApiPath,
  normalizePathname,
  resolveDefaultApiBaseUrl
} = require("./publicSurface");

assert.strictEqual(PRODUCTION_PUBLIC_API_BASE_URL, "https://openjobslots.com");
assert.deepStrictEqual(PUBLIC_MOBILE_ENDPOINTS, [
  "/postings",
  "/postings/filter-options",
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
assert.strictEqual(isPublicMobileApiPath("/search/suggest?search=design"), true);
assert.strictEqual(isPublicMobileApiPath("/sync/status?_ts=1"), true);
assert.strictEqual(isPublicMobileApiPath("/ingestion/status"), true);
assert.strictEqual(isPublicMobileApiPath("/applications"), false);
assert.strictEqual(isPublicMobileApiPath("/settings/mcp"), false);
assert.strictEqual(isPublicMobileApiPath("/frontend/log"), false);

assert.strictEqual(isNativeStorePlatform("ios"), true);
assert.strictEqual(isNativeStorePlatform("android"), true);
assert.strictEqual(isNativeStorePlatform("web"), false);
assert.strictEqual(resolveDefaultApiBaseUrl("web"), "");
assert.strictEqual(resolveDefaultApiBaseUrl("android"), "http://10.0.2.2:8787");
assert.strictEqual(resolveDefaultApiBaseUrl("ios"), "http://localhost:8787");

console.log("public mobile surface checks passed");
