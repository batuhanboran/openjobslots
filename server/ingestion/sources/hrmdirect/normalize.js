const { buildEvidenceMetadata, hasUsefulGeoEvidence } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { normalizeRemoteType } = require("../../posting");
const { clean } = require("./helpers");

function createNormalize(baseModule) {
  return function normalize(posting, company = {}, options = {}) {
    const normalized = baseModule.normalize(posting, company, options);
    const sourceEvidence = {
      ...(posting?.source_evidence || {}),
      ...(normalized?.source_evidence || {})
    };
    const patch = {};

    if (
      clean(sourceEvidence.location_rule_name) === "hrmdirect_detail_office_state" &&
      clean(normalized?.country).toLowerCase() === "united states" &&
      clean(normalized?.city).toLowerCase() === clean(normalized?.location_text || normalized?.location).toLowerCase()
    ) {
      patch.city = "";
    }
    if (!clean(sourceEvidence.remote_source || sourceEvidence.remote_path)) {
      if (
        ["remote", "hybrid"].includes(normalizeRemoteType(normalized?.location_text)) &&
        clean(sourceEvidence.location_source || sourceEvidence.location_path)
      ) {
        Object.assign(normalized, patch);
      } else if (hasUsefulGeoEvidence({ ...normalized, ...patch })) {
        if (["remote", "hybrid"].includes(clean(normalized?.remote_type).toLowerCase())) {
          Object.assign(normalized, patch, {
            remote_type: "onsite",
            is_remote: false
          });
        } else {
          Object.assign(normalized, patch);
        }
      } else {
        Object.assign(normalized, patch, {
          remote_type: "unknown",
          is_remote: false
        });
      }
    } else {
      Object.assign(normalized, patch);
    }

    normalized.evidence = buildEvidenceMetadata(normalized, {
      parserVersion: baseModule.parserVersion,
      sourceFamily: normalized.source_family
    });
    normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
      sourceFamily: normalized.source_family,
      detailSupported: true
    });
    return normalized;
  };
}

module.exports = {
  createNormalize
};
