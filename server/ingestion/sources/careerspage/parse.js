"use strict";

const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { decodeHtmlEntities } = require("../../parsers/shared/html");

function cleanCareerspageText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseCareerspagePostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const jobItemPattern = /<div[^>]*class=['"][^'"]*\bjob-item\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let itemMatch = jobItemPattern.exec(source);

  while (itemMatch) {
    const itemHtml = String(itemMatch[1] || "");
    const hrefRaw = String(
      itemHtml.match(/href=['"](https?:\/\/careerspage\.io\/[^'"?#]+\/[^'"?#]+)['"]/i)?.[1] || ""
    ).trim();
    if (!hrefRaw) {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }

    const title = cleanCareerspageText(itemHtml.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i)?.[1] || "");
    if (!title) {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }

    let jobUrl = "";
    try {
      jobUrl = new URL(hrefRaw, `${String(config?.boardUrl || "").replace(/\/+$/, "")}/`).toString();
    } catch {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }
    if (!jobUrl || seenUrls.has(jobUrl)) {
      itemMatch = jobItemPattern.exec(source);
      continue;
    }

    const location = cleanCareerspageText(
      itemHtml.match(/fa-location-arrow[^<]*<\/i>\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""
    );
    const employmentType = cleanCareerspageText(
      itemHtml.match(/fa-business-time[^<]*<\/i>\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""
    );

    postings.push({
      company_name: companyNameForPostings,
      position_name: title || "Untitled Position",
      source_job_id: extractSourceIdFromPostingUrl(jobUrl, "careerspage"),
      job_posting_url: jobUrl,
      posting_date: null,
      location: location || null,
      employment_type: employmentType || null
    });
    seenUrls.add(jobUrl);
    itemMatch = jobItemPattern.exec(source);
  }

  return postings;
}

module.exports = {
  parseCareerspagePostingsFromHtml
};
