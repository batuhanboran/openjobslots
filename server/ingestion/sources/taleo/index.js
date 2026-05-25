const { createSourceModule } = require("../common");
const { buildEvidenceMetadata, hasUsefulGeoEvidence } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const parser = require("./parse");
const { createDiscover, clean } = require("./discover");
const {
  createFetchList,
  parseTaleoSourcePayload,
  taleoHasExplicitWorkMode,
  taleoSourceFailureReasons
} = require("./fetchList");

const baseModule = createSourceModule("taleo");
const discover = createDiscover();
const fetchList = createFetchList({ discover });

function normalizeCompanyName(company = {}, fallback = "Taleo") {
  return clean(company.company_name || company.name || company.company || fallback) || fallback;
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? Object.fromEntries(Object.entries(rawPayload).filter(([name]) => name !== "__sourceConfig"))
    : rawPayload;
  return parseTaleoSourcePayload(
    normalizeCompanyName(company, config.careerSectionLower || "Taleo"),
    config,
    payload
  );
}

function normalize(posting, company = {}, options = {}) {
  const normalized = baseModule.normalize(posting, company, options);
  const usefulGeo = hasUsefulGeoEvidence(normalized);
  const explicitWorkMode = taleoHasExplicitWorkMode(posting, normalized);
  if (!usefulGeo && !explicitWorkMode) {
    normalized.remote_type = "unknown";
    normalized.is_remote = false;
  }
  normalized.source_failure_reasons = taleoSourceFailureReasons(posting, normalized);
  normalized.evidence = buildEvidenceMetadata(normalized, {
    parserVersion: baseModule.parserVersion,
    sourceFamily: normalized.source_family
  });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: normalized.source_family,
    detailSupported: true
  });
  return normalized;
}

module.exports = {
  ...baseModule,
  ...parser,
  discover,
  fetchList,
  parse,
  normalize
};
