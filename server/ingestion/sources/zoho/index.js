const { createSourceModule } = require("../common");
const parser = require("./parse");

const baseSource = createSourceModule("zoho");

function clean(value) {
  return String(value || "").trim();
}

function inferCompanyName(company = {}, config = {}) {
  const explicitName = clean(company.company_name);
  if (explicitName) return explicitName;

  const sourceUrl = clean(config.careersUrl || company.company_url || company.url_string);
  try {
    const parsed = new URL(sourceUrl);
    const subdomain = clean(parsed.hostname.split(".")[0]);
    if (subdomain) return subdomain.toLowerCase();
  } catch {
    // Fall back to the ATS key when no trustworthy tenant name is available.
  }

  return "zoho";
}

function extractHtmlPayload(rawPayload) {
  if (typeof rawPayload === "string") return rawPayload;
  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    return rawPayload.body || rawPayload.html || "";
  }
  return "";
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
  const discovered = baseSource.discover(company);
  const config = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? rawPayload.__sourceConfig || discovered.config || {}
    : discovered.config || {};
  const postings = parser.parseZohoPostingsFromHtml(inferCompanyName(company, config), config, extractHtmlPayload(rawPayload));

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

module.exports = {
  ...baseSource,
  ...parser,
  parse,
  fetchDetail: require("./fetchDetail")
};
