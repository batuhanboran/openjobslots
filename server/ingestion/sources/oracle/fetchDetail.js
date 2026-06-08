"use strict";

const { safeFetch } = require("../../safeFetch");
const { parseOracleCompany } = require("./discover");

async function fetchDetail(row, options = {}) {
  const url = row.canonical_url || row.job_posting_url || row.apply_url;
  if (!url) {
    throw new Error("Cannot fetch Oracle detail: missing URL");
  }

  // Parse the URL to get host, siteNumber and language
  const config = parseOracleCompany(url);
  if (!config) {
    throw new Error(`Cannot parse Oracle career site configuration from URL: ${url}`);
  }

  // Extract jobId
  let jobId = "";
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const jobIndex = pathParts.findIndex(p => p.toLowerCase() === "job");
    if (jobIndex >= 0 && jobIndex + 1 < pathParts.length) {
      jobId = pathParts[jobIndex + 1];
    }
  } catch (err) {
    // ignore
  }

  if (!jobId) {
    throw new Error(`Cannot extract jobId from Oracle URL: ${url}`);
  }

  // Call the REST API endpoint:
  // https://{tenantHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails/{jobId}
  const apiTargetUrl = `${config.siteBaseUrl}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails/${jobId}`;

  const response = await safeFetch(apiTargetUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    // If the API endpoint fails, try to fetch the original HTML page as a fallback
    const htmlResponse = await safeFetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "openjobslots-detail-refetch/1.0"
      }
    });
    if (!htmlResponse.ok) {
      const error = new Error(`Oracle detail fetch failed with HTTP ${response.status}`);
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
  const description = [
    json.ExternalDescriptionStr,
    json.ExternalResponsibilitiesStr,
    json.ExternalQualificationsStr
  ].filter(Boolean).join("\n");

  const title = json.Title || json.title || "";
  const location = json.PrimaryLocation || json.primaryLocation || "";
  const workplaceType = json.WorkplaceType || json.workplaceType || "";
  const datePosted = json.ExternalPostedStartDate || json.PostedDate || "";
  const isRemote = String(workplaceType).toLowerCase().includes("remote") ||
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
