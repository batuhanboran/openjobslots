"use strict";

const { asUrl, buildCompanyContext, clean } = require("./helpers");

function parseApplicantProCompany(urlString) {
  const parsed = asUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".applicantpro.com")) return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    origin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: `${parsed.protocol}//${parsed.host}/jobs/`
  };
}

function createDiscover(parserVersion) {
  return function discover(company = {}) {
    const context = buildCompanyContext(company);
    const route = parseApplicantProCompany(context.url_string);
    return {
      ats_key: "applicantpro",
      source_family: "embedded_json",
      docs_url: "observed ApplicantPro public jobs page domain_id and core jobs JSON endpoint",
      company: context,
      list_url: clean(route?.jobsUrl),
      config: route || {},
      parser_version: parserVersion
    };
  };
}

module.exports = {
  createDiscover,
  parseApplicantProCompany
};
