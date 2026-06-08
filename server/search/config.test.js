const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MEILI_POSTINGS_SETTINGS,
  expandSearchTokens,
  getCountryFilterTerms,
  normalizeAtsKey,
  normalizeCountryFilterValue,
  normalizeSearchQuery
} = require("./config");

test("search config strips generic job words without losing intent", () => {
  assert.equal(normalizeSearchQuery("remote jobs"), "remote");
  assert.equal(normalizeSearchQuery("software engineer openings"), "software engineer");
  assert.equal(normalizeSearchQuery("jobs"), "jobs");
});

test("search config normalizes Turkey aliases and common typos", () => {
  assert.equal(normalizeCountryFilterValue("turkyie"), "Turkey");
  assert.equal(normalizeCountryFilterValue("turksih"), "Turkey");
  assert.equal(normalizeCountryFilterValue("t\u00fcrkiye"), "Turkey");
  assert.equal(normalizeSearchQuery("turkyie jobs"), "turkey");
  assert.equal(normalizeSearchQuery("turksih jobs"), "turkish");
  assert.ok(getCountryFilterTerms("Turkey").includes("istanbul"));
});

test("expanded search tokens include useful alias groups", () => {
  const turkeyGroups = expandSearchTokens("turkish jobs");
  assert.equal(turkeyGroups.length, 1);
  assert.ok(turkeyGroups[0].includes("turkey"));
  assert.ok(turkeyGroups[0].includes("turkiye"));

  const remoteGroups = expandSearchTokens("work from home jobs");
  assert.equal(remoteGroups.length, 1);
  assert.ok(remoteGroups[0].includes("remote"));
});

test("search config maps localized SEO search phrases to indexed search intent", () => {
  assert.equal(normalizeSearchQuery("empleos software engineer"), "software engineer");
  assert.equal(normalizeSearchQuery("emplois software engineer"), "software engineer");
  assert.equal(normalizeSearchQuery("trabajos remotos"), "remote");
  assert.equal(normalizeSearchQuery("offres emploi remote"), "remote");
  assert.equal(normalizeSearchQuery("ofertas empleo"), "job openings");
  assert.equal(normalizeSearchQuery("stellenangebote"), "job openings");
  assert.equal(normalizeSearchQuery("i\u015f ilanlar\u0131"), "job openings");
  assert.equal(normalizeSearchQuery("yaz\u0131l\u0131m m\u00fchendisi i\u015f ilanlar\u0131"), "software engineer");
  assert.equal(normalizeSearchQuery("teknik destek m\u00fchendisi i\u015f ilanlar\u0131"), "technical support engineer");
});

test("search config keeps ADP ATS keys canonical for indexed rows", () => {
  assert.equal(normalizeAtsKey("adp_myjobs"), "adp_myjobs");
  assert.equal(normalizeAtsKey("adpmyjobs"), "adp_myjobs");
  assert.equal(normalizeAtsKey("adp_workforcenow"), "adp_workforcenow");
  assert.equal(normalizeAtsKey("adpworkforcenow"), "adp_workforcenow");
});

test("Meili settings keep title/company ahead of description and include filters", () => {
  const attrs = MEILI_POSTINGS_SETTINGS.searchableAttributes;
  assert.ok(attrs.indexOf("title") < attrs.indexOf("company"));
  assert.ok(attrs.indexOf("company") < attrs.indexOf("description_plain"));
  assert.ok(MEILI_POSTINGS_SETTINGS.filterableAttributes.includes("country"));
  assert.ok(MEILI_POSTINGS_SETTINGS.filterableAttributes.includes("city"));
  assert.ok(MEILI_POSTINGS_SETTINGS.filterableAttributes.includes("remote_type"));
  assert.ok(MEILI_POSTINGS_SETTINGS.stopWords.includes("jobs"));
  assert.deepEqual(MEILI_POSTINGS_SETTINGS.typoTolerance.minWordSizeForTypos, {
    oneTypo: 4,
    twoTypos: 8
  });
});

test("parseSemanticQuery extracts country and remote filters", () => {
  const { parseSemanticQuery, preprocessSearchOptions } = require("./config");

  const res1 = parseSemanticQuery("Technical support engineer in turkey");
  assert.equal(res1.cleanedSearch, "Technical support engineer");
  assert.deepEqual(res1.countries, ["Turkey"]);

  const res2 = parseSemanticQuery("remote project manager");
  assert.equal(res2.cleanedSearch, "project manager");
  assert.equal(res2.remote, "remote");

  const res3 = parseSemanticQuery("hybrid software engineer in usa");
  assert.equal(res3.cleanedSearch, "software engineer");
  assert.deepEqual(res3.countries, ["United States"]);
  assert.equal(res3.remote, "hybrid");

  const res4 = parseSemanticQuery("lead us designer");
  assert.equal(res4.cleanedSearch, "lead us designer");
  assert.deepEqual(res4.countries, []);
  assert.equal(res4.remote, null);

  const res5 = parseSemanticQuery("remtoe software engineer in de");
  assert.equal(res5.cleanedSearch, "software engineer");
  assert.deepEqual(res5.countries, ["Germany"]);
  assert.equal(res5.remote, "remote");

  const res6 = parseSemanticQuery("rmeoe product manager in spain");
  assert.equal(res6.cleanedSearch, "product manager");
  assert.deepEqual(res6.countries, ["Spain"]);
  assert.equal(res6.remote, "remote");

  const res7 = parseSemanticQuery("hybrd data analyst in canada");
  assert.equal(res7.cleanedSearch, "data analyst");
  assert.deepEqual(res7.countries, ["Canada"]);
  assert.equal(res7.remote, "hybrid");

  const res8 = parseSemanticQuery("onsit DevOps in singapore");
  assert.equal(res8.cleanedSearch, "DevOps");
  assert.deepEqual(res8.countries, ["Singapore"]);
  assert.equal(res8.remote, "onsite");

  const res9 = parseSemanticQuery("hybird Engineering Manager at united kingdom");
  assert.equal(res9.cleanedSearch, "Engineering Manager");
  assert.deepEqual(res9.countries, ["United Kingdom"]);
  assert.equal(res9.remote, "hybrid");

  const res10 = parseSemanticQuery("Software Engineer from germany");
  assert.equal(res10.cleanedSearch, "Software Engineer");
  assert.deepEqual(res10.countries, ["Germany"]);
  assert.equal(res10.remote, null);

  const options = preprocessSearchOptions({
    search: "Technical support engineer in turkey",
    countries: "Germany",
    remote: "all"
  });
  assert.equal(options.search, "Technical support engineer");
  assert.deepEqual(options.countries, ["Germany", "Turkey"]);
  assert.equal(options.remote, "all");
});
