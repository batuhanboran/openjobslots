"use strict";

const {
  clean,
  createBasicSourceContract
} = require("../sourceModuleHelpers");
const { discover } = require("./discover");
const { fetchList } = require("./fetchList");
const parser = require("./parse");

const ATS_KEY = "personio";
const SOURCE_FAMILY = "direct_json";
const PARSER_VERSION = "source-personio-v1";
const FIXTURE_PATHS = Object.freeze([
  `server/ingestion/sources/${ATS_KEY}/fixtures/company.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`,
  `server/ingestion/sources/${ATS_KEY}/fixtures/invalid-shapes.json`
]);

const sourceContract = createBasicSourceContract({
  atsKey: ATS_KEY,
  sourceFamily: SOURCE_FAMILY,
  parserVersion: PARSER_VERSION,
  parserConfidence: 0.72,
  requestsPerMinute: 12,
  rateLimitStrategy: "official-xml-feed-per-host-serialized",
  fixturePaths: FIXTURE_PATHS
});

function normalizeCompanyName(company = {}, fallback = "personio") {
  return clean(company.company_name || company.companyName || company.name || fallback) || fallback;
}

function parse(rawPayload, company = {}) {
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const companyName = normalizeCompanyName(company, config.companySlug || "personio");
  return parser.parsePersonioPostingsFromXml(companyName, config, rawPayload);
}

function validate(posting) {
  const basic = sourceContract.validate(posting);
  if (!basic.ok) return basic;
  if (!clean(posting?.source_job_id)) {
    return { ok: false, error: "missing source_job_id", status: "quarantined" };
  }
  return basic;
}

module.exports = {
  ...parser,
  ...sourceContract,
  atsKey: ATS_KEY,
  key: ATS_KEY,
  family: "direct-json-stable",
  status: "disabled",
  parserVersion: PARSER_VERSION,
  payloadShapePolicy: Object.freeze({
    empty_job_list_stems: Object.freeze(["positions", "position"])
  }),
  discover,
  fetchList,
  fetchDetail: async () => null,
  parse,
  validate
};
