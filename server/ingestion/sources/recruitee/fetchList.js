"use strict";

const { safeFetch } = require("../../safeFetch");
const { parseRecruiteeCompany } = require("./discover");

async function fetchJson(url, init = {}) {
  const response = await safeFetch(url, {
    ...init,
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)",
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Recruitee offers API request failed (${response.status}): ${body.slice(0, 180)}`);
  }
  return response.json();
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const target = discover(company);
    const config = target?.config?.apiUrl
      ? target.config
      : parseRecruiteeCompany(company.url_string || company.company_url || company.url);
    if (!config?.apiUrl) {
      return {
        offers: [],
        __sourceConfig: config || {}
      };
    }

    const payload = options.fetcher
      ? await options.fetcher(config.apiUrl, {
          ...target,
          method: "GET",
          headers: {
            Accept: "application/json, text/plain, */*"
          }
        })
      : await fetchJson(config.apiUrl, { method: "GET" });

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return {
        ...payload,
        __sourceConfig: config
      };
    }
    return {
      offers: [],
      __sourceConfig: config
    };
  };
}

module.exports = {
  createFetchList
};
