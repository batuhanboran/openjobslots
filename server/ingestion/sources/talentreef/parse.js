"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");

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

function parseTalentreefPostingsFromSearchResponse(companyNameForPostings, config, responseJson) {
  const hits = Array.isArray(responseJson?.hits?.hits) ? responseJson.hits.hits : [];
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
    const postingDate = String(source?.createdDate || source?.startDate || source?.updatedDate || "").trim() || null;
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
      department: department || null,
      employment_type: String(source?.contractType || "").trim() || null
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
