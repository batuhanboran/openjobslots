const {
  SOURCE_SPECS,
  createSourceModule,
  getSourceSpec,
  setLegacyCollectPostingsForCompany
} = require("./common");

function loadSourceModule(atsKey) {
  const baseModule = createSourceModule(atsKey);
  let modulePath = "";
  try {
    modulePath = require.resolve(`./${atsKey}`);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return baseModule;
    throw error;
  }
  const localModule = require(modulePath);
  return {
    ...baseModule,
    ...(localModule || {})
  };
}

const modules = new Map(
  Object.keys(SOURCE_SPECS).map((atsKey) => [atsKey, loadSourceModule(atsKey)])
);

function getSourceModule(atsKey) {
  return modules.get(String(atsKey || "").trim().toLowerCase()) || null;
}

module.exports = {
  DIRECT_SOURCE_ATS_KEYS: Object.freeze(Array.from(modules.keys())),
  getSourceModule,
  getSourceSpec,
  loadSourceModule,
  setLegacyCollectPostingsForCompany,
  sourceModules: modules
};
