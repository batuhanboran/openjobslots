const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const version = "3.0.1";

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const appJson = readJson("app.json");
const webPackage = readJson("web/package.json");
const webLock = readJson("web/package-lock.json");

assert.equal(packageJson.version, version);
assert.equal(packageLock.version, version);
assert.equal(packageLock.packages[""].version, version);
assert.equal(appJson.expo.version, version);
assert.equal(appJson.expo.android.versionCode, 11);
assert.equal(appJson.expo.ios.buildNumber, "2");
assert.equal(webPackage.version, version);
assert.equal(webLock.version, version);
assert.equal(webLock.packages[""].version, version);

const app = read("App.js");
const webSite = read("web/src/lib/site.ts");
const webNotes = read("web/src/lib/releaseNotes.ts");
const webDeploy = read("web/DEPLOY.md");
assert.match(app, /version: "3\.0\.1",\s*date: "August 24, 2026"/);
assert.match(app, /"3\.0\.1": \{\s*title: "Altyapı kararlılığı ve hızlı genel arama"/);
assert.match(webSite, /APP_VERSION = "3\.0\.1"/);
assert.match(webNotes, /version: "3\.0\.1",\s*date: "24 Ağu 2026"/);
assert.match(webDeploy, /openjobslots-web:3\.0\.1/g);

console.log("infra version release checks passed");
