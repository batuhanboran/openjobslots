"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanTheApplicantManagerText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function normalizeTheApplicantManagerUrl(rawUrl, config = {}) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    return new URL(value, `${config.baseOrigin || "https://theapplicantmanager.com"}/`).toString();
  } catch {
    return "";
  }
}

function extractTheApplicantManagerSourceId(absoluteUrl) {
  try {
    const parsed = new URL(String(absoluteUrl || ""));
    for (const key of ["pos", "job", "jobId", "jobid", "id", "req", "reqid"]) {
      const value = String(parsed.searchParams.get(key) || "").trim();
      if (value) return value;
    }
    const lastPart = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "").trim();
    if (lastPart && !["jobs", "job", "careers", "career", "apply"].includes(lastPart.toLowerCase())) return lastPart;
  } catch {
    return "";
  }
  return "";
}

function extractTheApplicantManagerLocationFromHtml(rowHtml) {
  const source = String(rowHtml || "");
  const locationPattern =
    /<([a-z0-9]+)[^>]*class=["'][^"']*(?:\bpos_location_list\b|\blocation\b)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i;
  const match = source.match(locationPattern);
  const location = cleanTheApplicantManagerText(match?.[2] || "").replace(/^\s*Location:\s*/i, "").trim();
  return location || "";
}

function extractContainerHtml(source, anchorIndex) {
  const html = String(source || "");
  const index = Math.max(0, Number(anchorIndex || 0));
  for (const tag of ["section", "p", "li", "div"]) {
    const openPattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    let openMatch = openPattern.exec(html);
    let latestOpen = null;
    while (openMatch && openMatch.index <= index) {
      latestOpen = openMatch;
      openMatch = openPattern.exec(html);
    }
    if (!latestOpen) continue;
    const closeIndex = html.toLowerCase().indexOf(`</${tag}>`, index);
    const previousClose = html.toLowerCase().lastIndexOf(`</${tag}>`, index);
    if (closeIndex > index && previousClose < latestOpen.index) {
      return html.slice(latestOpen.index, closeIndex + tag.length + 3);
    }
  }
  return html.slice(index, Math.min(html.length, index + 1000));
}

function buildTheApplicantManagerPosting(companyNameForPostings, config, rowHtml, href, titleHtml, department) {
  const absoluteUrl = normalizeTheApplicantManagerUrl(href, config);
  const title = cleanTheApplicantManagerText(titleHtml || "");
  if (!absoluteUrl || !title || title.toLowerCase() === "resume") return null;
  const sourceJobId = extractTheApplicantManagerSourceId(absoluteUrl);
  const location = extractTheApplicantManagerLocationFromHtml(rowHtml);
  return {
    company_name: companyNameForPostings,
    source_job_id: sourceJobId,
    position_name: title,
    job_posting_url: absoluteUrl,
    posting_date: null,
    location: location || null,
    department: department || null,
    source_evidence: {
      title_source: "labeled_html",
      title_path: "a.pos_title_list",
      canonical_url_source: "labeled_html",
      canonical_url_path: "a.pos_title_list[href]",
      source_job_id_source: sourceJobId ? "url_query" : "",
      source_job_id_path: sourceJobId ? "pos|job|jobId|id|req" : "",
      location_source: location ? "labeled_html" : "",
      location_path: location ? ".pos_location_list|.location" : "",
      location_rule_name: location ? "theapplicantmanager_labeled_list_location" : "",
      department_source: department ? "labeled_html" : "",
      department_path: department ? "p.pos_title_list.bold_font" : ""
    }
  };
}

function parseTheApplicantManagerPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();
  let currentDepartment = "";

  const paragraphPattern =
    /<p[^>]*class=["']([^"']*\bpos_title_list\b[^"']*)["'][^>]*>([\s\S]*?)<\/p>/gi;
  const linkPattern =
    /<a[^>]*class=["'][^"']*\bpos_title_list\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

  let paragraphMatch = paragraphPattern.exec(source);
  while (paragraphMatch) {
    const classNames = String(paragraphMatch[1] || "").toLowerCase();
    const bodyHtml = String(paragraphMatch[2] || "");

    if (classNames.includes("bold_font")) {
      currentDepartment = cleanTheApplicantManagerText(bodyHtml);
      paragraphMatch = paragraphPattern.exec(source);
      continue;
    }

    const linkMatch = bodyHtml.match(linkPattern);
    if (!linkMatch?.[1]) {
      paragraphMatch = paragraphPattern.exec(source);
      continue;
    }

    const posting = buildTheApplicantManagerPosting(
      companyNameForPostings,
      config,
      bodyHtml,
      linkMatch[1],
      linkMatch[2],
      currentDepartment || null
    );
    if (!posting || seenUrls.has(posting.job_posting_url)) {
      paragraphMatch = paragraphPattern.exec(source);
      continue;
    }

    postings.push(posting);
    seenUrls.add(posting.job_posting_url);
    paragraphMatch = paragraphPattern.exec(source);
  }

  const fallbackLinkPattern =
    /<a[^>]*class=["'][^"']*\bpos_title_list\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let fallbackMatch = fallbackLinkPattern.exec(source);
  while (fallbackMatch) {
    const contextBefore = source.slice(Math.max(0, Number(fallbackMatch.index || 0) - 1200), Number(fallbackMatch.index || 0));
    const departmentMatches = Array.from(
      contextBefore.matchAll(
        /<p[^>]*class=["'][^"']*\bpos_title_list\b[^"']*\bbold_font\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi
      )
    );
    const department =
      departmentMatches.length > 0 ? cleanTheApplicantManagerText(departmentMatches[departmentMatches.length - 1][1] || "") : "";
    const rowHtml = extractContainerHtml(source, fallbackMatch.index);
    const posting = buildTheApplicantManagerPosting(
      companyNameForPostings,
      config,
      rowHtml,
      fallbackMatch[1],
      fallbackMatch[2],
      department || null
    );

    if (posting && !seenUrls.has(posting.job_posting_url)) {
      postings.push(posting);
      seenUrls.add(posting.job_posting_url);
    }
    fallbackMatch = fallbackLinkPattern.exec(source);
  }

  return postings;
}

module.exports = {
  parseTheApplicantManagerPostingsFromHtml
};
