const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const fs = require("fs");
const path = require("path");

const rnwPath = fs.realpathSync(path.resolve(require.resolve("react-native-windows/package.json"), ".."));

const config = {
  resolver: {
    blockList: [
      new RegExp(`${path.resolve(__dirname, "windows").replace(/[/\\\\]/g, "/")}.*`),
      new RegExp(`${rnwPath.replace(/[/\\\\]/g, "/")}/build/.*`),
      new RegExp(`${rnwPath.replace(/[/\\\\]/g, "/")}/target/.*`),
      /.*\\.ProjectImports\\.zip/
    ]
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true
      }
    })
  }
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
