"use strict";

const { safeFetch } = require("../../safeFetch");
const { parseFountainCompany } = require("./discover");

const DEFAULT_FOUNTAIN_MAX_PAGES = 8;
const HARD_FOUNTAIN_MAX_PAGES = 25;

function readPositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

function resolveMaxPages(options = {}) {
  const configured = readPositiveInteger(
    options.maxFountainPages ?? options.maxPages ?? process.env.OPENJOBSLOTS_FOUNTAIN_MAX_PAGES_PER_COMPANY,
    DEFAULT_FOUNTAIN_MAX_PAGES
  );
  return Math.min(configured, HARD_FOUNTAIN_MAX_PAGES);
}

function pageUrl(apiUrl, pageNumber) {
  const parsed = new URL(apiUrl);
  parsed.searchParams.set("page", String(pageNumber));
  return parsed.toString();
}

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
    throw new Error(`Fountain openings API request failed (${response.status}): ${body.slice(0, 180)}`);
  }
  return response.json();
}

function createFetchList(discover) {
  return async function fetchList(company = {}, options = {}) {
    const target = discover(company);
    const config = target?.config?.apiUrl
      ? target.config
      : parseFountainCompany(company.url_string || company.company_url || company.url);
    if (!config?.apiUrl) {
      return {
        openings: [],
        __sourceConfig: config || {}
      };
    }

    const maxPages = resolveMaxPages(options);
    const fetchPage = async (url) => options.fetcher
      ? options.fetcher(url, {
          ...target,
          method: "GET",
          headers: {
            Accept: "application/json, text/plain, */*"
          }
        })
      : fetchJson(url, { method: "GET" });

    const firstPayload = await fetchPage(config.apiUrl);
    const pagePayloads = [firstPayload];
    let nextPage = Number(firstPayload?.pagination?.next_page || 0);
    let pageCount = 1;

    while (nextPage && pageCount < maxPages) {
      const payload = await fetchPage(pageUrl(config.apiUrl, nextPage));
      pagePayloads.push(payload);
      pageCount += 1;
      nextPage = Number(payload?.pagination?.next_page || 0);
    }

    const openings = [];
    const positions = [];
    const stateCodes = new Set();
    for (const payload of pagePayloads) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      if (Array.isArray(payload.openings)) openings.push(...payload.openings);
      if (Array.isArray(payload.positions)) positions.push(...payload.positions);
      if (Array.isArray(payload.state_codes)) {
        for (const stateCode of payload.state_codes) {
          if (stateCode) stateCodes.add(stateCode);
        }
      }
    }

    if (firstPayload && typeof firstPayload === "object" && !Array.isArray(firstPayload)) {
      return {
        ...firstPayload,
        openings,
        positions,
        state_codes: Array.from(stateCodes),
        __sourceFetchPageCount: pageCount,
        __sourceFetchMaxPages: maxPages,
        __sourceFetchTruncated: Boolean(nextPage),
        __sourceConfig: config
      };
    }
    return {
      openings: [],
      __sourceFetchPageCount: pageCount,
      __sourceFetchMaxPages: maxPages,
      __sourceFetchTruncated: Boolean(nextPage),
      __sourceConfig: config
    };
  };
}

module.exports = {
  createFetchList
};
