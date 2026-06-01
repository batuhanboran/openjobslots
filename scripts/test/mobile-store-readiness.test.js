const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const appConfig = require(path.join(repoRoot, "app.json"));
const packageJson = require(path.join(repoRoot, "package.json"));
const {
  FLYONUI_NATIVE_POLICY,
  PRODUCTION_PUBLIC_API_BASE_URL,
  PUBLIC_MOBILE_ENDPOINTS
} = require(path.join(repoRoot, "src", "mobile", "publicSurface"));

const easJsonPath = path.join(repoRoot, "eas.json");
assert.ok(fs.existsSync(easJsonPath), "eas.json must exist for store build profiles");
const easJson = JSON.parse(fs.readFileSync(easJsonPath, "utf8"));

const expo = appConfig.expo || {};
assert.strictEqual(expo.name, "OJS", "Android launcher label should stay short enough for mobile home screens");
assert.ok(expo.name.length <= 4, "Android launcher label should not hyphen-wrap the product name");
assert.ok((expo.platforms || []).includes("ios"), "Expo config must include ios");
assert.ok((expo.platforms || []).includes("android"), "Expo config must include android");
assert.strictEqual(expo.ios?.bundleIdentifier, "com.openjobslots.app");
assert.strictEqual(expo.android?.package, "com.openjobslots.app");
assert.strictEqual(expo.scheme, "openjobslots");

for (const profileName of ["development", "preview", "production"]) {
  assert.strictEqual(
    easJson.build?.[profileName]?.env?.EXPO_PUBLIC_API_BASE_URL,
    PRODUCTION_PUBLIC_API_BASE_URL,
    `${profileName} build must target the public production API`
  );
}

assert.deepStrictEqual(PUBLIC_MOBILE_ENDPOINTS, [
  "/postings",
  "/postings/filter-options",
  "/search/suggest",
  "/sync/status",
  "/ingestion/status"
]);
assert.strictEqual(FLYONUI_NATIVE_POLICY.allowedInNativeApp, false);
assert.ok(!packageJson.dependencies?.flyonui, "FlyonUI must not be a native app dependency");
assert.ok(!packageJson.devDependencies?.flyonui, "FlyonUI must not be a native app devDependency");

console.log("mobile store readiness checks passed");
