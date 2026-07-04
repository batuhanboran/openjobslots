"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { guardPostingDateAgainstFuture } = require("../sourceModuleHelpers");

function extractTalentreefAliasData(aliasResponse) {
  if (!Array.isArray(aliasResponse) || aliasResponse.length === 0) return { clientId: "", brand: "" };
  const firstItem = aliasResponse[0];
  if (!firstItem || typeof firstItem !== "object") return { clientId: "", brand: "" };

  let clientId = "";
  const clients = Array.isArray(firstItem?.clients) ? firstItem.clients : [];
  if (clients.length > 0 && clients[0] && typeof clients[0] === "object") {
    clientId = String(clients[0]?.legacyClientId || clients[0]?.clientId || "").trim();
  }
  if (!clientId) {
    clientId = String(firstItem?.clientId || "").trim();
  }

  let brand = "";
  const brands = Array.isArray(firstItem?.brands) ? firstItem.brands : [];
  if (brands.length > 0) {
    const firstBrand = brands[0];
    if (firstBrand && typeof firstBrand === "object") {
      brand = String(firstBrand?.name || firstBrand?.brand || firstBrand?.title || "").trim();
    } else {
      brand = String(firstBrand || "").trim();
    }
  }
  if (!brand) {
    brand = String(firstItem?.brand || "").trim();
  }

  return { clientId, brand };
}

function buildTalentreefSearchPayload(clientId, brand = "", from = 0, size = 100) {
  const filters = [
    {
      terms: {
        "clientId.raw": [String(clientId || "").trim()]
      }
    }
  ];

  const normalizedBrand = String(brand || "").trim();
  if (normalizedBrand) {
    filters.push({
      terms: {
        "brand.raw": [normalizedBrand]
      }
    });
  }

  return {
    from: Number(from || 0),
    size: Number(size || 100),
    query: {
      bool: {
        filter: filters
      }
    },
    sort: [
      {
        jobId: {
          order: "desc"
        }
      }
    ]
  };
}

function normalizeTalentreefRemoteType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "true") return "remote";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/\b(remote|work from home|wfh|virtual|telecommute|telework)\b/.test(normalized)) return "remote";
  if (/\b(on[-\s]?site|onsite|in[-\s]?person|office)\b/.test(normalized)) return "onsite";
  return "";
}

function extractTalentreefRemoteType(source) {
  if (!source || typeof source !== "object") return "";
  if (source.remote === true || source.isRemote === true) return "remote";
  const values = [
    source.remoteType,
    source.workplaceType,
    source.workplace_type,
    source.workMode,
    source.work_mode,
    source.locationType,
    source.location_type,
    source.workLocationType
  ];
  for (const value of values) {
    const remoteType = normalizeTalentreefRemoteType(value);
    if (remoteType) return remoteType;
  }
  return "";
}

function parseTalentreefPostingsFromSearchResponse(companyNameForPostings, config, responseJson) {
  const hits = Array.isArray(responseJson?.hits?.hits) ? responseJson.hits.hits : [];
  const nowEpoch = config?.__nowEpoch;
  const postings = [];
  const seenUrls = new Set();

  for (const hit of hits) {
    const source = hit && typeof hit === "object" && hit._source && typeof hit._source === "object" ? hit._source : {};
    const rawUrl = String(source?.url || "").trim();
    let postingUrl = "";
    try {
      postingUrl = rawUrl ? new URL(rawUrl, `${String(config?.baseOrigin || "").replace(/\/+$/, "")}/`).toString() : "";
    } catch {
      postingUrl = "";
    }
    if (!postingUrl || seenUrls.has(postingUrl)) continue;

    const address = source?.address && typeof source.address === "object" ? source.address : {};
    const city = String(address?.city || "").trim();
    const state = String(source?.stateOrProvinceFull || source?.stateOrProvince || "").trim();
    const location = [city, state].filter(Boolean).join(", ");
    const department = String(source?.department?.name || source?.category || "").trim();
    // startDate is the employment START date (future), not when the job was
    // posted; use createdDate/updatedDate and backstop with the future guard.
    const postingDate = guardPostingDateAgainstFuture(
      String(source?.createdDate || source?.updatedDate || "").trim() || null,
      nowEpoch
    );
    const remoteType = extractTalentreefRemoteType(source);
    const sourceJobId =
      String(source?.jobId || source?.id || hit?._id || "").trim() ||
      extractSourceIdFromPostingUrl(postingUrl, "talentreef");
    const title = String(source?.title || source?.positionType || "").trim();
    if (!title) continue;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: sourceJobId,
      id: sourceJobId || undefined,
      position_name: title,
      job_posting_url: postingUrl,
      posting_date: postingDate,
      location: location || null,
      remote_type: remoteType || null,
      department: department || null,
      employment_type: String(source?.contractType || "").trim() || null,
      source_evidence: remoteType
        ? {
            remote_source: "talentreef_search_payload",
            remote_path: "hits.hits[]._source.remoteType",
            remote_rule_name: "talentreef_source_remote_field"
          }
        : undefined
    });
    seenUrls.add(postingUrl);
  }

  return postings;
}

module.exports = {
  buildTalentreefSearchPayload,
  extractTalentreefAliasData,
  parseTalentreefPostingsFromSearchResponse
};
