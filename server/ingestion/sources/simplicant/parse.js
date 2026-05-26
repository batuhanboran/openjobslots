"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanSimplicantText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractSimplicantSourceId(jobPostingUrl) {
  const raw = String(jobPostingUrl || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
    const jobsIndex = parts.findIndex((part) => part.toLowerCase() === "jobs");
    if (jobsIndex >= 0 && parts[jobsIndex + 1]) return parts[jobsIndex + 1];
    const leadsIndex = parts.findIndex((part) => part.toLowerCase() === "leads");
    if (leadsIndex >= 0 && parts[leadsIndex + 1]) return parts[leadsIndex + 1];
  } catch {
    const match = raw.match(/\/(?:jobs|leads)\/([^/?#]+)\/detail\b/i);
    if (match?.[1]) return match[1];
  }
  return "";
}

function isSimplicantDetailHref(href) {
  const raw = String(href || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw, "https://fixture.simplicant.com");
    const parts = parsed.pathname.split("/").map((part) => part.trim().toLowerCase()).filter(Boolean);
    const routeIndex = parts.findIndex((part) => part === "jobs" || part === "leads");
    return routeIndex >= 0 && Boolean(parts[routeIndex + 1]) && parts[routeIndex + 2] === "detail";
  } catch {
    return /\/(?:jobs|leads)\/[^/?#]+\/detail(?:[/?#]|$)/i.test(raw);
  }
}

function inferSimplicantRemoteType(title, location) {
  const evidence = [title, location].map(cleanSimplicantText).filter(Boolean).join(" ").toLowerCase();
  if (/\bhybrid\b/.test(evidence)) return "hybrid";
  if (/\b(remote|work from home|virtual)\b/.test(evidence)) return "remote";
  if (cleanSimplicantText(location)) return "onsite";
  return "unknown";
}

function parseSimplicantPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<a(?=[^>]*class=["'][^"']*\blist-group-item\b[^"']*["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/gi;
  const titlePattern = /<h3[^>]*class=["'][^"']*\bjob-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i;
  const locationPattern = /<div[^>]*class=["'][^"']*\bjob-subtitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let match = cardPattern.exec(source);
  while (match) {
    const href = cleanSimplicantText(match[1] || "");
    if (!isSimplicantDetailHref(href)) {
      match = cardPattern.exec(source);
      continue;
    }

    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(href, `${config.baseOrigin || ""}/`).toString();
    } catch {
      match = cardPattern.exec(source);
      continue;
    }
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      match = cardPattern.exec(source);
      continue;
    }

    const bodyHtml = String(match[2] || "");
    const title = cleanSimplicantText(bodyHtml.match(titlePattern)?.[1] || "") || "Untitled Position";
    const location = cleanSimplicantText(bodyHtml.match(locationPattern)?.[1] || "");
    const sourceJobId = extractSimplicantSourceId(absoluteUrl);
    const remoteType = inferSimplicantRemoteType(title, location);

    postings.push({
      source_job_id: sourceJobId,
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null,
      remote_type: remoteType,
      source_evidence: {
        source_job_id_path: "a.list-group-item href /(jobs|leads)/{id}/detail",
        title_source: "list_html",
        title_path: "a.list-group-item h3.job-title",
        company_source: "company_context",
        company_path: "company.company_name or tenant subdomain",
        location_source: location ? "list_html" : "",
        location_path: location ? "a.list-group-item div.job-subtitle" : "",
        remote_source: remoteType !== "unknown" ? "list_html" : "",
        remote_path: remoteType !== "unknown" ? "a.list-group-item title/location text" : "",
        posting_date_source: "",
        posting_date_path: ""
      }
    });

    seenUrls.add(absoluteUrl);
    match = cardPattern.exec(source);
  }

  return postings;
}

module.exports = {
  cleanSimplicantText,
  extractSimplicantSourceId,
  isSimplicantDetailHref,
  inferSimplicantRemoteType,
  parseSimplicantPostingsFromHtml
};
