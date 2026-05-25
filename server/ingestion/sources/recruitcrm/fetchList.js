"use strict";

const { safeFetch } = require("../../safeFetch");
const { parseRecruitCrmPublicCompany } = require("./discover");

function clean(value) {
  return String(value || "").trim();
}

async function fetchJson(url, init = {}) {
  const response = await safeFetch(url, {
    ...init,
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`RecruitCRM API request failed (${response.status}): ${body.slice(0, 180)}`);
  }
  return response.json();
}

function extractBatch(payload) {
  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (Array.isArray(data?.data?.jobs)) return data.data.jobs;
  if (Array.isArray(data?.jobs)) return data.jobs;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const target = discover(company);
    const config = target?.config?.apiUrl
      ? target.config
      : parseRecruitCrmPublicCompany(company.url_string || company.company_url || company.url);
    if (!config?.apiUrl) {
      return {
        data: { jobs: [] },
        __sourceConfig: config || {}
      };
    }

    const jobs = [];
    const seen = new Set();
    const limit = 100;
    const maxPages = Math.max(1, Math.min(5, Number(process.env.OPENJOBSLOTS_RECRUITCRM_SOURCE_MAX_PAGES || 5)));
    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const body = JSON.stringify({
        limit,
        offset,
        search_data: "",
        onlyJobs: true
      });
      const payload = options.fetcher
        ? await options.fetcher(config.apiUrl, {
            ...target,
            method: "POST",
            headers: {
              Accept: "application/json, text/plain, */*",
              "Content-Type": "application/json",
              Origin: "https://recruitcrm.io",
              Referer: config.publicJobsUrl
            },
            body
          })
        : await fetchJson(config.apiUrl, {
            method: "POST",
            headers: {
              Origin: "https://recruitcrm.io",
              Referer: config.publicJobsUrl
            },
            body
          });
      const batch = extractBatch(payload);
      for (const item of batch) {
        const key = clean(item?.id || item?.job_id || item?.jobId || item?.uuid || item?.jobcode || item?.slug || item?.url);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        jobs.push(item);
      }
      if (batch.length < limit) break;
    }

    return {
      data: { jobs },
      __sourceConfig: config
    };
  };
}

module.exports = {
  createFetchList
};
