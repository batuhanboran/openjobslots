const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compareAdaptiveDueTargetCandidates,
  decideAdaptiveSourceSelection,
  summarizeAdaptiveSourceSignals
} = require("./adaptiveSourceSelection");

function normalPolicy(overrides = {}) {
  return {
    mode: "normal",
    maxTargetsPerRun: Infinity,
    ...overrides
  };
}

test("adaptive source signals classify recent parser, network, and quality evidence", () => {
  const signals = summarizeAdaptiveSourceSignals({
    dueRows: [
      { ats_key: "bamboohr", due_count: 120 },
      { ats_key: "legacyats", due_count: 90 }
    ],
    syncRows: [
      { ats_key: "bamboohr", recent_success_count: 18, recent_failure_count: 2 },
      { ats_key: "legacyats", recent_success_count: 1, recent_failure_count: 9 }
    ],
    errorRows: [
      { ats_key: "legacyats", error_type: "parser_drift", error_message: "payload shape similarity low", count: 3 },
      { ats_key: "legacyats", error_type: "network", error_message: "getaddrinfo EAI_AGAIN", count: 5 },
      { ats_key: "bamboohr", error_type: "parser_validation", error_message: "no_geo_no_remote", count: 1 }
    ]
  });

  assert.equal(signals.bamboohr.due_count, 120);
  assert.equal(signals.bamboohr.success_rate_pct, 90);
  assert.equal(signals.bamboohr.failure_reason_counts.source_quality, 1);
  assert.equal(signals.legacyats.failure_reason_counts.parser_bug, 3);
  assert.equal(signals.legacyats.failure_reason_counts.network, 5);
});

test("adaptive source decisions cap risky sources while allowing healthy backlog to scale", () => {
  const healthy = decideAdaptiveSourceSelection("bamboohr", {
    targetLimit: 100,
    sourcePolicy: normalPolicy(),
    signal: {
      due_count: 500,
      recent_success_count: 25,
      recent_failure_count: 1,
      success_rate_pct: 96,
      failure_reason_counts: {}
    }
  });
  const networkRisk = decideAdaptiveSourceSelection("legacyats", {
    targetLimit: 100,
    sourcePolicy: normalPolicy(),
    signal: {
      due_count: 500,
      recent_success_count: 2,
      recent_failure_count: 18,
      success_rate_pct: 10,
      failure_reason_counts: { network: 18 }
    }
  });
  const parserRisk = decideAdaptiveSourceSelection("parserats", {
    targetLimit: 100,
    sourcePolicy: normalPolicy(),
    signal: {
      due_count: 200,
      recent_success_count: 0,
      recent_failure_count: 8,
      success_rate_pct: 0,
      failure_reason_counts: { parser_bug: 8 }
    }
  });
  const canary = decideAdaptiveSourceSelection("canaryats", {
    targetLimit: 100,
    sourcePolicy: normalPolicy({ mode: "canary", maxTargetsPerRun: 5 }),
    signal: {
      due_count: 200,
      recent_success_count: 10,
      recent_failure_count: 0,
      success_rate_pct: 100,
      failure_reason_counts: {}
    }
  });

  assert.ok(healthy.maxTargetsPerRun > networkRisk.maxTargetsPerRun);
  assert.ok(networkRisk.maxTargetsPerRun > parserRisk.maxTargetsPerRun);
  assert.equal(parserRisk.lane, "parser_attention");
  assert.equal(canary.maxTargetsPerRun, 5);
  assert.ok(networkRisk.reasons.includes("network"));
  assert.ok(healthy.reasons.includes("due_backlog"));
});

test("adaptive due target sort prefers healthy backlog before risky sources", () => {
  const decisions = {
    healthy: decideAdaptiveSourceSelection("healthy", {
      targetLimit: 50,
      sourcePolicy: normalPolicy(),
      signal: { due_count: 300, recent_success_count: 20, recent_failure_count: 0, success_rate_pct: 100 }
    }),
    network: decideAdaptiveSourceSelection("network", {
      targetLimit: 50,
      sourcePolicy: normalPolicy(),
      signal: {
        due_count: 300,
        recent_success_count: 1,
        recent_failure_count: 12,
        success_rate_pct: 7.69,
        failure_reason_counts: { network: 12 }
      }
    }),
    small: decideAdaptiveSourceSelection("small", {
      targetLimit: 50,
      sourcePolicy: normalPolicy(),
      signal: { due_count: 10, recent_success_count: 10, recent_failure_count: 0, success_rate_pct: 100 }
    })
  };

  const rows = [
    { ats_key: "network", company_name: "Network Risk", ats_rank: 1, protection_status: "normal", next_sync_epoch: 1 },
    { ats_key: "small", company_name: "Small Healthy", ats_rank: 1, protection_status: "normal", next_sync_epoch: 1 },
    { ats_key: "healthy", company_name: "Healthy Backlog", ats_rank: 1, protection_status: "normal", next_sync_epoch: 1 }
  ];

  const sorted = [...rows].sort((left, right) => compareAdaptiveDueTargetCandidates(left, right, decisions));

  assert.deepEqual(sorted.map((row) => row.ats_key), ["healthy", "small", "network"]);
});
