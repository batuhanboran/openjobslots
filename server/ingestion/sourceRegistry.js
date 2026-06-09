const { getSourceModule } = require("./sources");
const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  createUnsupportedSourceModule
} = require("./sourceContracts");

const PILOT_SOURCE_METADATA = Object.freeze(
  Object.fromEntries(
    Object.entries(require("./pilotSources.json")).map(([key, value]) => [key, Object.freeze(value)])
  )
);

const REGISTRY_SOURCE_ALIASES = Object.freeze(require("./sourceAliases.json"));

function normalizeSourceKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isRegistryPilotSource(atsKey) {
  return Object.hasOwn(PILOT_SOURCE_METADATA, normalizeSourceKey(atsKey));
}

function resolveRegistrySourceKey(value) {
  const normalized = normalizeSourceKey(value);
  if (!normalized) return "";
  if (isRegistryPilotSource(normalized)) return normalized;
  return REGISTRY_SOURCE_ALIASES[normalized] || "";
}

function withContractMetadata(atsKey, sourceModule) {
  const key = normalizeSourceKey(atsKey);
  const metadata = PILOT_SOURCE_METADATA[key];
  if (!metadata || !sourceModule) {
    return createUnsupportedSourceModule(key || "unknown", {
      reason: "source is not registry-backed"
    });
  }

  const status = sourceModule.status === SOURCE_STATUSES.unsupported
    ? SOURCE_STATUSES.unsupported
    : metadata.status;

  return {
    ...sourceModule,
    atsKey: key,
    family: metadata.family,
    status,
    collectWhenDisabled: status === SOURCE_STATUSES.unsupported
      ? false
      : metadata.collectWhenDisabled !== false
  };
}

function getRegistrySourceModule(atsKey) {
  const key = normalizeSourceKey(atsKey);
  if (!isRegistryPilotSource(key)) {
    return createUnsupportedSourceModule(key || "unknown", {
      reason: "source is not registry-backed"
    });
  }
  return withContractMetadata(key, getSourceModule(key));
}

function listRegistrySourceModules() {
  return Object.keys(PILOT_SOURCE_METADATA).map((key) => getRegistrySourceModule(key));
}

module.exports = {
  getRegistrySourceModule,
  isRegistryPilotSource,
  listRegistrySourceModules,
  resolveRegistrySourceKey
};
