const {
  SOURCE_FAMILIES,
  createUnsupportedSourceModule
} = require("../../sourceContracts");

module.exports = createUnsupportedSourceModule("dayforcehcm", {
  family: SOURCE_FAMILIES.enterpriseDirect,
  reason: "Dayforce HCM source is disabled until parser fixtures certify the public API contract."
});
