"use strict";

const {
  clean,
  createBasicSourceContract
} = require("../sourceModuleHelpers");
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
  fetchList: async () => null,
  fetchDetail: async () => null,
  parse
};
