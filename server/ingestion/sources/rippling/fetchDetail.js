"use strict";

const { safeFetch } = require("../../safeFetch");
const { parseRipplingCompany } = require("./discover");

async function fetchDetail(row, options = {}) {
  const url = row.canonical_url || row.job_posting_url || row.apply_url;
  if (!url) {
    throw new Error("Cannot fetch Rippling detail: missing URL");
  }

  const config = parseRipplingCompany(url);
  if (!config) {
    throw new Error(`Cannot parse Rippling career site configuration from URL: ${url}`);
  }

  let jobId = "";
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const jobIndex = pathParts.findIndex(p => p.toLowerCase() === "jobs" || p.toLowerCase() === "job");
    if (jobIndex >= 0 && jobIndex + 1 < pathParts.length) {
      jobId = pathParts[jobIndex + 1];
    }
  } catch (err) {
    // ignore
  }

  if (!jobId) {
    throw new Error(`Cannot extract jobId from Rippling URL: ${url}`);
  }

  const apiTargetUrl = `https://ats.rippling.com/api/v2/board/${config.companySlug}/jobs/${jobId}`;

  const response = await safeFetch(apiTargetUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    const error = new Error(`Rippling detail fetch failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const json = await response.json();
  let description = "";
  if (json.description) {
    if (typeof json.description === "object") {
      description = [json.description.company, json.description.role].filter(Boolean).join("\n");
    } else {
      description = String(json.description);
    }
  }

  const title = json.name || "";
  const locations = Array.isArray(json.workLocations) ? json.workLocations : [];
  const location = locations.map(l => l.name || l.city || "").filter(Boolean).join(" / ");
  const isRemote = String(json.employmentType).toLowerCase().includes("remote") ||
                   locations.some(l => String(l.name).toLowerCase().includes("remote") || String(l.workplaceType).toLowerCase().includes("remote")) ||
                   String(description).toLowerCase().includes("remote");

  const datePosted = json.createdOn || "";

  // Construct mock HTML containing JSON-LD
  const mockHtml = `
    <html>
    <body>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": ${JSON.stringify(title)},
        "description": ${JSON.stringify(description)},
        "jobLocation": {
          "@type": "Place",
          "name": ${JSON.stringify(location)}
        },
        "jobLocationType": ${JSON.stringify(isRemote ? "TELECOMMUTE" : "")},
        "datePosted": ${JSON.stringify(datePosted)}
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

module.exports = fetchDetail;
