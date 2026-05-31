const SOURCE_FAMILIES = Object.freeze({
  directJsonStable: "direct-json-stable",
  enterpriseDirect: "enterprise-direct",
  embeddedOrSemiStructured: "embedded-or-semi-structured",
  vendorSpecific: "vendor-specific",
  publicSectorEducation: "public-sector-education",
  brittleHighRisk: "brittle-high-risk",
  futureCandidate: "future-candidate"
});

const SOURCE_STATUSES = Object.freeze({
  enabled: "enabled",
  canary: "canary",
  quarantine: "quarantine",
  disabled: "disabled",
  unsupported: "unsupported"
});

const REQUIRED_SOURCE_FUNCTIONS = Object.freeze([
  "discover",
  "fetchList",
  "parse",
  "normalize",
  "validate"
]);

const RECOVERY_SOURCE_FUNCTIONS = Object.freeze([
  "validatePublic",
  "rateLimit",
  "qualityThreshold",
  "fixtures"
]);

function clean(value) {
  return String(value || "").trim();
}

function validateSourceContract(sourceModule = {}) {
  const failures = [];
  const atsKey = clean(sourceModule.atsKey || sourceModule.key);
  const family = clean(sourceModule.family);
  const status = clean(sourceModule.status);

  if (!atsKey) failures.push("missing atsKey");
  if (!Object.values(SOURCE_FAMILIES).includes(family)) failures.push("invalid family");
  if (!Object.values(SOURCE_STATUSES).includes(status)) failures.push("invalid status");

  for (const name of REQUIRED_SOURCE_FUNCTIONS) {
    if (typeof sourceModule[name] !== "function") failures.push(`missing ${name}`);
  }
  if (sourceModule.fetchDetail !== undefined && typeof sourceModule.fetchDetail !== "function") {
    failures.push("invalid fetchDetail");
  }
  if (
    sourceModule.payloadShapePolicy !== undefined &&
    (!sourceModule.payloadShapePolicy || typeof sourceModule.payloadShapePolicy !== "object" || Array.isArray(sourceModule.payloadShapePolicy))
  ) {
    failures.push("invalid payloadShapePolicy");
  }

  return {
    ok: failures.length === 0,
    failures
  };
}

function validateSourceRecoveryContract(sourceModule = {}) {
  const base = validateSourceContract(sourceModule);
  const failures = [...base.failures];
  const status = clean(sourceModule.status);

  if (status === SOURCE_STATUSES.unsupported) {
    return {
      ok: failures.length === 0,
      failures,
      unsupported: true
    };
  }

  for (const name of RECOVERY_SOURCE_FUNCTIONS) {
    if (typeof sourceModule[name] !== "function") failures.push(`missing ${name}`);
  }

  if (typeof sourceModule.fixtures === "function") {
    let fixturePaths = [];
    try {
      fixturePaths = sourceModule.fixtures();
    } catch (error) {
      failures.push(`fixtures failed: ${clean(error?.message || error)}`);
    }
    if (!Array.isArray(fixturePaths) || fixturePaths.length === 0) {
      failures.push("missing fixture paths");
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    unsupported: false
  };
}

function createUnsupportedSourceModule(atsKey, options = {}) {
  const key = clean(atsKey).toLowerCase();
  const reason = clean(options.reason || "unsupported source");
  const unsupportedResult = async () => ({
    ok: false,
    status: SOURCE_STATUSES.unsupported,
    reason
  });

  return {
    atsKey: key,
    family: clean(options.family) || SOURCE_FAMILIES.futureCandidate,
    status: SOURCE_STATUSES.unsupported,
    rateLimit: Object.freeze({ requestsPerMinute: 0, strategy: "unsupported" }),
    fixtures: Object.freeze({}),
    discover: () => ({ ok: false, status: SOURCE_STATUSES.unsupported, reason }),
    fetchList: unsupportedResult,
    fetchDetail: async () => null,
    parse: () => [],
    normalize: () => null,
    validate: () => ({ ok: true, failures: [] })
  };
}

module.exports = {
  RECOVERY_SOURCE_FUNCTIONS,
  REQUIRED_SOURCE_FUNCTIONS,
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  createUnsupportedSourceModule,
  validateSourceContract,
  validateSourceRecoveryContract
};
