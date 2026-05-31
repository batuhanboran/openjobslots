const { createSourceModule } = require("../common");
const parser = require("./parse");
const { clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");

const atsKey = "talentreef";
const baseModule = createSourceModule(atsKey);
const parserVersion = "source-talentreef-v1";
const discover = createDiscover(parserVersion);
const fetchList = createFetchList({ discover });
const payloadShapePolicy = Object.freeze({
  empty_job_list_stems: Object.freeze(["hits.hits"])
});

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return rawPayload || {};
  }
  return Object.fromEntries(Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__")));
}

function resolveCompanyName(company = {}, config = {}, fallback = "talentreef") {
  return (
    clean(company?.company_name) ||
    clean(company?.companyName) ||
    clean(company?.name) ||
    clean(config.companyName) ||
    clean(config.companyNameLower) ||
    clean(config.companyNameForPostings) ||
    fallback
  );
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  const companyName = resolveCompanyName(company, config, config.companyNameLower || "talentreef");
  const postings = parser.parseTalentreefPostingsFromSearchResponse(
    companyName,
    config,
    payload
  );

  return postings.map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: clean(rawPayload?.__sourceRequest?.boardUrl || config.boardUrl || target.list_url),
      api_url: clean(rawPayload?.__sourceRequest?.searchApiUrl || config.searchApiUrl)
    }
  }));
}

module.exports = {
  ...baseModule,
  ...parser,
  atsKey,
  key: atsKey,
  family: baseModule.family,
  status: baseModule.status,
  parserVersion,
  discover,
  fetchList,
  parse,
  payloadShapePolicy
};
