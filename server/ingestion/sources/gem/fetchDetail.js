"use strict";

const { safeFetch } = require("../../safeFetch");

async function fetchDetail(row, options = {}) {
  const url = row.canonical_url || row.job_posting_url || row.apply_url;
  if (!url) {
    throw new Error("Cannot fetch Gem detail: missing URL");
  }

  const match = url.match(/jobs\.gem\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error("Could not parse boardId/extId from Gem URL");
  }

  const boardId = match[1];
  const extId = match[2];
  const queryPayload = [
    {
      operationName: "ExternalJobPostingQuery",
      variables: {
        boardId: boardId,
        extId: extId
      },
      query: "query ExternalJobPostingQuery($boardId: String!, $extId: String!) { oatsExternalJobPosting(boardId: $boardId, extId: $extId) { id title descriptionHtml extId } }"
    }
  ];

  const response = await safeFetch("https://jobs.gem.com/api/public/graphql/batch", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "openjobslots-detail-refetch/1.0"
    },
    body: JSON.stringify(queryPayload)
  });

  if (!response.ok) {
    const error = new Error(`Gem detail fetch failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const json = await response.json();
  const payload = Array.isArray(json) ? json : [];
  let descriptionHtml = "";
  for (const item of payload) {
    const posting = item?.data?.oatsExternalJobPosting;
    if (posting && posting.descriptionHtml) {
      descriptionHtml = posting.descriptionHtml;
      break;
    }
  }

  if (!descriptionHtml) {
    throw new Error("No description found in Gem GraphQL response");
  }

  const mockHtml = `
    <html>
    <body>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "description": ${JSON.stringify(descriptionHtml)}
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
