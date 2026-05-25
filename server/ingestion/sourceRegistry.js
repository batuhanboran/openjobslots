const { getSourceModule } = require("./sources");
const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  createUnsupportedSourceModule
} = require("./sourceContracts");

const PILOT_SOURCE_METADATA = Object.freeze({
  applicantpro: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  applytojob: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  ashby: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  bamboohr: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  breezy: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  careerplug: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  greenhouse: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  hrmdirect: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  icims: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  lever: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  })
});

function normalizeSourceKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isRegistryPilotSource(atsKey) {
  return Object.hasOwn(PILOT_SOURCE_METADATA, normalizeSourceKey(atsKey));
}

function withContractMetadata(atsKey, sourceModule) {
  const key = normalizeSourceKey(atsKey);
  const metadata = PILOT_SOURCE_METADATA[key];
  if (!metadata || !sourceModule) {
    return createUnsupportedSourceModule(key || "unknown", {
      reason: "source is not registry-backed"
    });
  }

  return {
    ...sourceModule,
    atsKey: key,
    family: metadata.family,
    status: metadata.status
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
  listRegistrySourceModules
};
