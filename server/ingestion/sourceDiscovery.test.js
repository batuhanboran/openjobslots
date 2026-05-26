const assert = require("assert");

const {
  parseAshbyCompany,
  parseCompanySourceConfig,
  parseGreenhouseCompany,
  parseOracleCompany,
  parseTalentreefCompany
} = require("./sourceDiscovery");

function testDirectCompanyParsers() {
  assert.deepEqual(parseAshbyCompany("https://jobs.ashbyhq.com/example"), {
    organizationHostedJobsPageName: "example",
    organizationHostedJobsPageNameLower: "example"
  });

  assert.deepEqual(parseGreenhouseCompany("https://job-boards.greenhouse.io/example"), {
    boardToken: "example",
    boardTokenLower: "example"
  });

  const talentreef = parseTalentreefCompany("https://apply.jobappnetwork.com/example");
  assert.equal(talentreef.companyName, "example");
  assert.equal(talentreef.searchApiUrl, "https://prod-kong.internal.talentreef.com/apply/proxy-es/search-en-us/posting/_search");
}

function testOracleAndDispatchParser() {
  const oracle = parseOracleCompany("https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs");
  assert.equal(oracle.siteNumber, "CX");
  assert.equal(oracle.language, "en");
  assert.ok(oracle.finder.includes("POSTING_DATES_DESC"));

  assert.equal(parseCompanySourceConfig("ashby", "https://jobs.ashbyhq.com/example").organizationHostedJobsPageName, "example");
  assert.equal(parseCompanySourceConfig("greenhouse", "https://boards.greenhouse.io/example").boardToken, "example");
  assert.equal(parseCompanySourceConfig("gem", "https://jobs.gem.com/fixture"), null);
  assert.equal(parseCompanySourceConfig("unknown", "https://example.com"), null);
}

testDirectCompanyParsers();
testOracleAndDispatchParser();

console.log("source discovery tests passed");
