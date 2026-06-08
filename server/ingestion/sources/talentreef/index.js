const { createSourceModule } = require("../common");
const parser = require("./parse");
const { clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const atsKey = "talentreef";
const baseModule = createSourceModule(atsKey);
const parserVersion = "source-talentreef-v1";
const discover = createDiscover(parserVersion);
const fetchList = createFetchList({ discover });
const payloadShapePolicy = Object.freeze({
  empty_job_list_stems: Object.freeze(["hits.hits"])
});

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return rawPayload || {};
  }
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function resolveCompanyName(company = {}, config = {}, fallback = "talentreef") {
  return (
    clean(company?.company_name) ||
    clean(company?.companyName) ||
    clean(company?.name) ||
    clean(config.companyName) ||
    clean(config.companyNameLower) ||
    clean(config.companyNameForPostings) ||
    fallback
  );
}

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

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  const companyName = resolveCompanyName(company, config, config.companyNameLower || "talentreef");
  const postings = parser.parseTalentreefPostingsFromSearchResponse(
    companyName,
    config,
    payload
  );

  const parsedPostings = postings.map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: clean(rawPayload?.__sourceRequest?.boardUrl || config.boardUrl || target.list_url),
      api_url: clean(rawPayload?.__sourceRequest?.searchApiUrl || config.searchApiUrl)
    }
  }));

  const detailHtmlByUrl = rawPayload?.__detailHtmlByUrl || rawPayload?.detailHtmlByUrl;
  if (detailHtmlByUrl && Array.isArray(parsedPostings)) {
    return parsedPostings.map(posting => {
      const url = posting.job_posting_url;
      const html = detailHtmlByUrl[url] || detailHtmlByUrl[url.replace(/\/+$/, "")];
      return enrichPostingFromJsonLd(posting, html);
    });
  }

  return parsedPostings;
}

module.exports = {
  ...baseModule,
  ...parser,
  atsKey,
  key: atsKey,
  family: baseModule.family,
  status: baseModule.status,
  parserVersion,
  discover,
  fetchList,
  parse,
  payloadShapePolicy,
  fetchDetail: require("./fetchDetail")
};
