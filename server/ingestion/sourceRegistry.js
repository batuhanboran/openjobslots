const { getSourceModule } = require("./sources");
const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  createUnsupportedSourceModule
} = require("./sourceContracts");

const PILOT_SOURCE_METADATA = Object.freeze({
  adp_myjobs: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled
  }),
  adp_workforcenow: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  applicantpro: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  applitrack: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.quarantine
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
  brassring: Object.freeze({
    family: SOURCE_FAMILIES.brittleHighRisk,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  breezy: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  careerplug: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  careerpuck: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  careerspage: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  eightfold: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  gem: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  fountain: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  freshteam: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  getro: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.disabled
  }),
  governmentjobs: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.enabled
  }),
  greenhouse: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  hirebridge: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  hrmdirect: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  }),
  icims: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled
  }),
  isolvisolvedhire: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  jobvite: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  jobaps: Object.freeze({
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.disabled
  }),
  join: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  lever: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  loxo: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  manatal: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  oracle: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  pinpointhq: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.disabled
  }),
  recruitcrm: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.quarantine
  }),
  smartrecruiters: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled
  }),
  recruitee: Object.freeze({
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.quarantine
  }),
  rippling: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  taleo: Object.freeze({
    family: SOURCE_FAMILIES.brittleHighRisk,
    status: SOURCE_STATUSES.disabled
  }),
  talentreef: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  talentlyft: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  teamtailor: Object.freeze({
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled
  }),
  ultipro: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled
  }),
  paylocity: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled
  }),
  pageup: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false
  }),
  workday: Object.freeze({
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled
  }),
  zoho: Object.freeze({
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.canary
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
    status: metadata.status,
    collectWhenDisabled: metadata.collectWhenDisabled !== false
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
