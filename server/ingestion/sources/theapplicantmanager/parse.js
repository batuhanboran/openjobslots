"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanTheApplicantManagerText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
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

    const href = String(linkMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      paragraphMatch = paragraphPattern.exec(source);
      continue;
    }

    const title = cleanTheApplicantManagerText(linkMatch[2] || "");
    if (!title || title.toLowerCase() === "resume") {
      paragraphMatch = paragraphPattern.exec(source);
      continue;
    }

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: null,
      department: currentDepartment || null
    });
    seenUrls.add(absoluteUrl);
    paragraphMatch = paragraphPattern.exec(source);
  }

  if (postings.length > 0) return postings;

  const fallbackLinkPattern =
    /<a[^>]*class=["'][^"']*\bpos_title_list\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let fallbackMatch = fallbackLinkPattern.exec(source);
  while (fallbackMatch) {
    const href = String(fallbackMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      fallbackMatch = fallbackLinkPattern.exec(source);
      continue;
    }

    const title = cleanTheApplicantManagerText(fallbackMatch[2] || "");
    if (!title || title.toLowerCase() === "resume") {
      fallbackMatch = fallbackLinkPattern.exec(source);
      continue;
    }

    const contextBefore = source.slice(Math.max(0, Number(fallbackMatch.index || 0) - 1200), Number(fallbackMatch.index || 0));
    const departmentMatches = Array.from(
      contextBefore.matchAll(
        /<p[^>]*class=["'][^"']*\bpos_title_list\b[^"']*\bbold_font\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi
      )
    );
    const department =
      departmentMatches.length > 0 ? cleanTheApplicantManagerText(departmentMatches[departmentMatches.length - 1][1] || "") : "";

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: null,
      department: department || null
    });
    seenUrls.add(absoluteUrl);
    fallbackMatch = fallbackLinkPattern.exec(source);
  }

  return postings;
}

module.exports = {
  parseTheApplicantManagerPostingsFromHtml
};
