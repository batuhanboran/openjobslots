const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const appConfig = require(path.join(repoRoot, "app.json"));
const {
  patchOpenJobSlotsAndroidSigning
} = require(path.join(repoRoot, "plugins", "withOpenJobSlotsAndroidSigning"));

const fixture = [
  "def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()",
  "",
  "android {",
  "    signingConfigs {",
  "        debug {",
  "            storeFile file('debug.keystore')",
  "        }",
  "        release {",
  "            def uploadStoreFile = findProperty('OPENJOBSLOTS_UPLOAD_STORE_FILE')",
  "            if (uploadStoreFile) {",
  "                storeFile file(uploadStoreFile)",
  "                storePassword findProperty('OPENJOBSLOTS_UPLOAD_STORE_PASSWORD')",
  "                keyAlias findProperty('OPENJOBSLOTS_UPLOAD_KEY_ALIAS')",
  "                keyPassword findProperty('OPENJOBSLOTS_UPLOAD_KEY_PASSWORD')",
  "            }",
  "        }",
  "    }",
  "    buildTypes {",
  "        release {",
  "            signingConfig signingConfigs.release",
  "            minifyEnabled false",
  "        }",
  "    }",
  "}"
].join("\n");

const patched = patchOpenJobSlotsAndroidSigning(fixture);
assert.ok(
  patched.includes("def openJobSlotsUploadStoreFile = findProperty('OPENJOBSLOTS_UPLOAD_STORE_FILE')"),
  "upload store file property should be shared between signing config and build type"
);
assert.ok(
  patched.includes("if (openJobSlotsUploadStoreFile) {\n                storeFile file(openJobSlotsUploadStoreFile)"),
  "release keystore file should only be read when upload signing is configured"
);
assert.ok(
  patched.includes("if (openJobSlotsUploadStoreFile) {\n                signingConfig signingConfigs.release\n            }"),
  "release build should only attach the upload signing config when upload signing is configured"
);
assert.ok(!patched.includes("def uploadStoreFile = findProperty"), "old local variable should be removed");
assert.ok(!patched.includes("        release {\n            signingConfig signingConfigs.release"), "unconditional release signing should be removed");
assert.strictEqual(patchOpenJobSlotsAndroidSigning(patched), patched, "patch should be idempotent");

assert.ok(
  appConfig.expo?.plugins?.includes("./plugins/withOpenJobSlotsAndroidSigning"),
  "app config should install the Android release signing config plugin"
);

const pluginPath = path.join(repoRoot, "plugins", "withOpenJobSlotsAndroidSigning.js");
assert.ok(fs.existsSync(pluginPath), "Android release signing config plugin should exist");

console.log("android release signing config checks passed");
