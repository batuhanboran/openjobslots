"use strict";

const { decodeHtmlEntities, extractJsonLdObjectsFromHtml } = require("../../parsers/shared/html");
const { normalizeCountryName } = require("../../posting");

function cleanBreezyText(value) {
  return translateBreezyPolygotLabels(decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ")))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function breezyLocationLooksNarrativeText(value) {
  const text = cleanBreezyText(value);
  if (!text || text.length < 45) return false;
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length < 7) return false;
  const hasSentenceEnd = /[.!?]$/.test(text);
  const hasNarrativeCue = /\b(?:ability to|client[-\s]specific|collaborating|compliance|customers?|develop|ensuring|experience|external|internal|manage|provide|requirements?|responsibilit(?:y|ies)|skills?|supporting|team|while|working)\b/i.test(text);
  if (hasSentenceEnd && hasNarrativeCue) return true;
  return words.length >= 10 && /\b(?:responsible for|you will|we are|ability to|experience with|ensuring that)\b/i.test(text);
}

function cleanBreezyLocationText(value) {
  const text = cleanBreezyText(value);
  return breezyLocationLooksNarrativeText(text) ? "" : text;
}

const BREEZY_POLYGOT_LABELS = Object.freeze({
  "%LABEL_MULTIPLE_LOCATIONS%": "Multiple Locations",
  "%LABEL_POSITION_TYPE_FULL_TIME%": "Full-time",
  "%LABEL_POSITION_TYPE_PART_TIME%": "Part-time",
  "%LABEL_POSITION_TYPE_CONTRACT%": "Contract",
  "%LABEL_POSITION_TYPE_TEMPORARY%": "Temporary",
  "%LABEL_POSITION_TYPE_INTERNSHIP%": "Internship",
  "%LABEL_POSITION_TYPE_REMOTE_ANY%": "Remote",
  "%LABEL_POSITION_TYPE_REMOTE_WITHIN%": "Remote",
  "%LABEL_POSITION_TYPE_REMOTE%": "Remote",
  "%LABEL_POSITION_TYPE_HYBRID%": "Hybrid",
  "%LABEL_POSITION_TYPE_ON_SITE%": "On-site",
  "%LABEL_POSITION_TYPE_ONSITE%": "On-site",
  "%LABEL_POSITION_TYPE_IN_PERSON%": "On-site"
});

function translateBreezyPolygotLabels(value) {
  return String(value || "").replace(/%[A-Z0-9_]+%/g, (token) => BREEZY_POLYGOT_LABELS[token] || token);
}

function extractBreezySourceId(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    const parts = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
    const pIndex = parts.findIndex((part) => part.toLowerCase() === "p");
    return pIndex >= 0 && parts[pIndex + 1] ? parts[pIndex + 1] : "";
  } catch {
    return "";
  }
}

function canonicalBreezyDetailKey(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return String(urlValue || "").trim().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function lookupBreezyDetailHtml(detailHtmlByUrl, urlValue) {
  const map = detailHtmlByUrl && typeof detailHtmlByUrl === "object" ? detailHtmlByUrl : {};
  const key = canonicalBreezyDetailKey(urlValue);
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

function extractBreezyLabeledField(cardHtml, labels) {
  const text = cleanBreezyText(cardHtml);
  const labelPattern = (Array.isArray(labels) ? labels : [labels])
    .map((label) => String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
    .join("|");
  if (!text || !labelPattern) return null;
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*:?\\s*([^|•\\n]{2,140})`, "i"));
  return match?.[1] ? cleanBreezyText(match[1]) : null;
}

const BREEZY_LABELS = [
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

function escapeBreezyRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimBreezyLabeledValue(value) {
  let text = cleanBreezyText(value);
  if (!text) return null;
  const labelPattern = BREEZY_LABELS.map(escapeBreezyRegex).join("|");
  text = text
    .replace(new RegExp(`\\s+(?:${labelPattern})\\s*:.*$`, "i"), "")
    .replace(/\s+[â€¢Â·]\s+.*$/u, "")
    .trim();
  return text || null;
}

function extractBreezyStructuredLabeledField(cardHtml, labels) {
  const labelPattern = (Array.isArray(labels) ? labels : [labels])
    .map(escapeBreezyRegex)
    .filter(Boolean)
    .join("|");
  if (!labelPattern) return null;
  const source = String(cardHtml || "");
  const pairedPattern = new RegExp(
    `<(?:dt|th|strong|b|span|div|p)[^>]*>\\s*(?:${labelPattern})\\s*:?\\s*<\\/[^>]+>\\s*<(?:dd|td|span|div|p)[^>]*>([\\s\\S]{0,300}?)<\\/[^>]+>`,
    "i"
  );
  const pairedMatch = source.match(pairedPattern);
  if (pairedMatch?.[1]) return trimBreezyLabeledValue(pairedMatch[1]);

  const inlinePattern = new RegExp(
    `<(?:span|div|p|li|td|dd)[^>]*>\\s*(?:${labelPattern})\\s*:?\\s*([\\s\\S]{2,300}?)<\\/[^>]+>`,
    "i"
  );
  const inlineMatch = source.match(inlinePattern);
  if (inlineMatch?.[1]) return trimBreezyLabeledValue(inlineMatch[1]);

  const text = cleanBreezyText(cardHtml);
  if (!text) return null;
  const allLabels = BREEZY_LABELS.map(escapeBreezyRegex).join("|");
  const match = text.match(new RegExp(`(?:^|\\b)(?:${labelPattern})\\s*:\\s*(.{2,180}?)(?=\\s+(?:${allLabels})\\s*:|$)`, "i"));
  if (!match?.[1]) return null;
  return trimBreezyLabeledValue(match[1]);
}

function cleanBreezyStructuredValue(value) {
  if (value && typeof value === "object") {
    return cleanBreezyStructuredValue(value.name || value.value || value["@id"]);
  }
  const text = cleanBreezyText(value);
  return text && text.toUpperCase() !== "UNAVAILABLE" ? text : "";
}

function extractBreezyRemoteTypeFromValue(value) {
  const text = cleanBreezyText(value).toLowerCase();
  if (!text) return "";
  if (/%label_position_type_hybrid%|\b(hybrid|partially remote)\b/i.test(text)) return "hybrid";
  if (/%label_position_type_remote|%label_position_type_remote_any%|%label_position_type_remote_within%|\b(remote|telecommute|telework|work from home|wfh|virtual)\b/i.test(text)) return "remote";
  if (/%label_position_type_on[-_]?site%|\b(on[-\s]?site|onsite|in[-\s]?person|office[-\s]?based|work from office)\b/i.test(text)) return "onsite";
  return "";
}

function findBreezyJobPostingJsonLd(sourceHtml) {
  return extractJsonLdObjectsFromHtml(sourceHtml).find((item) => {
    const type = item?.["@type"];
    return Array.isArray(type)
      ? type.some((value) => String(value || "").toLowerCase() === "jobposting")
      : String(type || "").toLowerCase() === "jobposting";
  }) || null;
}

function firstBreezyStructuredCountry(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = firstBreezyStructuredCountry(item);
      if (candidate) return candidate;
    }
    return "";
  }
  if (value && typeof value === "object") {
    return cleanBreezyStructuredValue(value.name || value.addressCountry || value.country || value.value);
  }
  return cleanBreezyStructuredValue(value);
}

function extractBreezyJsonLdFieldsFromObject(jobPosting) {
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
  const city = cleanBreezyStructuredValue(address.addressLocality);
  const state = cleanBreezyStructuredValue(address.addressRegion);
  const countryRaw =
    cleanBreezyStructuredValue(address.addressCountry) ||
    firstBreezyStructuredCountry(jobPosting.applicantLocationRequirements);
  const country = normalizeCountryName(countryRaw) || countryRaw;
  const locationParts = [city, state, country].filter(Boolean);
  const jobLocationType = Array.isArray(jobPosting.jobLocationType)
    ? jobPosting.jobLocationType.join(" ")
    : cleanBreezyStructuredValue(jobPosting.jobLocationType);
  const remoteType = extractBreezyRemoteTypeFromValue(jobLocationType);
  const datePosted = cleanBreezyStructuredValue(jobPosting.datePosted);
  const employmentType = Array.isArray(jobPosting.employmentType)
    ? jobPosting.employmentType.map(cleanBreezyStructuredValue).filter(Boolean).join(", ")
    : cleanBreezyStructuredValue(jobPosting.employmentType);
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
      location_path: locationParts.length > 0 ? "jobLocation.address/applicantLocationRequirements" : "",
      city_source: city ? "json_ld" : "",
      city_path: city ? "jobLocation.address.addressLocality" : "",
      region_source: state ? "json_ld" : "",
      region_path: state ? "jobLocation.address.addressRegion" : "",
      country_source: country ? "json_ld" : "",
      country_path: country ? "jobLocation.address.addressCountry/applicantLocationRequirements" : "",
      remote_source: remoteType ? "json_ld" : "",
      remote_path: remoteType ? "jobLocationType" : "",
      posting_date_source: datePosted ? "json_ld" : "",
      posting_date_path: datePosted ? "datePosted" : "",
      employment_type_source: employmentType ? "json_ld" : "",
      employment_type_path: employmentType ? "employmentType" : ""
    }
  };
}

function extractBreezyJsonLdFields(detailHtml) {
  return extractBreezyJsonLdFieldsFromObject(findBreezyJobPostingJsonLd(detailHtml));
}

function collectBreezyJsonLdPostings(companyNameForPostings, config, sourceHtml, listUrl, seenUrls) {
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
      absoluteUrl = new URL(rawUrl, config.origin || listUrl || "https://example.invalid/").toString();
    } catch {
      continue;
    }
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) continue;

    const fields = extractBreezyJsonLdFieldsFromObject(jobPosting);
    const identifier = jobPosting?.identifier;
    const identifierValue = cleanBreezyStructuredValue(
      Array.isArray(identifier) ? identifier[0]?.value || identifier[0]?.name : identifier?.value || identifier?.name
    );
    postings.push({
      company_name: companyNameForPostings,
      source_job_id: extractBreezySourceId(absoluteUrl) || identifierValue,
      position_name: cleanBreezyStructuredValue(jobPosting?.title || jobPosting?.name) || "Untitled Position",
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
        route_kind: "breezy_json_ld_list",
        title_source: "json_ld",
        title_path: "JobPosting.title/name",
        canonical_url_source: "json_ld",
        canonical_url_path: "JobPosting.url",
        source_job_id_source: "url_or_json_ld_identifier",
        source_job_id_path: "/p/:id or JobPosting.identifier",
        ...(fields.evidence || {})
      },
      source_failure_reasons: []
    });
    seenUrls.add(absoluteUrl);
  }
  return postings.map((posting) => ({
    ...posting,
    source_failure_reasons: breezySourceFailureReasons(posting)
  }));
}

function extractBreezyLabeledRemoteType(sourceHtml) {
  const source = String(sourceHtml || "");
  const translated = translateBreezyPolygotLabels(source);
  if (/%LABEL_POSITION_TYPE_REMOTE_ANY%|%LABEL_POSITION_TYPE_REMOTE_WITHIN%|%LABEL_POSITION_TYPE_REMOTE%/i.test(source)) {
    return { value: "remote", raw: "Remote", path: "Breezy remote position label" };
  }
  if (/%LABEL_POSITION_TYPE_HYBRID%/i.test(source)) {
    return { value: "hybrid", raw: "Hybrid", path: "Breezy hybrid position label" };
  }
  if (/%LABEL_POSITION_TYPE_ON_SITE%|%LABEL_POSITION_TYPE_ONSITE%|%LABEL_POSITION_TYPE_IN_PERSON%/i.test(source)) {
    return { value: "onsite", raw: "On-site", path: "Breezy onsite position label" };
  }
  const labels = ["Remote", "Work Type", "Workplace", "Workplace Type", "Location Type", "Work Location"];
  for (const label of labels) {
    const value = extractBreezyStructuredLabeledField(translated, label);
    const remoteType = extractBreezyRemoteTypeFromValue(value);
    if (remoteType) return { value: remoteType, raw: value, path: label };
  }
  return null;
}

function extractBreezyDetailFields(detailHtml) {
  const jsonLd = extractBreezyJsonLdFields(detailHtml);
  const rawLabeledLocation = extractBreezyStructuredLabeledField(detailHtml, [
    "Location",
    "Location(s)",
    "Job Location",
    "Work Location",
    "Office",
    "Office Location",
    "Address",
    "City"
  ]);
  const labeledLocation = cleanBreezyLocationText(rawLabeledLocation);
  const labeledRemote = extractBreezyLabeledRemoteType(detailHtml);
  const labeledPostingDate = extractBreezyStructuredLabeledField(detailHtml, [
    "Posted",
    "Date Posted",
    "Posting Date",
    "Date Opened",
    "Opened",
    "Published",
    "Date"
  ]);
  const labeledEmploymentType = extractBreezyStructuredLabeledField(detailHtml, [
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
      remote_source: jsonLd.evidence?.remote_source || (labeledRemote ? "labeled_html" : ""),
      remote_path: jsonLd.evidence?.remote_path || (labeledRemote ? labeledRemote.path : ""),
      posting_date_source: jsonLd.evidence?.posting_date_source || (labeledPostingDate ? "labeled_html" : ""),
      posting_date_path: jsonLd.evidence?.posting_date_path || (labeledPostingDate ? "Date label" : ""),
      employment_type_source: jsonLd.evidence?.employment_type_source || (labeledEmploymentType ? "labeled_html" : ""),
      employment_type_path: jsonLd.evidence?.employment_type_path || (labeledEmploymentType ? "Employment Type label" : "")
    }
  };
}

function breezySourceFailureReasons(posting) {
  const reasons = [];
  const location = cleanBreezyText(posting.location || posting.location_text);
  const normalizedLocation = location
    .toLowerCase()
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
    .replace(/^[\s([{]+/, "")
    .replace(/[\s)\]}]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const remoteType = cleanBreezyText(posting.remote_type).toLowerCase();
  const sourceEvidence = posting.source_evidence || {};
  const hasRemoteEvidence = Boolean(sourceEvidence.remote_source || sourceEvidence.remote_path);
  const hasLocationEvidence = Boolean(sourceEvidence.location_source || sourceEvidence.location_path);
  const explicitRemoteOrHybrid = hasRemoteEvidence && (remoteType === "remote" || remoteType === "hybrid");
  const ambiguousLocation =
    /^(multiple|various)(?:\s+(?:locations?|states?|countries?|cities?|regions?|areas?))?$/.test(normalizedLocation) ||
    /^(all locations|anywhere|global|tbd|to be determined)$/.test(normalizedLocation);
  if (!location && !hasRemoteEvidence) reasons.push("no_structured_location", "no_explicit_remote_evidence");
  if (ambiguousLocation && !explicitRemoteOrHybrid) reasons.push("ambiguous_location");
  if ((remoteType === "remote" || remoteType === "hybrid" || remoteType === "onsite") && !hasRemoteEvidence) reasons.push("no_explicit_remote_evidence");
  if (!hasLocationEvidence && !hasRemoteEvidence) reasons.push("detail_no_structured_location", "detail_no_explicit_remote");
  return Array.from(new Set(reasons));
}

function enrichBreezyPostingFromDetail(posting, detailHtml, detailStatus) {
  if (!detailHtml) {
    return {
      ...posting,
      source_failure_reasons: breezySourceFailureReasons(posting)
    };
  }
  const detailFields = extractBreezyDetailFields(detailHtml);
  const sourceEvidence = {
    ...(posting.source_evidence || {}),
    detail_url: posting.job_posting_url,
    detail_fetch_status: detailStatus || 200,
    location_source: detailFields.evidence.location_source || posting.source_evidence?.location_source || "",
    location_path: detailFields.evidence.location_path || posting.source_evidence?.location_path || "",
    city_source: detailFields.evidence.city_source || "",
    city_path: detailFields.evidence.city_path || "",
    region_source: detailFields.evidence.region_source || "",
    region_path: detailFields.evidence.region_path || "",
    country_source: detailFields.evidence.country_source || "",
    country_path: detailFields.evidence.country_path || "",
    remote_source: detailFields.evidence.remote_source || posting.source_evidence?.remote_source || "",
    remote_path: detailFields.evidence.remote_path || posting.source_evidence?.remote_path || "",
    posting_date_source: detailFields.evidence.posting_date_source || posting.source_evidence?.posting_date_source || "",
    posting_date_path: detailFields.evidence.posting_date_path || posting.source_evidence?.posting_date_path || ""
  };
  const enriched = {
    ...posting,
    location: detailFields.location || posting.location || null,
    city: detailFields.city || posting.city || null,
    state: detailFields.state || posting.state || null,
    country: detailFields.country || posting.country || null,
    remote_type: detailFields.remote_type || posting.remote_type || null,
    posting_date: posting.posting_date || detailFields.posting_date || null,
    employment_type: posting.employment_type || detailFields.employment_type || null,
    source_evidence: sourceEvidence
  };
  return {
    ...enriched,
    source_failure_reasons: breezySourceFailureReasons(enriched)
  };
}

function extractBreezyListSegment(linkBody, className) {
  const source = String(linkBody || "");
  const match = source.match(new RegExp(`<li[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, "i"));
  if (!match) return "";
  const start = Number(match.index || 0) + String(match[0] || "").length;
  const tail = source.slice(start);
  const next = tail.search(/<li[^>]*class=["'][^"']*\b(?:location|type|department|salary|remote)\b/i);
  const end = next >= 0 ? next : tail.search(/<\/ul>|<\/a>/i);
  return tail.slice(0, end >= 0 ? end : Math.min(tail.length, 600));
}

function extractBreezyListLocation(linkBody) {
  const segment = extractBreezyListSegment(linkBody, "location");
  if (!segment) return "";
  const beforeRemoteIcon = segment.split(/<br\b|<i[^>]*class=["'][^"']*\bfa-(?:wifi|globe|home)\b/i)[0] || segment;
  return cleanBreezyLocationText(beforeRemoteIcon);
}

function extractBreezyListGroupHeader(contextBefore) {
  const matches = Array.from(String(contextBefore || "").matchAll(
    /<h2[^>]*class=["'][^"']*\bgroup-header\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/gi
  ));
  if (matches.length === 0) return { text: "", kind: "" };
  const html = String(matches[matches.length - 1]?.[1] || "");
  const text = cleanBreezyText(html);
  const kind = /\bfa-map-marker\b|\bfa-location-dot\b/i.test(html)
    ? "location"
    : /\bfa-(?:building|briefcase|folder)\b/i.test(html)
      ? "department"
      : "department";
  return { text, kind };
}

function extractBreezyListTitle(anchorHtml, linkBody) {
  const headingMatch = String(linkBody || "").match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  const headingTitle = cleanBreezyText(headingMatch?.[1] || "");
  if (headingTitle) return headingTitle;

  const classTitleMatch = String(linkBody || "").match(
    /<(?:span|div|p)[^>]*class=["'][^"']*\b(?:position-title|job-title|posting-title|title)\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
  );
  const classTitle = cleanBreezyText(classTitleMatch?.[1] || "");
  if (classTitle) return classTitle;

  const attrMatch = String(anchorHtml || "").match(/\b(?:title|aria-label|data-title|data-position-title)=["']([^"']+)["']/i);
  return cleanBreezyText(attrMatch?.[1] || "");
}

function parseBreezyPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const payload = pageHtml && typeof pageHtml === "object" && !Array.isArray(pageHtml) ? pageHtml : { html: pageHtml };
  const source = String(payload.html || payload.text || "");
  const listUrl = String(payload.__listUrl || config.list_url || config.origin || "").trim();
  const detailHtmlByUrl = payload.__detailHtmlByUrl || payload.detailHtmlByUrl || {};
  const detailStatusByUrl = payload.__detailStatusByUrl || payload.detailStatusByUrl || {};
  const postings = [];
  const seenUrls = new Set();

  const linkPattern =
    /<a[^>]*href=["']((?:https?:\/\/[^"'<>]+)?\/p\/[^"'<>]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const locationPattern =
    /<li[^>]*class=["'][^"']*\blocation\b[^"']*["'][^>]*>[\s\S]*?(?:<span[^>]*>)?([\s\S]*?)(?:<\/span>)?<\/li>/i;
  const postedPattern =
    /<li[^>]*class=["'][^"']*(?:posted|created|date)[^"']*["'][^>]*>[\s\S]*?(?:<span[^>]*>)?([\s\S]*?)(?:<\/span>)?<\/li>/i;

  let linkMatch = linkPattern.exec(source);
  while (linkMatch) {
    const href = String(linkMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.origin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      linkMatch = linkPattern.exec(source);
      continue;
    }

    const linkBody = String(linkMatch[2] || "");
    const title = extractBreezyListTitle(linkMatch[0], linkBody);
    if (!title) {
      linkMatch = linkPattern.exec(source);
      continue;
    }

    const locationMatch = linkBody.match(locationPattern);
    const postedMatch = linkBody.match(postedPattern);
    const contextBefore = source.slice(Math.max(0, Number(linkMatch.index || 0) - 3000), Number(linkMatch.index || 0));
    const groupHeader = extractBreezyListGroupHeader(contextBefore);
    const cardLocation =
      extractBreezyListLocation(linkBody) ||
      cleanBreezyLocationText(locationMatch?.[1] || "") ||
      cleanBreezyLocationText(extractBreezyLabeledField(linkBody, ["Location", "Office", "Workplace"])) ||
      "";
    const location = cardLocation || (groupHeader.kind === "location" ? cleanBreezyLocationText(groupHeader.text) : "");
    const listRemote = extractBreezyLabeledRemoteType(linkBody) ||
      (() => {
        const remoteFromLocation = extractBreezyRemoteTypeFromValue(cardLocation);
        return remoteFromLocation === "remote" || remoteFromLocation === "hybrid"
          ? { value: remoteFromLocation, raw: cardLocation, path: "list location label" }
          : null;
      })();
    const employmentType = cleanBreezyText(extractBreezyListSegment(linkBody, "type")) || null;
    const department =
      cleanBreezyText(extractBreezyListSegment(linkBody, "department")) ||
      (groupHeader.kind === "department" ? groupHeader.text : "");

    const basePosting = {
      company_name: companyNameForPostings,
      source_job_id: extractBreezySourceId(absoluteUrl),
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date:
        cleanBreezyText(postedMatch?.[1] || "") ||
        extractBreezyLabeledField(linkBody, ["Posted", "Date Posted", "Created"]) ||
        null,
      location: location || null,
      remote_type: listRemote?.value || null,
      department: department || null,
      employment_type: employmentType,
      source_requires_normalized_geo_or_remote: true,
      source_evidence: {
        list_url: listUrl,
        route_kind: "breezy_portal_html",
        title_source: "labeled_html",
        title_path: "a[href*='/p/'] h1/h2/h3",
        canonical_url_source: "url",
        canonical_url_path: "a[href*='/p/']",
        source_job_id_source: "url",
        source_job_id_path: "/p/:id",
        location_source: location ? "labeled_html" : "",
        location_path: location ? (cardLocation ? "li.location" : "h2.group-header location") : "",
        remote_source: listRemote ? "labeled_html" : "",
        remote_path: listRemote?.path || "",
        posting_date_source: cleanBreezyText(postedMatch?.[1] || "") ? "labeled_html" : "",
        posting_date_path: cleanBreezyText(postedMatch?.[1] || "") ? "li.posted/date" : ""
      }
    };
    postings.push(enrichBreezyPostingFromDetail(
      basePosting,
      lookupBreezyDetailHtml(detailHtmlByUrl, absoluteUrl),
      detailStatusByUrl[absoluteUrl] || detailStatusByUrl[canonicalBreezyDetailKey(absoluteUrl)]
    ));
    seenUrls.add(absoluteUrl);
    linkMatch = linkPattern.exec(source);
  }

  postings.push(...collectBreezyJsonLdPostings(companyNameForPostings, config, source, listUrl, seenUrls));

  return postings;
}

module.exports = {
  parseBreezyPostingsFromHtml
};
