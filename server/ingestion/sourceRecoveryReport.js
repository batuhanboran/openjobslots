const SOURCE_RECOVERY_REPORT_REQUIRED_FIELDS = Object.freeze([
  "source",
  "tenants_considered",
  "tenants_fetched",
  "rows_parsed",
  "accepted_public_rows_before",
  "accepted_public_rows_after",
  "public_row_gain",
  "rows_updated_existing",
  "rows_newly_accepted",
  "inventory_scan_report",
  "net_new_clean_public_estimate",
  "duplicate_existing_public_candidates",
  "candidate_pool_exhausted",
  "estimate_confidence",
  "bounded_outbox_or_upsert_status",
  "quarantined",
  "skipped_ambiguous",
  "missing_geo_before",
  "missing_geo_after",
  "weak_remote_before",
  "weak_remote_after",
  "no_improvement_reasons"
]);

const SOURCE_RECOVERY_REPORT_SCHEMA = Object.freeze({
  version: 1,
  required: SOURCE_RECOVERY_REPORT_REQUIRED_FIELDS,
  fields: Object.freeze({
    source: "ATS/source key being recovered.",
    tenants_considered: "Number or list of tenant/source targets evaluated.",
    tenants_fetched: "Number or list of tenant/source targets fetched.",
    rows_parsed: "Rows parsed from fetched source payloads.",
    accepted_public_rows_before: "Accepted public rows for the source before recovery.",
    accepted_public_rows_after: "Accepted public rows for the source after recovery.",
    public_row_gain: "accepted_public_rows_after - accepted_public_rows_before.",
    rows_updated_existing: "Existing public rows updated with better source evidence.",
    rows_newly_accepted: "Rows newly accepted into the public dataset.",
    inventory_scan_report: "Path, object, or summary proving the bounded read-only inventory scan used before writes.",
    net_new_clean_public_estimate: "Dedupe-aware estimate of clean public rows that can be newly accepted.",
    duplicate_existing_public_candidates: "Existing public duplicates excluded from the net-new estimate.",
    candidate_pool_exhausted: "Whether inventory coverage exhausted the candidate pool, or a bounded subset already proves the requested gain.",
    estimate_confidence: "Confidence label from inventory/net-new estimation.",
    bounded_outbox_or_upsert_status: "Bounded search outbox/upsert status for affected rows after canary/apply.",
    quarantined: "Rows written or kept in quarantine.",
    skipped_ambiguous: "Ambiguous rows skipped instead of failing the recovery task.",
    missing_geo_before: "Rows for the source missing normalized geo before recovery.",
    missing_geo_after: "Rows for the source missing normalized geo after recovery.",
    weak_remote_before: "Rows for the source with weak/unknown remote before recovery.",
    weak_remote_after: "Rows for the source with weak/unknown remote after recovery.",
    no_improvement_reasons: "Tenant/source/error grouped reasons when no production improvement is possible.",
    no_improvement_blocker_only: "Explicit marker that no production writes occurred and the report is blocker-only.",
    newly_accepted_row_evidence: "Row-by-row evidence for newly accepted rows, used for explicit remote/hybrid or useful geo exceptions.",
    planned_tenant_batch_file_path: "Path to the tenant batch plan used before canary/apply writes.",
    predicted_guard_result: "Guard prediction from the tenant batch plan before writes.",
    actual_guard_result: "Recovery guard result after canary/apply writes.",
    rollback_command: "Exact rollback command for the source run if guard fails."
  }),
  optional: Object.freeze([
    "rows_newly_accepted_no_geo_no_remote",
    "newly_accepted_no_geo_no_remote_count",
    "bad_newly_accepted_rows",
    "no_improvement_blocker_only",
    "newly_accepted_row_evidence",
    "accepted_row_evidence",
    "clean_row_evidence",
    "inventory_report",
    "net_new_clean_public_candidates",
    "net_new_clean_candidates",
    "duplicate_existing_public_rows",
    "duplicate_count",
    "search_upsert_status",
    "meili_upsert_status",
    "planned_tenant_batch_file_path",
    "predicted_guard_result",
    "actual_guard_result",
    "rollback_command",
    "generated_at",
    "run_id"
  ])
});

function cleanString(value) {
  return String(value ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function countOrLength(value) {
  if (Array.isArray(value)) return value.length;
  return toNumber(value, 0);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pickReportValue(report, field, aliases = []) {
  for (const key of [field, ...aliases]) {
    if (report[key] !== undefined) return report[key];
  }
  return undefined;
}

function inventoryScanReport(report = {}) {
  return pickReportValue(report, "inventory_scan_report", ["inventory_report"]);
}

function normalizeReference(value) {
  if (value === undefined) return undefined;
  if (typeof value === "string") return cleanString(value);
  if (isObject(value) || Array.isArray(value)) return value;
  return value;
}

function inventoryField(report = {}, field) {
  const inventory = inventoryScanReport(report);
  if (isObject(inventory) && inventory[field] !== undefined) return inventory[field];
  return undefined;
}

function hasReportField(report = {}, field) {
  const aliases = {
    inventory_scan_report: ["inventory_report"],
    net_new_clean_public_estimate: ["net_new_clean_public_candidates", "net_new_clean_candidates"],
    duplicate_existing_public_candidates: ["duplicate_existing_public_rows", "duplicate_count"],
    bounded_outbox_or_upsert_status: ["search_upsert_status", "meili_upsert_status"]
  };
  if (pickReportValue(report, field, aliases[field] || []) !== undefined) return true;
  if (["candidate_pool_exhausted", "estimate_confidence"].includes(field)) {
    return inventoryField(report, field) !== undefined;
  }
  return false;
}

function normalizeReasonItem(item = {}) {
  if (typeof item === "string") {
    return {
      tenant: "unknown",
      source: "unknown",
      error: item,
      reason: item,
      count: 1
    };
  }
  const tenant = cleanString(item.tenant || item.tenant_key || item.company || item.company_name || "unknown") || "unknown";
  const source = cleanString(item.source || item.source_url || item.ats_key || "unknown") || "unknown";
  const error = cleanString(item.error || item.reason || item.code || item.message || "unknown") || "unknown";
  return {
    tenant,
    source,
    error,
    reason: cleanString(item.reason || item.message || error) || error,
    count: Math.max(1, toNumber(item.count, 1))
  };
}

function groupReasons(items = []) {
  const byTenant = {};
  const bySource = {};
  const byError = {};
  for (const item of items.map(normalizeReasonItem)) {
    byTenant[item.tenant] = (byTenant[item.tenant] || 0) + item.count;
    bySource[item.source] = (bySource[item.source] || 0) + item.count;
    byError[item.error] = (byError[item.error] || 0) + item.count;
  }
  return {
    items: items.map(normalizeReasonItem),
    by_tenant: byTenant,
    by_source: bySource,
    by_error: byError
  };
}

function normalizeNoImprovementReasons(value) {
  if (!value) return groupReasons([]);
  if (Array.isArray(value)) return groupReasons(value);
  if (Array.isArray(value.items)) {
    const grouped = groupReasons(value.items);
    return {
      items: grouped.items,
      by_tenant: value.by_tenant || grouped.by_tenant,
      by_source: value.by_source || grouped.by_source,
      by_error: value.by_error || grouped.by_error
    };
  }
  const items = [];
  for (const [error, count] of Object.entries(value.by_error || {})) {
    items.push({ tenant: "unknown", source: "unknown", error, count });
  }
  if (items.length === 0) {
    for (const [tenant, count] of Object.entries(value.by_tenant || {})) {
      items.push({ tenant, source: "unknown", error: "no_improvement", count });
    }
  }
  return {
    items: groupReasons(items).items,
    by_tenant: value.by_tenant || {},
    by_source: value.by_source || {},
    by_error: value.by_error || {}
  };
}

function normalizeSourceRecoveryReport(report = {}) {
  const acceptedBefore = toNumber(report.accepted_public_rows_before);
  const acceptedAfter = toNumber(report.accepted_public_rows_after);
  const normalized = {
    source: cleanString(report.source || report.ats_key),
    tenants_considered: countOrLength(report.tenants_considered),
    tenants_fetched: countOrLength(report.tenants_fetched),
    rows_parsed: toNumber(report.rows_parsed),
    accepted_public_rows_before: acceptedBefore,
    accepted_public_rows_after: acceptedAfter,
    public_row_gain: toNumber(report.public_row_gain, acceptedAfter - acceptedBefore),
    rows_updated_existing: toNumber(report.rows_updated_existing),
    rows_newly_accepted: toNumber(report.rows_newly_accepted),
    inventory_scan_report: normalizeReference(inventoryScanReport(report)),
    net_new_clean_public_estimate: toNumber(pickReportValue(report, "net_new_clean_public_estimate", [
      "net_new_clean_public_candidates",
      "net_new_clean_candidates"
    ])),
    duplicate_existing_public_candidates: countOrLength(pickReportValue(report, "duplicate_existing_public_candidates", [
      "duplicate_existing_public_rows",
      "duplicate_count"
    ])),
    candidate_pool_exhausted: pickReportValue(report, "candidate_pool_exhausted") === true || inventoryField(report, "candidate_pool_exhausted") === true,
    estimate_confidence: cleanString(pickReportValue(report, "estimate_confidence") ?? inventoryField(report, "estimate_confidence")),
    bounded_outbox_or_upsert_status: normalizeReference(pickReportValue(report, "bounded_outbox_or_upsert_status", [
      "search_upsert_status",
      "meili_upsert_status"
    ])),
    quarantined: toNumber(report.quarantined),
    skipped_ambiguous: toNumber(report.skipped_ambiguous),
    missing_geo_before: toNumber(report.missing_geo_before),
    missing_geo_after: toNumber(report.missing_geo_after),
    weak_remote_before: toNumber(report.weak_remote_before),
    weak_remote_after: toNumber(report.weak_remote_after),
    no_improvement_reasons: normalizeNoImprovementReasons(report.no_improvement_reasons),
    no_improvement_blocker_only: report.no_improvement_blocker_only === true
  };
  for (const field of ["newly_accepted_row_evidence", "accepted_row_evidence", "clean_row_evidence"]) {
    if (Array.isArray(report[field])) normalized[field] = report[field];
  }
  for (const field of ["planned_tenant_batch_file_path", "predicted_guard_result", "actual_guard_result", "rollback_command"]) {
    if (report[field] !== undefined) normalized[field] = cleanString(report[field]);
  }
  const badRows = report.bad_newly_accepted_rows || report.newly_accepted_bad_rows || [];
  normalized.rows_newly_accepted_no_geo_no_remote = Math.max(
    0,
    toNumber(
      report.rows_newly_accepted_no_geo_no_remote ?? report.newly_accepted_no_geo_no_remote_count,
      Array.isArray(badRows)
        ? badRows.filter((row) => {
            const flags = Array.isArray(row?.quality_flags) ? row.quality_flags : [];
            return flags.includes("no_geo_no_remote") || cleanString(row?.reason || row?.validation_error) === "no_geo_no_remote";
          }).length
        : 0
    )
  );
  return normalized;
}

function validateSourceRecoveryReport(report = {}) {
  const normalized = normalizeSourceRecoveryReport(report);
  const errors = [];
  for (const field of SOURCE_RECOVERY_REPORT_REQUIRED_FIELDS) {
    if (!hasReportField(report, field) && field !== "public_row_gain") {
      errors.push(`missing required source recovery report field: ${field}`);
    }
  }
  if (!normalized.source) errors.push("source recovery report requires source");
  if (normalized.public_row_gain !== normalized.accepted_public_rows_after - normalized.accepted_public_rows_before) {
    errors.push("public_row_gain must equal accepted_public_rows_after - accepted_public_rows_before");
  }
  if (normalized.rows_newly_accepted_no_geo_no_remote > 0) {
    errors.push("newly accepted public rows include no_geo_no_remote rows");
  }
  if (normalized.net_new_clean_public_estimate < 0) {
    errors.push("net_new_clean_public_estimate cannot be negative");
  }
  if (normalized.duplicate_existing_public_candidates < 0) {
    errors.push("duplicate_existing_public_candidates cannot be negative");
  }
  return {
    ok: errors.length === 0,
    errors,
    report: normalized,
    schema: SOURCE_RECOVERY_REPORT_SCHEMA
  };
}

module.exports = {
  SOURCE_RECOVERY_REPORT_SCHEMA,
  normalizeNoImprovementReasons,
  normalizeSourceRecoveryReport,
  validateSourceRecoveryReport
};
