const { withAppBuildGradle } = require("@expo/config-plugins");

const UPLOAD_STORE_FILE_PROPERTY = "OPENJOBSLOTS_UPLOAD_STORE_FILE";
const UPLOAD_STORE_FILE_VARIABLE = "openJobSlotsUploadStoreFile";

function patchOpenJobSlotsAndroidSigning(contents) {
  let nextContents = String(contents || "");

  if (!nextContents.includes(`def ${UPLOAD_STORE_FILE_VARIABLE} = findProperty('${UPLOAD_STORE_FILE_PROPERTY}')`)) {
    nextContents = nextContents.replace(
      "def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()",
      [
        "def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()",
        `def ${UPLOAD_STORE_FILE_VARIABLE} = findProperty('${UPLOAD_STORE_FILE_PROPERTY}')`
      ].join("\n")
    );
  }

  nextContents = nextContents.replace(
    [
      "        release {",
      `            def uploadStoreFile = findProperty('${UPLOAD_STORE_FILE_PROPERTY}')`,
      "            if (uploadStoreFile) {",
      "                storeFile file(uploadStoreFile)"
    ].join("\n"),
    [
      "        release {",
      `            if (${UPLOAD_STORE_FILE_VARIABLE}) {`,
      `                storeFile file(${UPLOAD_STORE_FILE_VARIABLE})`
    ].join("\n")
  );

  nextContents = nextContents.replace(
    ["        release {", "            signingConfig signingConfigs.release"].join("\n"),
    ["        release {", `            if (${UPLOAD_STORE_FILE_VARIABLE}) {`, "                signingConfig signingConfigs.release", "            }"].join("\n")
  );

  return nextContents;
}

function withOpenJobSlotsAndroidSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language === "groovy") {
      modConfig.modResults.contents = patchOpenJobSlotsAndroidSigning(modConfig.modResults.contents);
    }
    return modConfig;
  });
}

module.exports = withOpenJobSlotsAndroidSigning;
module.exports.patchOpenJobSlotsAndroidSigning = patchOpenJobSlotsAndroidSigning;
