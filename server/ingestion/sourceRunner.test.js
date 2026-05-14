const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getSafetyGate,
  parseArgs,
  runWithLimitedConcurrency,
  sourceHost
} = require("./sourceRunner");

test("source runner apply requires explicit production safety flags", () => {
  const dryRun = parseArgs(["--source=greenhouse", "--limit=5"]);
  assert.equal(dryRun.source, "greenhouse");
  assert.equal(dryRun.limit, 5);
  assert.equal(getSafetyGate(dryRun).authorized, false);

  const companyLimitAlias = parseArgs(["--source=icims", "--company-limit=7"]);
  assert.equal(companyLimitAlias.limit, 7);

  const offsetRun = parseArgs(["--source=hrmdirect", "--limit=1500", "--offset=1000"]);
  assert.equal(offsetRun.limit, 1000);
  assert.equal(offsetRun.offset, 1000);

  const missingMax = parseArgs(["--source=greenhouse", "--apply", "--confirm-production"]);
  const missingMaxGate = getSafetyGate(missingMax);
  assert.equal(missingMaxGate.authorized, false);
  assert.deepEqual(missingMaxGate.missing, ["--max-updates=N"]);

  const authorized = parseArgs([
    "--mode=apply",
    "--source=greenhouse",
    "--apply",
    "--confirm-production",
    "--max-updates=25"
  ]);
  const gate = getSafetyGate(authorized);
  assert.equal(gate.apply_requested, true);
  assert.equal(gate.authorized, true);
  assert.deepEqual(gate.missing, []);
});

test("source runner normalizes hosts for per-host concurrency", () => {
  assert.equal(sourceHost("https://jobs.example.com/path?a=1"), "jobs.example.com");
  assert.equal(sourceHost("not a url"), "");
});

test("source runner host concurrency serializes same host while allowing different hosts", async () => {
  const runningByHost = new Map();
  const peakByHost = new Map();
  const items = [
    { host: "a.example" },
    { host: "a.example" },
    { host: "b.example" }
  ];
  await runWithLimitedConcurrency(
    items,
    async (item) => {
      const running = Number(runningByHost.get(item.host) || 0) + 1;
      runningByHost.set(item.host, running);
      peakByHost.set(item.host, Math.max(Number(peakByHost.get(item.host) || 0), running));
      await new Promise((resolve) => setTimeout(resolve, 10));
      runningByHost.set(item.host, Number(runningByHost.get(item.host) || 0) - 1);
    },
    { concurrency: 3, hostConcurrency: 1 }
  );
  assert.equal(peakByHost.get("a.example"), 1);
  assert.equal(peakByHost.get("b.example"), 1);
});

console.log("source runner tests passed");
