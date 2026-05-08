const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MEILI_POSTINGS_SETTINGS,
  expandSearchTokens,
  getCountryFilterTerms,
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
