"use strict";

const {
  clean,
  createBasicSourceContract
} = require("../sourceModuleHelpers");
const { safeFetch } = require("../../safeFetch");
const parser = require("./parse");

const ATS_KEY = "remoteok";
const SOURCE_FAMILY = "direct_json";
const PARSER_VERSION = "source-remoteok-v1";
const FIXTURE_PATHS = Object.freeze([
  `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`
]);

const sourceContract = createBasicSourceContract({
  atsKey: ATS_KEY,
  sourceFamily: SOURCE_FAMILY,
  parserVersion: PARSER_VERSION,
  parserConfidence: 0.80,
  requestsPerMinute: 6,
  rateLimitStrategy: "public-json-api-global-serialized",
  fixturePaths: FIXTURE_PATHS
});

function discover(company = {}) {
  return {
    ats_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    company,
    list_url: "https://remoteok.com/api",
    config: { apiUrl: "https://remoteok.com/api" },
    parser_version: PARSER_VERSION
  };
}

async function fetchList(company = {}) {
  const url = "https://remoteok.com/api";
  const response = await safeFetch(url, {
    headers: { accept: "application/json, text/plain, */*" }
  });
  const text = typeof response === "string" ? response
    : (typeof response?.text === "function" ? await response.text() : String(response?.body || "[]"));
  return JSON.parse(String(text || "[]"));
}

function parse(rawPayload, company = {}) {
  return parser.parseRemoteOkPostingsFromApi("remoteok", {}, rawPayload);
}

module.exports = {
  ...parser,
  ...sourceContract,
  atsKey: ATS_KEY,
  key: ATS_KEY,
  family: "direct-json-stable",
  status: "enabled",
  parserVersion: PARSER_VERSION,
  payloadShapePolicy: Object.freeze({
    optional_enrichment_prefixes: Object.freeze(["__legacyParsed", "__sourceConfig"])
  }),
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse
};
