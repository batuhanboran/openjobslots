const {
  SOURCE_SPECS,
  createSourceModule,
  getSourceSpec,
  setLegacyCollectPostingsForCompany
} = require("./common");

const LOCAL_ONLY_SOURCE_ATS_KEYS = Object.freeze(["talexio"]);

function loadSourceModule(atsKey) {
  const key = String(atsKey || "").trim().toLowerCase();
  const spec = getSourceSpec(key);
  const baseModule = spec ? createSourceModule(key) : null;
  let modulePath = "";
  try {
    modulePath = require.resolve(`./${key}`);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return baseModule;
    throw error;
  }
  const localModule = require(modulePath);
  if (!baseModule) {
    return hasSourceModuleContractShape(localModule) ? localModule : null;
  }
  return {
    ...baseModule,
    ...(localModule || {})
  };
}

function hasSourceModuleContractShape(sourceModule = {}) {
  return ["discover", "fetchList", "parse", "normalize", "validate"].every(
    (name) => typeof sourceModule?.[name] === "function"
  );
}

const modules = new Map(
  Array.from(new Set([...Object.keys(SOURCE_SPECS), ...LOCAL_ONLY_SOURCE_ATS_KEYS]))
    .map((atsKey) => [atsKey, loadSourceModule(atsKey)])
    .filter(([, sourceModule]) => sourceModule)
);

function getSourceModule(atsKey) {
  const key = String(atsKey || "").trim().toLowerCase();
  if (modules.has(key)) return modules.get(key);
  const localModule = loadSourceModule(key);
  if (localModule) modules.set(key, localModule);
  return localModule || null;
}

module.exports = {
  DIRECT_SOURCE_ATS_KEYS: Object.freeze(Array.from(modules.keys())),
  getSourceModule,
  getSourceSpec,
  loadSourceModule,
  setLegacyCollectPostingsForCompany,
  sourceModules: modules
};
