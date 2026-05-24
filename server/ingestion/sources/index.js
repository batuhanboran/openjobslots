const {
  SOURCE_SPECS,
  createSourceModule,
  getSourceSpec,
  setLegacyCollectPostingsForCompany
} = require("./common");

const modules = new Map(
  Object.keys(SOURCE_SPECS).map((atsKey) => [atsKey, createSourceModule(atsKey)])
);

function getSourceModule(atsKey) {
  return modules.get(String(atsKey || "").trim().toLowerCase()) || null;
}

module.exports = {
  DIRECT_SOURCE_ATS_KEYS: Object.freeze(Array.from(modules.keys())),
  getSourceModule,
  getSourceSpec,
  setLegacyCollectPostingsForCompany,
  sourceModules: modules
};
