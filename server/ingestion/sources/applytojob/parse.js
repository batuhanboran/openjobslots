"use strict";

const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");
const { normalizeCountryName } = require("../../posting");

function cleanApplyToJobText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractApplyToJobIconField(cardHtml, iconNames) {
  const source = String(cardHtml || "");
  const names = Array.isArray(iconNames) ? iconNames : [iconNames];
  const escaped = names.map((name) => String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!escaped) return null;
  const pattern = new RegExp(
    `<i[^>]*class=["'][^"']*(?:${escaped})[^"']*["'][^>]*>\\s*<\\/i>\\s*([\\s\\S]{0,300})`,
    "i"
  );
  const match = source.match(pattern);
  if (!match?.[1]) return null;
  const untilNextIcon = String(match[1] || "").split(/<i\b/i)[0];
  const text = cleanApplyToJobText(untilNextIcon);
  return text || null;
}

function extractApplyToJobLabeledField(cardHtml, labels) {
  const text = cleanApplyToJobText(cardHtml);
  const labelPattern = (Array.isArray(labels) ? labels : [labels])
    .map((label) => String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
    .join("|");
  if (!text || !labelPattern) return null;
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*:?\\s*([^|•\\n]{2,120})`, "i"));
  if (!match?.[1]) return null;
  return cleanApplyToJobText(
    String(match[1] || "").replace(
      /\s+(?:Employment Type|Job Type|Schedule|Type|Department|Category|Team|Location|Job Location|Office|Posted|Date Posted|Posting Date)\s*:.*$/i,
      ""
    )
  );
}

const APPLYTOJOB_LABELS = [
  "Location",
  "Location(s)",
  "Job Location",
  "Work Location",
  "Office",
  "Office Location",
  "Address",
  "City",
  "Remote",
  "Work Type",
  "Workplace",
  "Workplace Type",
  "Location Type",
  "Employment Type",
  "Job Type",
  "Schedule",
  "Type",
  "Department",
  "Category",
  "Team",
  "Posted",
  "Date Posted",
  "Posting Date",
  "Date Opened",
  "Opened",
  "Published",
  "Date"
];

function escapeApplyToJobRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimApplyToJobLabeledValue(value) {
  let text = cleanApplyToJobText(value);
  if (!text) return null;
  const labelPattern = APPLYTOJOB_LABELS.map(escapeApplyToJobRegex).join("|");
  text = text
    .replace(new RegExp(`\\s+(?:${labelPattern})\\s*:.*$`, "i"), "")
    .replace(/\s+[•·]\s+.*$/u, "")
    .trim();
  return text || null;
}

function extractApplyToJobStructuredLabeledField(cardHtml, labels) {
  const labelPattern = (Array.isArray(labels) ? labels : [labels])
    .map(escapeApplyToJobRegex)
    .filter(Boolean)
    .join("|");
  if (!labelPattern) return null;
  const source = String(cardHtml || "");
  const pairedPattern = new RegExp(
    `<(?:dt|th|strong|b|span|div|p)[^>]*>\\s*(?:${labelPattern})\\s*:?\\s*<\\/[^>]+>\\s*<(?:dd|td|span|div|p)[^>]*>([\\s\\S]{0,300}?)<\\/[^>]+>`,
    "i"
  );
  const pairedMatch = source.match(pairedPattern);
  if (pairedMatch?.[1]) return trimApplyToJobLabeledValue(pairedMatch[1]);

  const inlinePattern = new RegExp(
    `<(?:span|div|p|li|td|dd)[^>]*>\\s*(?:${labelPattern})\\s*:?\\s*([\\s\\S]{2,300}?)<\\/[^>]+>`,
    "i"
  );
  const inlineMatch = source.match(inlinePattern);
  if (inlineMatch?.[1]) return trimApplyToJobLabeledValue(inlineMatch[1]);

  const text = cleanApplyToJobText(cardHtml);
  if (!text) return null;
  const allLabels = APPLYTOJOB_LABELS.map(escapeApplyToJobRegex).join("|");
  const match = text.match(new RegExp(`(?:^|\\b)(?:${labelPattern})\\s*:\\s*(.{2,180}?)(?=\\s+(?:${allLabels})\\s*:|$)`, "i"));
  if (!match?.[1]) return null;
  return trimApplyToJobLabeledValue(match[1]);
}

function extractApplyToJobClassCellText(cardHtml, className) {
  const source = String(cardHtml || "");
  const escapedClass = escapeApplyToJobRegex(className);
  const match = source.match(new RegExp(
    `<td[^>]*class=["'][^"']*\\b${escapedClass}\\b[^"']*["'][^>]*>([\\s\\S]{0,600}?)<\\/td>`,
    "i"
  ));
  if (!match?.[1]) return null;
  const text = cleanApplyToJobText(match[1]);
  if (!text || /^\(?none\)?$/i.test(text)) return null;
  return text;
}

function extractApplyToJobSourceId(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    const queryId =
      parsed.searchParams.get("id") ||
      parsed.searchParams.get("job_id") ||
      parsed.searchParams.get("jobId") ||
      parsed.searchParams.get("resumatorJobId");
    if (queryId) return String(queryId).trim();
    const parts = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
    const applyIndex = parts.findIndex((part) => part.toLowerCase() === "apply");
    if (applyIndex >= 0 && parts[applyIndex + 1]) return parts[applyIndex + 1];
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function canonicalApplyToJobDetailKey(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return String(urlValue || "").trim().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function lookupApplyToJobDetailHtml(detailHtmlByUrl, urlValue) {
  const map = detailHtmlByUrl && typeof detailHtmlByUrl === "object" ? detailHtmlByUrl : {};
  const key = canonicalApplyToJobDetailKey(urlValue);
  const candidates = [
    String(urlValue || ""),
    String(urlValue || "").replace(/#.*$/, ""),
    key,
    `${key}/`
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (typeof map[candidate] === "string") return map[candidate];
  }
  return "";
}

function findApplyToJobJobPostingJsonLd(sourceHtml) {
  return extractJsonLdObjectsFromHtml(sourceHtml).find((item) => {
    const type = item?.["@type"];
    return Array.isArray(type)
      ? type.some((value) => String(value || "").toLowerCase() === "jobposting")
      : String(type || "").toLowerCase() === "jobposting";
  }) || null;
}

function cleanApplyToJobStructuredValue(value) {
  if (value && typeof value === "object") {
    return cleanApplyToJobStructuredValue(value.name || value.value || value["@id"]);
  }
  const text = cleanApplyToJobText(value);
  return text && text.toUpperCase() !== "UNAVAILABLE" ? text : "";
}

function firstApplyToJobStructuredCountry(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = firstApplyToJobStructuredCountry(item);
      if (candidate) return candidate;
    }
    return "";
  }
  if (value && typeof value === "object") {
    return cleanApplyToJobStructuredValue(value.name || value.addressCountry || value.country || value.value);
  }
  return cleanApplyToJobStructuredValue(value);
}

function extractApplyToJobRemoteTypeFromValue(value) {
  const text = cleanApplyToJobText(value).toLowerCase();
  if (!text) return "";
  if (/\b(hybrid|partially remote)\b/.test(text)) return "hybrid";
  if (/\b(remote|telecommute|telework|work from home|wfh|virtual|anywhere)\b/.test(text)) return "remote";
  if (/\b(on[-\s]?site|onsite|in[-\s]?person|office[-\s]?based|work from office)\b/.test(text)) return "onsite";
  return "";
}

const APPLYTOJOB_COUNTRY_TOKEN_HINTS = Object.freeze({
  aruba: { country: "Aruba", region: "North America" },
  australia: { country: "Australia", region: "APAC" },
  bahamas: { country: "Bahamas", region: "North America" },
  "new south wales": { country: "Australia", region: "APAC", requiresCityToken: true },
  nsw: { country: "Australia", region: "APAC", requiresCityToken: true },
  queensland: { country: "Australia", region: "APAC", requiresCityToken: true },
  qld: { country: "Australia", region: "APAC", requiresCityToken: true },
  "western australia": { country: "Australia", region: "APAC", requiresCityToken: true },
  "south australia": { country: "Australia", region: "APAC", requiresCityToken: true },
  tasmania: { country: "Australia", region: "APAC", requiresCityToken: true },
  tas: { country: "Australia", region: "APAC", requiresCityToken: true },
  "australian capital territory": { country: "Australia", region: "APAC", requiresCityToken: true },
  act: { country: "Australia", region: "APAC", requiresCityToken: true },
  "northern territory": { country: "Australia", region: "APAC", requiresCityToken: true },
  victoria: { country: "Australia", region: "APAC", requiresCityToken: true },
  vic: { country: "Australia", region: "APAC", requiresCityToken: true },
  "the bahamas": { country: "Bahamas", region: "North America" },
  malta: { country: "Malta", region: "EMEA" },
  morocco: { country: "Morocco", region: "EMEA" },
  nigeria: { country: "Nigeria", region: "EMEA" },
  lagos: { country: "Nigeria", region: "EMEA", requiresCityToken: true },
  "lagos state": { country: "Nigeria", region: "EMEA", requiresCityToken: true },
  pr: { country: "Puerto Rico", region: "North America" },
  "puerto rico": { country: "Puerto Rico", region: "North America" }
});

function normalizeApplyToJobToken(value) {
  return cleanApplyToJobText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractApplyToJobCountryTokenHint(locationValue) {
  const location = cleanApplyToJobText(locationValue);
  if (!location || /^(remote|hybrid|onsite|on[-\s]?site)$/i.test(location)) return null;
  const tokens = location.split(",").map((part) => cleanApplyToJobText(part)).filter(Boolean);
  if (tokens.length === 0) return null;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    const normalizedToken = normalizeApplyToJobToken(token);
    const configuredHint = APPLYTOJOB_COUNTRY_TOKEN_HINTS[normalizedToken];
    const resolvedCountry = normalizedToken.length > 2 ? normalizeCountryName(token) : "";
    const hint = configuredHint || (resolvedCountry ? { country: resolvedCountry } : null);
    if (!hint) continue;
    if (hint.requiresCityToken && tokens.length < 2) continue;
    const cityToken = tokens.length === 1 ? "" : cleanApplyToJobText(tokens[0]);
    const normalizedCity = normalizeApplyToJobToken(cityToken);
    const normalizedHintCountry = normalizeApplyToJobToken(hint.country);
    return {
      ...hint,
      city: normalizedCity && normalizedCity !== normalizedHintCountry ? cityToken : "",
      raw: location,
      token,
      ruleName: "applytojob_country_token_hint"
    };
  }
  return null;
}

function buildApplyToJobLocationHintEvidence(locationValue) {
  const hint = extractApplyToJobCountryTokenHint(locationValue);
  if (!hint) return {};
  return {
    location_rule_name: hint.ruleName,
    location_raw: hint.raw,
    country_source: "labeled_html",
    country_path: "Location country token",
    country_rule_name: hint.ruleName
  };
}

function applyApplyToJobLocationHint(posting) {
  const hint = extractApplyToJobCountryTokenHint(posting?.location || posting?.location_text);
  if (!hint) return posting;
  return {
    ...posting,
    city: posting.city || hint.city || null,
    country: posting.country || hint.country || null,
    source_evidence: {
      ...(posting.source_evidence || {}),
      location_rule_name: hint.ruleName,
      location_raw: hint.raw,
      country_source: posting.source_evidence?.country_source || "labeled_html",
      country_path: posting.source_evidence?.country_path || "Location country token",
      country_rule_name: posting.source_evidence?.country_rule_name || hint.ruleName,
      city_source: posting.source_evidence?.city_source || (hint.city ? "labeled_html" : ""),
      city_path: posting.source_evidence?.city_path || (hint.city ? "Location city token" : "")
    }
  };
}

function extractApplyToJobJsonLdFieldsFromObject(jobPosting) {
  if (!jobPosting) return {};
  const locations = Array.isArray(jobPosting.jobLocation)
    ? jobPosting.jobLocation
    : jobPosting.jobLocation
      ? [jobPosting.jobLocation]
      : [];
  let address = {};
  for (const location of locations) {
    if (location?.address && typeof location.address === "object") {
      address = location.address;
      break;
    }
  }
  const city = cleanApplyToJobStructuredValue(address.addressLocality);
  const state = cleanApplyToJobStructuredValue(address.addressRegion);
  const countryRaw =
    cleanApplyToJobStructuredValue(address.addressCountry) ||
    firstApplyToJobStructuredCountry(jobPosting.applicantLocationRequirements);
  const country = normalizeCountryName(countryRaw) || countryRaw;
  const locationParts = [city, state, country].filter(Boolean);
  const jobLocationType = Array.isArray(jobPosting.jobLocationType)
    ? jobPosting.jobLocationType.join(" ")
    : cleanApplyToJobStructuredValue(jobPosting.jobLocationType);
  const remoteType = extractApplyToJobRemoteTypeFromValue(jobLocationType);
  const datePosted = cleanApplyToJobStructuredValue(jobPosting.datePosted);
  const employmentType = Array.isArray(jobPosting.employmentType)
    ? jobPosting.employmentType.map(cleanApplyToJobStructuredValue).filter(Boolean).join(", ")
    : cleanApplyToJobStructuredValue(jobPosting.employmentType);
  return {
    location: locationParts.length > 0 ? locationParts.join(", ") : "",
    city,
    state,
    country,
    remote_type: remoteType,
    posting_date: datePosted,
    employment_type: employmentType,
    evidence: {
      location_source: locationParts.length > 0 ? "json_ld" : "",
      location_path: locationParts.length > 0 ? "jobLocation.address" : "",
      city_source: city ? "json_ld" : "",
      city_path: city ? "jobLocation.address.addressLocality" : "",
      region_source: state ? "json_ld" : "",
      region_path: state ? "jobLocation.address.addressRegion" : "",
      country_source: country ? "json_ld" : "",
      country_path: country ? "jobLocation.address.addressCountry" : "",
      remote_source: remoteType ? "json_ld" : "",
      remote_path: remoteType ? "jobLocationType" : "",
      posting_date_source: datePosted ? "json_ld" : "",
      posting_date_path: datePosted ? "datePosted" : "",
      employment_type_source: employmentType ? "json_ld" : "",
      employment_type_path: employmentType ? "employmentType" : ""
    }
  };
}

function extractApplyToJobJsonLdFields(detailHtml) {
  return extractApplyToJobJsonLdFieldsFromObject(findApplyToJobJobPostingJsonLd(detailHtml));
}

function collectApplyToJobJsonLdPostings(companyNameForPostings, config, sourceHtml, listUrl, seenUrls) {
  const postings = [];
  for (const jobPosting of extractJsonLdObjectsFromHtml(sourceHtml)) {
    const type = jobPosting?.["@type"];
    const isJobPosting = Array.isArray(type)
      ? type.some((value) => String(value || "").toLowerCase() === "jobposting")
      : String(type || "").toLowerCase() === "jobposting";
    if (!isJobPosting) continue;

    const rawUrl = String(jobPosting?.url || jobPosting?.sameAs || "").trim();
    if (!rawUrl) continue;
    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(rawUrl, config.baseOrigin || listUrl || "https://example.invalid/").toString();
    } catch {
      continue;
    }
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) continue;

    const fields = extractApplyToJobJsonLdFieldsFromObject(jobPosting);
    const identifier = jobPosting?.identifier;
    const identifierValue = cleanApplyToJobStructuredValue(
      Array.isArray(identifier) ? identifier[0]?.value || identifier[0]?.name : identifier?.value || identifier?.name
    );
    postings.push(applyApplyToJobLocationHint({
      company_name: companyNameForPostings,
      source_job_id: extractApplyToJobSourceId(absoluteUrl) || identifierValue,
      position_name: cleanApplyToJobStructuredValue(jobPosting?.title || jobPosting?.name) || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: fields.posting_date || null,
      location: fields.location || null,
      city: fields.city || null,
      state: fields.state || null,
      country: fields.country || null,
      remote_type: fields.remote_type || null,
      employment_type: fields.employment_type || null,
      source_requires_normalized_geo_or_remote: true,
      source_evidence: {
        list_url: listUrl,
        route_kind: "applytojob_json_ld_list",
        title_source: "json_ld",
        title_path: "JobPosting.title/name",
        canonical_url_source: "json_ld",
        canonical_url_path: "JobPosting.url",
        source_job_id_source: "url_or_json_ld_identifier",
        source_job_id_path: "/apply/:id or JobPosting.identifier",
        ...(fields.evidence || {})
      },
      source_failure_reasons: []
    }));
    seenUrls.add(absoluteUrl);
  }
  return postings.map((posting) => ({
    ...posting,
    source_failure_reasons: applyToJobSourceFailureReasons(posting)
  }));
}

function extractApplyToJobLabeledRemoteType(sourceHtml) {
  const labels = ["Remote", "Work Type", "Workplace", "Workplace Type", "Location Type", "Work Location"];
  for (const label of labels) {
    const value = extractApplyToJobStructuredLabeledField(sourceHtml, label);
    const remoteType = extractApplyToJobRemoteTypeFromValue(value);
    if (remoteType) return { value: remoteType, raw: value, path: label };
  }
  const location = extractApplyToJobStructuredLabeledField(sourceHtml, [
    "Location",
    "Location(s)",
    "Job Location",
    "Work Location",
    "Office",
    "Office Location"
  ]);
  const remoteFromLocation = extractApplyToJobRemoteTypeFromValue(location);
  if (remoteFromLocation === "remote" || remoteFromLocation === "hybrid") {
    return { value: remoteFromLocation, raw: location, path: "Location" };
  }
  return null;
}

function extractApplyToJobDetailFields(detailHtml) {
  const jsonLd = extractApplyToJobJsonLdFields(detailHtml);
  const labeledLocation = extractApplyToJobStructuredLabeledField(detailHtml, [
    "Location",
    "Location(s)",
    "Job Location",
    "Work Location",
    "Office",
    "Office Location",
    "Address",
    "City"
  ]);
  const labeledRemote = extractApplyToJobLabeledRemoteType(detailHtml);
  const labeledPostingDate = extractApplyToJobStructuredLabeledField(detailHtml, [
    "Posted",
    "Date Posted",
    "Posting Date",
    "Date Opened",
    "Opened",
    "Published",
    "Date"
  ]);
  const labeledEmploymentType = extractApplyToJobStructuredLabeledField(detailHtml, [
    "Employment Type",
    "Job Type",
    "Schedule",
    "Type"
  ]);
  return {
    location: jsonLd.location || labeledLocation || "",
    city: jsonLd.city || "",
    state: jsonLd.state || "",
    country: jsonLd.country || "",
    remote_type: jsonLd.remote_type || labeledRemote?.value || "",
    posting_date: jsonLd.posting_date || labeledPostingDate || "",
    employment_type: jsonLd.employment_type || labeledEmploymentType || "",
    evidence: {
      ...(jsonLd.evidence || {}),
      location_source: jsonLd.evidence?.location_source || (labeledLocation ? "labeled_html" : ""),
      location_path: jsonLd.evidence?.location_path || (labeledLocation ? "Location label" : ""),
      ...(!jsonLd.evidence?.location_source ? buildApplyToJobLocationHintEvidence(labeledLocation) : {}),
      remote_source: jsonLd.evidence?.remote_source || (labeledRemote ? "labeled_html" : ""),
      remote_path: jsonLd.evidence?.remote_path || (labeledRemote ? labeledRemote.path : ""),
      posting_date_source: jsonLd.evidence?.posting_date_source || (labeledPostingDate ? "labeled_html" : ""),
      posting_date_path: jsonLd.evidence?.posting_date_path || (labeledPostingDate ? "Date label" : ""),
      employment_type_source: jsonLd.evidence?.employment_type_source || (labeledEmploymentType ? "labeled_html" : ""),
      employment_type_path: jsonLd.evidence?.employment_type_path || (labeledEmploymentType ? "Employment Type label" : "")
    }
  };
}

function applyToJobSourceFailureReasons(posting) {
  const reasons = [];
  const location = cleanApplyToJobText(posting.location || posting.location_text);
  const normalizedLocation = location
    .toLowerCase()
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
    .replace(/^[\s([{]+/, "")
    .replace(/[\s)\]}]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const remoteType = cleanApplyToJobText(posting.remote_type).toLowerCase();
  const sourceEvidence = posting.source_evidence || {};
  const hasRemoteEvidence = Boolean(sourceEvidence.remote_source || sourceEvidence.remote_path);
  const hasLocationEvidence = Boolean(sourceEvidence.location_source || sourceEvidence.location_path);
  if (!location && !hasRemoteEvidence) reasons.push("no_structured_location", "no_explicit_remote_evidence");
  if (/^(multiple|various)(?:\s+(?:locations?|states?|countries?|cities?|regions?|areas?))?$/.test(normalizedLocation) ||
      /^(all locations|anywhere|global|tbd|to be determined)$/.test(normalizedLocation)) {
    reasons.push("ambiguous_location");
  }
  if ((remoteType === "remote" || remoteType === "hybrid") && !hasRemoteEvidence) reasons.push("no_explicit_remote_evidence");
  if (!hasLocationEvidence && !hasRemoteEvidence) reasons.push("detail_no_structured_location", "detail_no_explicit_remote");
  return Array.from(new Set(reasons));
}

function enrichApplyToJobPostingFromDetail(posting, detailHtml, detailStatus) {
  const listPosting = applyApplyToJobLocationHint(posting);
  if (!detailHtml) {
    return {
      ...listPosting,
      source_failure_reasons: applyToJobSourceFailureReasons(listPosting)
    };
  }
  const detailFields = extractApplyToJobDetailFields(detailHtml);
  const keepListLocation = Boolean(listPosting.country && detailFields.location && !detailFields.country);
  const sourceEvidence = {
    ...(listPosting.source_evidence || {}),
    detail_url: listPosting.job_posting_url,
    detail_fetch_status: detailStatus || 200,
    location_source: keepListLocation
      ? listPosting.source_evidence?.location_source || ""
      : detailFields.evidence.location_source || listPosting.source_evidence?.location_source || "",
    location_path: keepListLocation
      ? listPosting.source_evidence?.location_path || ""
      : detailFields.evidence.location_path || listPosting.source_evidence?.location_path || "",
    city_source: detailFields.evidence.city_source || listPosting.source_evidence?.city_source || "",
    city_path: detailFields.evidence.city_path || listPosting.source_evidence?.city_path || "",
    region_source: detailFields.evidence.region_source || listPosting.source_evidence?.region_source || "",
    region_path: detailFields.evidence.region_path || listPosting.source_evidence?.region_path || "",
    country_source: detailFields.evidence.country_source || listPosting.source_evidence?.country_source || "",
    country_path: detailFields.evidence.country_path || listPosting.source_evidence?.country_path || "",
    remote_source: detailFields.evidence.remote_source || listPosting.source_evidence?.remote_source || "",
    remote_path: detailFields.evidence.remote_path || listPosting.source_evidence?.remote_path || "",
    posting_date_source: detailFields.evidence.posting_date_source || listPosting.source_evidence?.posting_date_source || "",
    posting_date_path: detailFields.evidence.posting_date_path || listPosting.source_evidence?.posting_date_path || ""
  };
  const enriched = applyApplyToJobLocationHint({
    ...listPosting,
    location: keepListLocation ? listPosting.location : detailFields.location || listPosting.location || null,
    city: detailFields.city || listPosting.city || null,
    state: detailFields.state || listPosting.state || null,
    country: detailFields.country || listPosting.country || null,
    remote_type: detailFields.remote_type || listPosting.remote_type || null,
    posting_date: listPosting.posting_date || detailFields.posting_date || null,
    employment_type: listPosting.employment_type || detailFields.employment_type || null,
    source_evidence: sourceEvidence
  });
  return {
    ...enriched,
    source_failure_reasons: applyToJobSourceFailureReasons(enriched)
  };
}

function parseApplyToJobPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const payload = pageHtml && typeof pageHtml === "object" && !Array.isArray(pageHtml) ? pageHtml : { html: pageHtml };
  const source = String(payload.html || payload.text || "");
  const listUrl = String(payload.__listUrl || config.list_url || config.applyUrl || config.baseOrigin || "").trim();
  const detailHtmlByUrl = payload.__detailHtmlByUrl || payload.detailHtmlByUrl || {};
  const detailStatusByUrl = payload.__detailStatusByUrl || payload.detailStatusByUrl || {};
  const postings = [];
  const seenUrls = new Set();

  const listItemPattern =
    /<li[^>]*class=["'][^"']*\blist-group-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  const listHeadingPattern =
    /<h3[^>]*class=["'][^"']*\blist-group-item-heading\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
  const listLocationPattern = /fa-(?:map-marker|map-marker-alt|location-dot)[^>]*><\/i>\s*([^<]+)/i;
  const listDatePattern = /fa-(?:calendar|calendar-alt|clock)[^>]*><\/i>\s*([^<]+)/i;

  let listItemMatch = listItemPattern.exec(source);
  while (listItemMatch) {
    const itemHtml = String(listItemMatch[1] || "");
    const headingMatch = itemHtml.match(listHeadingPattern);
    if (!headingMatch?.[1]) {
      listItemMatch = listItemPattern.exec(source);
      continue;
    }

    const href = String(headingMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      listItemMatch = listItemPattern.exec(source);
      continue;
    }

    const locationMatch = itemHtml.match(listLocationPattern);
    const location =
      (locationMatch?.[1] ? cleanApplyToJobText(locationMatch[1]) : null) ||
      extractApplyToJobIconField(itemHtml, ["fa-map-marker", "fa-map-marker-alt", "fa-location-dot"]) ||
      extractApplyToJobStructuredLabeledField(itemHtml, ["Location", "Job Location", "Office"]);
    const dateMatch = itemHtml.match(listDatePattern);
    const postingDate =
      (dateMatch?.[1] ? cleanApplyToJobText(dateMatch[1]) : null) ||
      extractApplyToJobIconField(itemHtml, ["fa-calendar", "fa-calendar-alt", "fa-clock"]) ||
      extractApplyToJobStructuredLabeledField(itemHtml, ["Posted", "Date Posted", "Posting Date"]);
    const department = extractApplyToJobStructuredLabeledField(itemHtml, ["Department", "Category", "Team"]);
    const employmentType = extractApplyToJobStructuredLabeledField(itemHtml, [
      "Employment Type",
      "Job Type",
      "Schedule",
      "Type"
    ]);
    const locationRemoteType = extractApplyToJobRemoteTypeFromValue(location);
    const labeledRemote = extractApplyToJobLabeledRemoteType(itemHtml) ||
      ((locationRemoteType === "remote" || locationRemoteType === "hybrid")
        ? { value: locationRemoteType, path: "list location label/icon" }
        : null);

    const basePosting = {
      company_name: companyNameForPostings,
      source_job_id: extractApplyToJobSourceId(absoluteUrl),
      position_name: cleanApplyToJobText(headingMatch[2]) || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: postingDate,
      location,
      remote_type: labeledRemote?.value || null,
      department,
      employment_type: employmentType,
      source_requires_normalized_geo_or_remote: true,
      source_evidence: {
        list_url: listUrl,
        route_kind: "applytojob_list_html",
        title_source: "labeled_html",
        title_path: "h3.list-group-item-heading a",
        canonical_url_source: "url",
        canonical_url_path: "a[href]",
        source_job_id_source: "url",
        source_job_id_path: "/apply/:id",
        location_source: location ? "labeled_html" : "",
        location_path: location ? "list location label/icon" : "",
        ...buildApplyToJobLocationHintEvidence(location),
        remote_source: labeledRemote ? "labeled_html" : "",
        remote_path: labeledRemote?.path || "",
        posting_date_source: postingDate ? "labeled_html" : "",
        posting_date_path: postingDate ? "list date label/icon" : ""
      }
    };
    postings.push(enrichApplyToJobPostingFromDetail(
      basePosting,
      lookupApplyToJobDetailHtml(detailHtmlByUrl, absoluteUrl),
      detailStatusByUrl[absoluteUrl] || detailStatusByUrl[canonicalApplyToJobDetailKey(absoluteUrl)]
    ));
    seenUrls.add(absoluteUrl);

    listItemMatch = listItemPattern.exec(source);
  }

  const legacyLinkPattern =
    /<a(?=[^>]*\bresumator-job-title-link\b)(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/gi;
  const legacyLocationPattern =
    /<span[^>]*class=["'][^"']*\bresumator-job-location\b[^"']*["'][^>]*>\s*Location:\s*<\/span>\s*([^<]*)/i;
  const legacyDatePattern =
    /<span[^>]*class=["'][^"']*(?:resumator-job-date|resumator-job-posted)[^"']*["'][^>]*>\s*(?:Posted|Date Posted)?:?\s*<\/span>\s*([^<]*)/i;

  const legacyMatches = Array.from(source.matchAll(legacyLinkPattern));
  for (let index = 0; index < legacyMatches.length; index += 1) {
    const match = legacyMatches[index];
    const href = String(match?.[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) continue;

    const nextStart = index + 1 < legacyMatches.length ? Number(legacyMatches[index + 1].index || 0) : source.length;
    const currentEnd = Number(match.index || 0) + String(match[0] || "").length;
    const searchEnd = Math.min(nextStart, currentEnd + 2500);
    const contextHtml = source.slice(currentEnd, searchEnd);
    const locationMatch = contextHtml.match(legacyLocationPattern);
    const location =
      (locationMatch?.[1] ? cleanApplyToJobText(locationMatch[1]) : null) ||
      extractApplyToJobClassCellText(contextHtml, "resumator-job-location-column") ||
      extractApplyToJobIconField(contextHtml, ["fa-map-marker", "fa-map-marker-alt", "fa-location-dot"]) ||
      extractApplyToJobStructuredLabeledField(contextHtml, ["Location", "Job Location", "Office"]);
    const dateMatch = contextHtml.match(legacyDatePattern);
    const postingDate =
      (dateMatch?.[1] ? cleanApplyToJobText(dateMatch[1]) : null) ||
      extractApplyToJobIconField(contextHtml, ["fa-calendar", "fa-calendar-alt", "fa-clock"]) ||
      extractApplyToJobStructuredLabeledField(contextHtml, ["Posted", "Date Posted", "Posting Date"]);
    const department =
      extractApplyToJobStructuredLabeledField(contextHtml, ["Department", "Category", "Team"]) ||
      extractApplyToJobClassCellText(contextHtml, "resumator-department-column");
    const employmentType = extractApplyToJobStructuredLabeledField(contextHtml, [
      "Employment Type",
      "Job Type",
      "Schedule",
      "Type"
    ]);
    const locationRemoteType = extractApplyToJobRemoteTypeFromValue(location);
    const labeledRemote = extractApplyToJobLabeledRemoteType(contextHtml) ||
      ((locationRemoteType === "remote" || locationRemoteType === "hybrid")
        ? { value: locationRemoteType, path: "legacy location label/icon" }
        : null);

    const basePosting = {
      company_name: companyNameForPostings,
      source_job_id: extractApplyToJobSourceId(absoluteUrl),
      position_name: cleanApplyToJobText(match?.[2]) || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: postingDate,
      location,
      remote_type: labeledRemote?.value || null,
      department,
      employment_type: employmentType,
      source_requires_normalized_geo_or_remote: true,
      source_evidence: {
        list_url: listUrl,
        route_kind: "applytojob_legacy_list_html",
        title_source: "labeled_html",
        title_path: "a.resumator-job-title-link",
        canonical_url_source: "url",
        canonical_url_path: "a[href]",
        source_job_id_source: "url",
        source_job_id_path: "/apply/:id",
        location_source: location ? "labeled_html" : "",
        location_path: location ? "legacy location label/icon" : "",
        ...buildApplyToJobLocationHintEvidence(location),
        remote_source: labeledRemote ? "labeled_html" : "",
        remote_path: labeledRemote?.path || "",
        posting_date_source: postingDate ? "labeled_html" : "",
        posting_date_path: postingDate ? "legacy date label/icon" : ""
      }
    };
    postings.push(enrichApplyToJobPostingFromDetail(
      basePosting,
      lookupApplyToJobDetailHtml(detailHtmlByUrl, absoluteUrl),
      detailStatusByUrl[absoluteUrl] || detailStatusByUrl[canonicalApplyToJobDetailKey(absoluteUrl)]
    ));
    seenUrls.add(absoluteUrl);
  }

  const genericLinkPattern =
    /<a\b(?=[^>]*href=["']([^"']*\/apply\/[^"']+)["'])[^>]*>([\s\S]*?)<\/a>/gi;
  const genericMatches = Array.from(source.matchAll(genericLinkPattern));
  for (let index = 0; index < genericMatches.length; index += 1) {
    const match = genericMatches[index];
    const href = String(match?.[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) continue;

    const title = cleanApplyToJobText(match?.[2] || "");
    if (!title) continue;

    const nextStart = index + 1 < genericMatches.length ? Number(genericMatches[index + 1].index || 0) : source.length;
    const contextStart = Number(match.index || 0);
    const contextEnd = Math.min(nextStart, Number(match.index || 0) + String(match[0] || "").length + 2200);
    const contextHtml = source.slice(contextStart, contextEnd);
    const location =
      extractApplyToJobStructuredLabeledField(contextHtml, ["Location", "Job Location", "Office", "Work Location"]) ||
      extractApplyToJobClassCellText(contextHtml, "resumator-job-location-column") ||
      extractApplyToJobIconField(contextHtml, ["fa-map-marker", "fa-map-marker-alt", "fa-location-dot"]);
    const postingDate =
      extractApplyToJobStructuredLabeledField(contextHtml, ["Posted", "Date Posted", "Posting Date"]) ||
      extractApplyToJobIconField(contextHtml, ["fa-calendar", "fa-calendar-alt", "fa-clock"]);
    const department =
      extractApplyToJobStructuredLabeledField(contextHtml, ["Department", "Category", "Team"]) ||
      extractApplyToJobClassCellText(contextHtml, "resumator-department-column");
    const employmentType = extractApplyToJobStructuredLabeledField(contextHtml, [
      "Employment Type",
      "Job Type",
      "Schedule",
      "Type"
    ]);
    const locationRemoteType = extractApplyToJobRemoteTypeFromValue(location);
    const labeledRemote = extractApplyToJobLabeledRemoteType(contextHtml) ||
      ((locationRemoteType === "remote" || locationRemoteType === "hybrid")
        ? { value: locationRemoteType, path: "generic card location label" }
        : null);

    const basePosting = {
      company_name: companyNameForPostings,
      source_job_id: extractApplyToJobSourceId(absoluteUrl),
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: postingDate,
      location,
      remote_type: labeledRemote?.value || null,
      department,
      employment_type: employmentType,
      source_requires_normalized_geo_or_remote: true,
      source_evidence: {
        list_url: listUrl,
        route_kind: "applytojob_generic_card_html",
        title_source: "labeled_html",
        title_path: "a[href*='/apply/']",
        canonical_url_source: "url",
        canonical_url_path: "a[href*='/apply/']",
        source_job_id_source: "url",
        source_job_id_path: "/apply/:id",
        location_source: location ? "labeled_html" : "",
        location_path: location ? "generic card location label/icon" : "",
        ...buildApplyToJobLocationHintEvidence(location),
        remote_source: labeledRemote ? "labeled_html" : "",
        remote_path: labeledRemote?.path || "",
        posting_date_source: postingDate ? "labeled_html" : "",
        posting_date_path: postingDate ? "generic card date label/icon" : ""
      }
    };
    postings.push(enrichApplyToJobPostingFromDetail(
      basePosting,
      lookupApplyToJobDetailHtml(detailHtmlByUrl, absoluteUrl),
      detailStatusByUrl[absoluteUrl] || detailStatusByUrl[canonicalApplyToJobDetailKey(absoluteUrl)]
    ));
    seenUrls.add(absoluteUrl);
  }

  postings.push(...collectApplyToJobJsonLdPostings(companyNameForPostings, config, source, listUrl, seenUrls));

  return postings;
}

module.exports = {
  extractApplyToJobCountryTokenHint,
  parseApplyToJobPostingsFromHtml
};
