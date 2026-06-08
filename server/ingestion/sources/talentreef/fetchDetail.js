"use strict";

const { safeFetch } = require("../../safeFetch");

async function fetchDetail(row, options = {}) {
  const url = row.canonical_url || row.job_posting_url || row.apply_url;
  if (!url) {
    throw new Error("Cannot fetch Talentreef detail: missing URL");
  }

  const response = await safeFetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "openjobslots-detail-refetch/1.0"
    }
  });

  if (!response.ok) {
    const error = new Error(`Talentreef detail fetch failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const text = await response.text();
  return {
    ok: true,
    status: response.status,
    html: text,
    detailUrl: url
  };
}

module.exports = fetchDetail;
