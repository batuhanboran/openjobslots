"use strict";

const { safeFetch } = require("../../safeFetch");

async function fetchDetail(row, options = {}) {
  const url = row.canonical_url || row.job_posting_url || row.apply_url;
  if (!url) {
    throw new Error("Cannot fetch Workday detail: missing URL");
  }

  let targetUrl = url;
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const jobIndex = pathParts.findIndex(p => p.toLowerCase() === "job");
    if (jobIndex >= 1) {
      const tenant = pathParts[0];
      const jobPath = pathParts.slice(jobIndex + 1).join("/");
      targetUrl = `${parsed.protocol}//${parsed.host}/wday/cxs/${tenant}/job/${jobPath}`;
    }
  } catch (err) {
    // Fallback to url
  }

  const response = await safeFetch(targetUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "openjobslots-detail-refetch/1.0"
    }
  });

  if (!response.ok) {
    // If API endpoint fails, try to fetch the original HTML page as a fallback
    const htmlResponse = await safeFetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "openjobslots-detail-refetch/1.0"
      }
    });
    if (!htmlResponse.ok) {
      const error = new Error(`Workday detail fetch failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const htmlText = await htmlResponse.text();
    return {
      ok: true,
      status: htmlResponse.status,
      html: htmlText,
      detailUrl: url
    };
  }

  const json = await response.json();
  const info = json.jobPostingInfo || json || {};
  const description = info.jobDescription || info.description || "";
  const location = info.location || info.locationText || "";
  const startDate = info.startDate || info.postedDate || "";
  const isRemote = String(info.remoteType || "").toLowerCase().includes("remote") ||
                   String(location).toLowerCase().includes("remote") ||
                   String(description).toLowerCase().includes("remote");

  // Construct mock HTML containing JSON-LD
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
          "name": ${JSON.stringify(location)}
        },
        "jobLocationType": ${JSON.stringify(isRemote ? "TELECOMMUTE" : "")},
        "datePosted": ${JSON.stringify(startDate)}
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
