const assert = require("assert");

const {
  parseAshbyCompany,
  parseCompanySourceConfig
} = require("./sourceDiscovery");

function testDirectCompanyParsers() {
  assert.deepEqual(parseAshbyCompany("https://jobs.ashbyhq.com/example"), {
    organizationHostedJobsPageName: "example",
    organizationHostedJobsPageNameLower: "example"
  });

}

function testDispatchParser() {
  assert.equal(parseCompanySourceConfig("ashby", "https://jobs.ashbyhq.com/example").organizationHostedJobsPageName, "example");
  assert.equal(parseCompanySourceConfig("gem", "https://jobs.gem.com/fixture"), null);
  assert.equal(parseCompanySourceConfig("oracle", "https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs"), null);
  assert.equal(parseCompanySourceConfig("unknown", "https://example.com"), null);
}

testDirectCompanyParsers();
testDispatchParser();

console.log("source discovery tests passed");
