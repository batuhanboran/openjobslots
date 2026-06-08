"use strict";

const { safeFetch } = require("../../safeFetch");

function findDescriptionInObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = findDescriptionInObject(item);
      if (res) return res;
    }
    return null;
  }
  const commonKeys = [
    "Job_Description", "Job_Description_Val", "JobDescription", "descriptionHtml", 
    "description", "Description", "FullDescription", "LocalizedDescription", "JobDescriptionHtml",
    "descriptionPlain", "openingHtml", "opening"
  ];
  for (const key of commonKeys) {
    if (obj[key] && typeof obj[key] === "string" && obj[key].trim().length > 20) {
      return obj[key];
    }
  }
  for (const key in obj) {
    const res = findDescriptionInObject(obj[key]);
    if (res) return res;
  }
  return null;
}

function extractDescriptionFromJsonLd(html) {
  const regex = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const jsonText = match[1].trim();
    if (!jsonText) continue;
    try {
      const cleaned = jsonText
        .replace(/^\s*<!--/, "")
        .replace(/-->\s*$/, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      const desc = findDescriptionInObject(parsed);
      if (desc) return desc;
    } catch (e) {
      // ignore
    }
  }
  return null;
}

function extractZohoDescription(html) {
  const match = html.match(/JSON\.parse\('([\s\S]*?)'\)/) || html.match(/JSON\.parse\("([\s\S]*?)"\)/);
  if (match) {
    try {
      let escapedStr = match[1];
      let decoded = escapedStr
        .replace(/\\x([0-9A-Fa-f]{2})/g, (g, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u([0-9A-Fa-f]{4})/g, (g, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\(.)/g, "$1");
      
      const parsed = JSON.parse(decoded);
      const desc = findDescriptionInObject(parsed);
      if (desc) return desc;
    } catch (e) {
      // ignore
    }
  }
  return null;
}

async function fetchDetail(row, options = {}) {
  const url = row.canonical_url || row.job_posting_url || row.apply_url;
  if (!url) {
    throw new Error("Cannot fetch Zoho detail: missing URL");
  }

  const response = await safeFetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "openjobslots-detail-refetch/1.0"
    }
  });

  if (!response.ok) {
    const error = new Error(`Zoho detail fetch failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const text = await response.text();
  let description = extractDescriptionFromJsonLd(text);
  if (!description) {
    description = extractZohoDescription(text);
  }

  if (description) {
    const mockHtml = `
      <html>
      <body>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "description": ${JSON.stringify(description)}
        }
        </script>
      </body>
      </html>
    `;
    return {
      ok: true,
      status: response.status,
      html: mockHtml,
      detailUrl: url
    };
  }

  return {
    ok: true,
    status: response.status,
    html: text,
    detailUrl: url
  };
}

module.exports = fetchDetail;
