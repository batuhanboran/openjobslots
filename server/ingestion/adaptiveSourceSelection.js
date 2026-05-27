const {
  addFailureReasonCount,
  classifyFailureReason,
  createFailureReasonCounts
} = require("./workerFailureTaxonomy");

const ADAPTIVE_LANES = Object.freeze({
  healthy: 0,
  canary: 1,
  stability: 2,
  source_quality: 3,
  parser_attention: 4,
  disabled: 99
});

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAtsKey(value) {
  return String(value || "").trim().toLowerCase();
}

function ensureSignal(signals, atsKey) {
  const key = normalizeAtsKey(atsKey);
  if (!key) return null;
  if (!signals[key]) {
    signals[key] = {
      ats_key: key,
      due_count: 0,
      recent_success_count: 0,
      recent_failure_count: 0,
      recent_attempt_count: 0,
      success_rate_pct: null,
      failure_rate_pct: null,
      failure_reason_counts: createFailureReasonCounts()
    };
  }
  return signals[key];
}

function finalizeSignal(signal) {
  const successCount = asNumber(signal.recent_success_count, 0);
  const failureCount = asNumber(signal.recent_failure_count, 0);
  const attemptCount = asNumber(signal.recent_attempt_count, successCount + failureCount) || successCount + failureCount;
  signal.recent_attempt_count = attemptCount;
  signal.success_rate_pct = attemptCount > 0
    ? Number(((successCount / attemptCount) * 100).toFixed(2))
    : null;
  signal.failure_rate_pct = attemptCount > 0
    ? Number(((failureCount / attemptCount) * 100).toFixed(2))
    : null;
  return signal;
}

function summarizeAdaptiveSourceSignals({ dueRows = [], syncRows = [], errorRows = [] } = {}) {
  const signals = {};
  for (const row of Array.isArray(dueRows) ? dueRows : []) {
    const signal = ensureSignal(signals, row?.ats_key || row?.atsKey);
    if (!signal) continue;
    signal.due_count = Math.max(signal.due_count, asNumber(row?.due_count ?? row?.count ?? row?.due, 0));
  }
  for (const row of Array.isArray(syncRows) ? syncRows : []) {
    const signal = ensureSignal(signals, row?.ats_key || row?.atsKey);
    if (!signal) continue;
    signal.recent_success_count += asNumber(row?.recent_success_count ?? row?.success_count, 0);
    signal.recent_failure_count += asNumber(row?.recent_failure_count ?? row?.failure_count, 0);
    signal.recent_attempt_count += asNumber(row?.recent_attempt_count ?? row?.attempt_count, 0);
  }
  for (const row of Array.isArray(errorRows) ? errorRows : []) {
    const signal = ensureSignal(signals, row?.ats_key || row?.atsKey);
    if (!signal) continue;
    const count = Math.max(0, asNumber(row?.count, 0));
    if (count <= 0) continue;
    const reason = classifyFailureReason(row?.error_type, row?.http_status, row?.error_message);
    addFailureReasonCount(signal.failure_reason_counts, reason, count);
  }
  for (const key of Object.keys(signals)) finalizeSignal(signals[key]);
  return signals;
}

function boundedCap(value, policyCap, targetLimit, dueCount) {
  const hardCap = Number.isFinite(policyCap) ? Math.max(0, Math.floor(policyCap)) : Infinity;
  const targetCap = Math.max(0, Math.floor(asNumber(targetLimit, 1)));
  const dueCap = Math.max(0, Math.floor(asNumber(dueCount, targetCap)));
  return Math.max(0, Math.min(hardCap, targetCap, dueCap, Math.max(0, Math.floor(value))));
}

function capForLane(lane, targetLimit, policyCap, dueCount) {
  const limit = Math.max(1, Math.floor(asNumber(targetLimit, 1)));
  if (lane === "disabled") return 0;
  if (lane === "parser_attention") return boundedCap(Math.max(1, Math.ceil(limit * 0.02)), policyCap, limit, dueCount);
  if (lane === "source_quality") return boundedCap(Math.max(2, Math.ceil(limit * 0.04)), policyCap, limit, dueCount);
  if (lane === "stability") return boundedCap(Math.max(2, Math.ceil(limit * 0.06)), policyCap, limit, dueCount);
  if (lane === "canary") return boundedCap(Math.max(1, Math.ceil(limit * 0.05)), policyCap, limit, dueCount);
  return boundedCap(Math.max(5, Math.ceil(limit * 0.3)), policyCap, limit, dueCount);
}

function decideAdaptiveSourceSelection(atsKey, {
  targetLimit = 1,
  sourcePolicy = {},
  signal = {}
} = {}) {
  const key = normalizeAtsKey(atsKey);
  const mode = String(sourcePolicy?.mode || "normal").trim().toLowerCase();
  const policyCap = sourcePolicy?.maxTargetsPerRun;
  const dueCount = Math.max(0, asNumber(signal?.due_count, 0));
  const counts = {
    ...createFailureReasonCounts(),
    ...(signal?.failure_reason_counts || {})
  };
  const successRate = signal?.success_rate_pct == null ? null : asNumber(signal.success_rate_pct, null);
  const attempts = Math.max(0, asNumber(
    signal?.recent_attempt_count,
    asNumber(signal?.recent_success_count, 0) + asNumber(signal?.recent_failure_count, 0)
  ));
  const reasons = [];
  let lane = "healthy";

  if (mode === "disabled") {
    lane = "disabled";
    reasons.push("source_policy_disabled");
  } else if (asNumber(counts.parser_bug, 0) >= 2) {
    lane = "parser_attention";
    reasons.push("parser_attention");
  } else if (asNumber(counts.network, 0) + asNumber(counts.rate_limit, 0) + asNumber(counts.auth, 0) >= 3) {
    lane = "stability";
    if (asNumber(counts.network, 0) > 0) reasons.push("network");
    if (asNumber(counts.rate_limit, 0) > 0) reasons.push("rate_limit");
    if (asNumber(counts.auth, 0) > 0) reasons.push("auth");
  } else if (attempts >= 3 && successRate != null && successRate < 60) {
    lane = "stability";
    reasons.push("low_success_rate");
  } else if (asNumber(counts.source_quality, 0) >= 5) {
    lane = "source_quality";
    reasons.push("source_quality");
  } else if (mode === "canary" || mode === "quarantine_only") {
    lane = "canary";
    reasons.push(mode === "quarantine_only" ? "quarantine_only" : "canary_only");
  }

  if (dueCount > 0) reasons.push("due_backlog");
  if (attempts > 0 && successRate != null && successRate >= 80 && lane === "healthy") {
    reasons.push("healthy_success_rate");
  }

  const maxTargetsPerRun = capForLane(lane, targetLimit, policyCap, dueCount || targetLimit);
  return {
    ats_key: key,
    lane,
    laneRank: ADAPTIVE_LANES[lane] ?? ADAPTIVE_LANES.disabled,
    maxTargetsPerRun,
    success_rate_pct: successRate,
    recent_attempt_count: attempts,
    due_count: dueCount,
    failure_reason_counts: counts,
    reasons
  };
}

function decisionFor(decisions, atsKey) {
  const key = normalizeAtsKey(atsKey);
  if (!decisions) return null;
  if (decisions instanceof Map) return decisions.get(key) || null;
  return decisions[key] || null;
}

function protectionPriority(status) {
  const normalized = String(status || "normal").trim().toLowerCase() || "normal";
  if (normalized === "normal" || normalized === "public_enabled") return 0;
  if (normalized === "canary_only") return 1;
  if (normalized === "quarantine_only") return 2;
  return 3;
}

function compareAdaptiveDueTargetCandidates(left, right, decisions = {}) {
  const protectionDelta = protectionPriority(left?.protection_status) - protectionPriority(right?.protection_status);
  if (protectionDelta) return protectionDelta;

  const leftDecision = decisionFor(decisions, left?.ats_key) || {};
  const rightDecision = decisionFor(decisions, right?.ats_key) || {};
  const laneDelta = asNumber(leftDecision.laneRank, ADAPTIVE_LANES.healthy) -
    asNumber(rightDecision.laneRank, ADAPTIVE_LANES.healthy);
  if (laneDelta) return laneDelta;

  const leftRank = asNumber(left?.ats_rank, 0);
  const rightRank = asNumber(right?.ats_rank, 0);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const backlogDelta = asNumber(rightDecision.due_count, 0) - asNumber(leftDecision.due_count, 0);
  if (backlogDelta) return backlogDelta;

  const failurePressureDelta = asNumber(left?.consecutive_failures, 0) > 0
    ? asNumber(right?.consecutive_failures, 0) > 0 ? 0 : 1
    : asNumber(right?.consecutive_failures, 0) > 0 ? -1 : 0;
  if (failurePressureDelta) return failurePressureDelta;

  const nextDelta = asNumber(left?.next_sync_epoch, 0) - asNumber(right?.next_sync_epoch, 0);
  if (nextDelta) return nextDelta;
  return String(left?.ats_key || "").localeCompare(String(right?.ats_key || "")) ||
    String(left?.company_name || "").localeCompare(String(right?.company_name || ""));
}

function sortAdaptiveDueTargetCandidates(rows = [], decisions = {}) {
  return [...rows].sort((left, right) => compareAdaptiveDueTargetCandidates(left, right, decisions));
}

module.exports = {
  ADAPTIVE_LANES,
  compareAdaptiveDueTargetCandidates,
  decideAdaptiveSourceSelection,
  sortAdaptiveDueTargetCandidates,
  summarizeAdaptiveSourceSignals
};
