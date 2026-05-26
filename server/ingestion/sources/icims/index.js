const { createSourceModule } = require("../common");
const { SOURCE_FAMILIES, SOURCE_STATUSES } = require("../../sourceContracts");
const { clean, createDiscover } = require("./discover");
const { createFetchList } = require("./fetchList");
const parser = require("./parse");

const atsKey = "icims";
const baseModule = createSourceModule(atsKey);
const parserVersion = `${baseModule.parserVersion || "source-icims-v1"}`;
const discover = createDiscover(parserVersion);
const fetchList = createFetchList({ discover });

function stripInternalPayloadFields(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return rawPayload || {};
  }
  return Object.fromEntries(
    Object.entries(rawPayload).filter(([name]) => !String(name).startsWith("__"))
  );
}

function parse(rawPayload, company = {}) {
  if (rawPayload && Array.isArray(rawPayload.__legacyParsed)) return rawPayload.__legacyParsed;
  const target = discover(company);
  const config = rawPayload?.__sourceConfig || target?.config || {};
  const payload = stripInternalPayloadFields(rawPayload);
  const companyName = clean(company.company_name || company.companyName || company.name || config.tenant || atsKey);

  const postings = parser.parseIcimsPostingsFromHtml(
    companyName,
    config,
    payload?.html || payload
  );
  return postings.map((posting) => ({
    ...posting,
    source_evidence: {
      ...(posting.source_evidence || {}),
      list_url: rawPayload?.__sourceFetchFinalUrl || target?.list_url,
      route_kind: posting.source_evidence?.route_kind || "icims_public_iframe_list"
    }
  }));
}

module.exports = {
  ...baseModule,
  ...parser,
  atsKey,
  key: atsKey,
  family: SOURCE_FAMILIES.embeddedOrSemiStructured,
  status: SOURCE_STATUSES.enabled,
  parserVersion,
  discover,
  fetchList,
  parse
};
