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

const { extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");

function enrichPostingFromJsonLd(posting, html) {
  if (!html) return posting;
  const objects = extractJsonLdObjectsFromHtml(html);
  const jobPosting = objects.find(obj => {
    const type = String(obj?.["@type"] || "").toLowerCase();
    return type === "jobposting" || type.includes("jobposting");
  });

  if (!jobPosting) return posting;

  const detailFields = {};

  const loc = jobPosting.jobLocation;
  if (loc) {
    const address = Array.isArray(loc) ? loc[0]?.address : loc.address;
    if (address) {
      const parts = [];
      if (address.streetAddress) parts.push(String(address.streetAddress).trim());
      if (address.addressLocality) parts.push(String(address.addressLocality).trim());
      if (address.addressRegion) parts.push(String(address.addressRegion).trim());
      if (address.addressCountry) {
        if (typeof address.addressCountry === "object") {
          parts.push(String(address.addressCountry.name || address.addressCountry.code || "").trim());
        } else {
          parts.push(String(address.addressCountry).trim());
        }
      }
      const filtered = parts.filter(Boolean);
      if (filtered.length > 0) {
        detailFields.location = filtered.join(", ");
      }
    }
  }

  if (jobPosting.datePosted) {
    detailFields.posting_date = String(jobPosting.datePosted).trim();
  }

  const locType = String(jobPosting.jobLocationType || "").toLowerCase();
  const desc = String(jobPosting.description || "").toLowerCase();
  if (locType.includes("telecommute") || desc.includes("telecommute") || desc.includes("work from home") || desc.includes("wfh") || desc.includes("remote option")) {
    detailFields.remote_type = "remote";
  }

  if (jobPosting.department) {
    detailFields.department = String(jobPosting.department.name || jobPosting.department || "").trim();
  }

  return {
    ...posting,
    location: detailFields.location || posting.location,
    posting_date: posting.posting_date || detailFields.posting_date || null,
    remote_type: posting.remote_type || detailFields.remote_type || null,
    department: posting.department || detailFields.department || null,
    source_evidence: {
      ...(posting.source_evidence || {}),
      location_source: detailFields.location ? "json_ld" : posting.source_evidence?.location_source || "",
      remote_source: detailFields.remote_type ? "json_ld" : posting.source_evidence?.remote_source || ""
    }
  };
}

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
  const postings = parseTaleoSourcePayload(
    normalizeCompanyName(company, config.careerSectionLower || "Taleo"),
    config,
    payload
  );

  const detailHtmlByUrl = rawPayload?.__detailHtmlByUrl || rawPayload?.detailHtmlByUrl;
  if (detailHtmlByUrl && Array.isArray(postings)) {
    return postings.map(posting => {
      const url = posting.job_posting_url;
      const html = detailHtmlByUrl[url] || detailHtmlByUrl[url.replace(/\/+$/, "")];
      return enrichPostingFromJsonLd(posting, html);
    });
  }

  return postings;
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
