"use strict";

const { safeFetch } = require("../../safeFetch");

async function fetchDetail(row, options = {}) {
  const url = row.canonical_url || row.job_posting_url || row.apply_url;
  if (!url) {
    throw new Error("Cannot fetch BambooHR detail: missing URL");
  }

  let targetUrl = url;
  if (url.includes("bamboohr.com")) {
    const matchCareers = url.match(/https:\/\/([^.]+)\.bamboohr\.com\/careers\/(\d+)/);
    if (matchCareers) {
      targetUrl = `https://${matchCareers[1]}.bamboohr.com/careers/${matchCareers[2]}/detail`;
    } else {
      const matchJobs = url.match(/https:\/\/([^.]+)\.bamboohr\.com\/jobs\/view\.php\?id=(\d+)/);
      if (matchJobs) {
        targetUrl = `https://${matchJobs[1]}.bamboohr.com/careers/${matchJobs[2]}/detail`;
      }
    }
  }

  const response = await safeFetch(targetUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "openjobslots-detail-refetch/1.0"
    }
  });

  if (!response.ok) {
    const error = new Error(`BambooHR detail fetch failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const json = await response.json();
  const jobOpening = json.result?.jobOpening || json.jobOpening || {};
  const description = jobOpening.description || "";
  const location = jobOpening.location || {};
  const atsLocation = jobOpening.atsLocation || {};

  const city = location.city || atsLocation.city || "";
  const state = location.state || location.province || location.region || atsLocation.state || "";
  const country = location.countryName || location.country || atsLocation.countryName || "";
  const isRemote = String(jobOpening.employmentStatusLabel || "").toLowerCase().includes("remote") ||
                   String(description).toLowerCase().includes("remote");

  // Construct mock HTML containing JSON-LD to satisfy Refetch Planner's default parsers
  const mockHtml = `
    <html>
    <body>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "description": ${JSON.stringify(description)},
        "jobLocation": {
          "@type": "Place",
          "address": {
            "@type": "PostalAddress",
            "addressLocality": ${JSON.stringify(city)},
            "addressRegion": ${JSON.stringify(state)},
            "addressCountry": ${JSON.stringify(country)}
          }
        },
        "jobLocationType": ${JSON.stringify(isRemote ? "TELECOMMUTE" : "")}
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
