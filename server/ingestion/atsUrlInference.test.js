const assert = require("assert");
const test = require("node:test");

const { inferAtsFromJobPostingUrl } = require("./atsUrlInference");

test("infers ATS keys from public posting URL shapes", () => {
  assert.equal(inferAtsFromJobPostingUrl("https://jobs.ashbyhq.com/example/abc"), "ashby");
  assert.equal(inferAtsFromJobPostingUrl("https://boards.greenhouse.io/example/jobs/123"), "greenhouse");
  assert.equal(inferAtsFromJobPostingUrl("https://example.myworkdayjobs.com/example/job/US/job"), "workday");
  assert.equal(inferAtsFromJobPostingUrl("https://example.com/not-an-ats"), "");
});
