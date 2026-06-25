"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { normalizeExplicitRemoteValue } = require("../../parsers/shared/remote");

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

function cleanSmartRecruitersText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeApplitrackUrl(url) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) throw new Error("Applitrack URL is required");

  const parsed = parseUrl(normalizedUrl);
  if (!parsed || !parsed.protocol || !parsed.host) {
    throw new Error("Invalid Applitrack URL");
  }

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".applitrack.com")) {
    throw new Error(`Unexpected Applitrack host: ${parsed.host}`);
  }

  const base = `${parsed.protocol}//${parsed.host}`;
  const pathValue = String(parsed.pathname || "/");
  const lowerPath = pathValue.toLowerCase();
  const onlineAppIndex = lowerPath.indexOf("/onlineapp/");
  const rootPath = onlineAppIndex >= 0
    ? pathValue.slice(0, onlineAppIndex + "/onlineapp/".length)
    : pathValue.endsWith("default.aspx")
      ? pathValue.slice(0, -1 * "default.aspx".length)
      : pathValue;
  const normalizedRootPath = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return `${base}${normalizedRootPath}`;
}

function parseApplitrackPostings(outputHtml, siteRoot, companyName) {
  const page = String(outputHtml || "").replace(/\\'/g, "'");
  const postings = [];
  const seenIds = new Set();
  const applyPattern = /applyFor\(\s*["'](\d+)["']\s*,\s*["']([^"']*)["']\s*,\s*["']([^"']*)["'][^)]*\)/gi;
  const linkPattern = /<a\b[^>]*href=["']([^"']*(?:JobPostings\/view\.asp|ApplyForJob\.aspx|_application\.aspx|default\.aspx\?[^"']*JobID=)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = applyPattern.exec(page);

  const extractRowContext = (matchIndex) => {
    const start = page.lastIndexOf("<tr", matchIndex);
    const end = page.indexOf("</tr>", matchIndex);
    if (start >= 0 && end > start) return page.slice(start, end + "</tr>".length);
    return page.slice(Math.max(0, matchIndex - 1200), Math.min(page.length, matchIndex + 1800));
  };
  const cleanApplitrackRowText = (rowHtml) =>
    decodeHtmlEntities(String(rowHtml || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  const extractDateFromRow = (rowText) => {
    const compact = String(rowText || "");
    return compact.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/)?.[0] ||
      compact.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i)?.[0] ||
      null;
  };
  const extractLocationFromRow = (rowText, titleParts) => {
    const compact = String(rowText || "");
    if (/\b(remote|virtual|telework|work from home)\b/i.test(compact)) return "Remote";
    const usCityState = compact.match(/\b([A-Z][A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?:\s+\d{5})?)\b/);
    if (usCityState?.[1]) return usCityState[1].trim();
    const countryMatch = compact.match(/\b(United States|USA|Canada|Turkey|T[üu]rkiye|United Kingdom|Germany|France|India|Australia)\b/i);
    if (countryMatch?.[1]) return countryMatch[1].trim();
    const withoutTitle = titleParts.reduce((text, part) => part ? text.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ") : text, compact);
    const locationLabel = withoutTitle.match(/\b(?:Location|School|Site|Campus)\s*:?\s*([A-Z][^|;]{2,80})/i);
    return locationLabel?.[1] ? locationLabel[1].trim().replace(/\s{2,}/g, " ") : null;
  };
  const extractRemoteTypeFromText = (rowText) => {
    const compact = String(rowText || "");
    if (/\bhybrid\b/i.test(compact)) return "hybrid";
    if (/\b(remote|primarily remote|virtual|telework|work from home|wfh)\b/i.test(compact)) return "remote";
    if (/\b(on[- ]?site|onsite|in person|in-person)\b/i.test(compact)) return "onsite";
    return null;
  };
  const stripTitleText = (value) => cleanSmartRecruitersText(
    decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
  );
  const queryValue = (urlValue, names) => {
    try {
      const parsed = new URL(String(urlValue || ""), siteRoot);
      for (const name of names) {
        const value = cleanSmartRecruitersText(parsed.searchParams.get(name));
        if (value) return value;
      }
    } catch {
      return "";
    }
    return "";
  };
  const addPosting = ({ jobId, category, specialty, linkText, rowContext, jobUrl }) => {
    const sourceJobId = cleanSmartRecruitersText(jobId);
    if (!sourceJobId || seenIds.has(sourceJobId)) return;
    const cleanCategory = cleanSmartRecruitersText(category);
    const cleanSpecialty = cleanSmartRecruitersText(specialty);
    const linkTitle = stripTitleText(linkText);
    const title = [cleanCategory, cleanSpecialty].filter(Boolean).join(" - ") || linkTitle || `Job ${sourceJobId}`;
    const canonicalUrl = jobUrl || new URL(`default.aspx?JobID=${encodeURIComponent(sourceJobId)}`, siteRoot).toString();
    const rowText = cleanApplitrackRowText(rowContext);

    postings.push({
      company_name: companyName,
      source_job_id: sourceJobId,
      position_name: title,
      job_posting_url: canonicalUrl,
      apply_url: canonicalUrl,
      remote_type: extractRemoteTypeFromText(rowText),
      posting_date: extractDateFromRow(rowText),
      location: extractLocationFromRow(rowText, [sourceJobId, cleanCategory, cleanSpecialty, title]),
      department: cleanCategory || null
    });
    seenIds.add(sourceJobId);
  };

  while (match) {
    const jobId = cleanSmartRecruitersText(match[1]);
    if (!jobId || seenIds.has(jobId)) {
      match = applyPattern.exec(page);
      continue;
    }

    const category = cleanSmartRecruitersText(match[2]);
    const specialty = cleanSmartRecruitersText(match[3]);
    const rowContext = extractRowContext(Number(match.index || 0));
    addPosting({
      jobId,
      category,
      specialty,
      rowContext
    });
    match = applyPattern.exec(page);
  }

  match = linkPattern.exec(page);
  while (match) {
    const href = String(match[1] || "").replace(/&amp;/gi, "&");
    let parsedLink = null;
    try {
      parsedLink = new URL(href, siteRoot);
    } catch {
      match = linkPattern.exec(page);
      continue;
    }
    const jobId =
      queryValue(parsedLink.toString(), ["AppliTrackJobId", "JobID", "jobid", "posJobCodes"]) ||
      String(parsedLink.pathname || "").match(/\/jobs?\/(\d+)/i)?.[1] ||
      "";
    const rowContext = extractRowContext(Number(match.index || 0));
    addPosting({
      jobId,
      category: queryValue(parsedLink.toString(), ["posFirstChoice", "category"]),
      specialty: queryValue(parsedLink.toString(), ["posSpecialty", "specialty"]),
      linkText: match[2],
      rowContext,
      jobUrl: new URL(`default.aspx?JobID=${encodeURIComponent(jobId)}`, siteRoot).toString()
    });
    match = linkPattern.exec(page);
  }

  return postings;
}

function extractApplitrackDetailFields(detailHtml) {
  const source = String(detailHtml || "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  const text = decodeHtmlEntities(
    source
      .replace(/&nbsp;/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:tr|td|th|div|p|li|span)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  const stopLabels = [
    "Date Posted",
    "Posted",
    "Posting Date",
    "Date Available",
    "Location",
    "School",
    "Site",
    "Campus",
    "Work Location",
    "Job Location",
    "Location(s)",
    "Building",
    "Worksite",
    "Assignment Location",
    "Closing Date",
    "Position Type",
    "Category",
    "Department",
    "Remote",
    "Work Location Type",
    "Work Type"
  ];
  const cleanDetailValue = (value) => String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*&nbsp;\s*/gi, " ")
    .trim();
  const escapeAndGuardLabel = (label) => {
    const escaped = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const startsWithWord = /^\w/.test(label);
    const endsWithWord = /\w$/.test(label);
    return (startsWithWord ? "\\b" : "") + escaped + (endsWithWord ? "\\b" : "");
  };
  const pickLabel = (labels) => {
    const sortedLabels = [...labels].sort((left, right) => String(right || "").length - String(left || "").length);
    const labelPattern = sortedLabels.map(escapeAndGuardLabel).join("|");
    if (!labelPattern) return null;
    const stopPattern = stopLabels
      .filter((label) => !labels.includes(label))
      .map(escapeAndGuardLabel)
      .join("|");
    const inlineMatch = text.match(new RegExp(`(?:${labelPattern})\\s*:?\\s*([^\\n]{1,180}?)(?=\\s+(?:${stopPattern})\\s*:|\\n|$)`, "i"));
    if (inlineMatch?.[1]) return cleanDetailValue(inlineMatch[1]);

    const lines = text.split(/\n+/);
    for (let index = 0; index < lines.length - 1; index += 1) {
      if (new RegExp(`^(?:${labelPattern})\\s*:?$`, "i").test(lines[index])) {
        return cleanDetailValue(lines[index + 1]) || null;
      }
    }
    return null;
  };
  const extractFooterAddressLocation = () => {
    const match = text.match(/\b([A-Z][A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s+\d{5})\b/);
    return match?.[1] ? cleanDetailValue(match[1]) : null;
  };
  const rawLocation = pickLabel(["Location", "Location(s)", "School", "Site", "Campus", "Building", "Worksite", "Assignment Location", "Work Location", "Job Location"]);
  const genericLocation = /^(district\s*wide|various|multiple|tbd|n\/a|to be determined)$/i.test(cleanDetailValue(rawLocation));
  const footerAddress = extractFooterAddressLocation();

  function extractApplitrackDescriptionHtml(detailHtml) {
    if (!detailHtml) return null;
    let cleaned = detailHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

    // Remove tags enclosing metadata labels
    const metadataRegex = /<(div|p|tr|li|span|td)\b[^>]*>(?:[\s\S](?!<\/\1>))*?\b(?:Date Posted|Location|Position Type|Category|Department|School|Site|Campus|Closing Date)\b[\s\S]*?<\/\1>/gi;
    cleaned = cleaned.replace(metadataRegex, "");

    // Extract content inside form, article, or table if present
    const match = cleaned.match(/<form\b[^>]*>([\s\S]*?)<\/form>/i) ||
                  cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
                  cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    let content = match ? match[1] : cleaned;

    content = content.trim();
    if (content.replace(/<[^>]+>/g, "").trim().length < 20) {
      return null;
    }
    return content;
  }

  const descHtml = extractApplitrackDescriptionHtml(detailHtml);

  return {
    posting_date:
      pickLabel(["Date Posted", "Posted", "Posting Date", "Date Available"]) ||
      text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/)?.[0] ||
      null,
    location: genericLocation ? rawLocation : (rawLocation || footerAddress),
    department: pickLabel(["Position Type", "Category", "Department"]),
    remote_type: normalizeExplicitRemoteValue(
      pickLabel(["Remote", "Work Location Type", "Work Type"]) ||
      text.match(/\b(?:primarily remote|remote|hybrid|telework|work from home|wfh|on[- ]?site|onsite)\b/i)?.[0] ||
      ""
    ),
    description_html: descHtml,
    description_plain: descHtml ? cleanSmartRecruitersText(descHtml) : null
  };
}

function buildApplitrackDetailUrl(siteRoot, jobId, fallbackJobUrl = "") {
  const sourceJobId = String(jobId || "").trim();
  if (!sourceJobId) return String(fallbackJobUrl || "").trim();
  const detailUrl = new URL("JobPostings/view.asp", siteRoot);
  detailUrl.searchParams.set("AppliTrackJobId", sourceJobId);
  detailUrl.searchParams.set("AppliTrackLayoutMode", "detail");
  detailUrl.searchParams.set("AppliTrackViewPosting", "1");
  detailUrl.searchParams.set("all", "1");
  detailUrl.searchParams.set("embed", "1");
  return detailUrl.toString();
}

module.exports = {
  buildApplitrackDetailUrl,
  extractApplitrackDetailFields,
  normalizeApplitrackUrl,
  parseApplitrackPostings
};
