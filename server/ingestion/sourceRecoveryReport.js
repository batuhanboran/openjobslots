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
    quarantined: "Rows written or kept in quarantine.",
    skipped_ambiguous: "Ambiguous rows skipped instead of failing the recovery task.",
    missing_geo_before: "Rows for the source missing normalized geo before recovery.",
    missing_geo_after: "Rows for the source missing normalized geo after recovery.",
    weak_remote_before: "Rows for the source with weak/unknown remote before recovery.",
    weak_remote_after: "Rows for the source with weak/unknown remote after recovery.",
    no_improvement_reasons: "Tenant/source/error grouped reasons when no production improvement is possible."
  }),
  optional: Object.freeze([
    "rows_newly_accepted_no_geo_no_remote",
    "newly_accepted_no_geo_no_remote_count",
    "bad_newly_accepted_rows",
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
    quarantined: toNumber(report.quarantined),
    skipped_ambiguous: toNumber(report.skipped_ambiguous),
    missing_geo_before: toNumber(report.missing_geo_before),
    missing_geo_after: toNumber(report.missing_geo_after),
    weak_remote_before: toNumber(report.weak_remote_before),
    weak_remote_after: toNumber(report.weak_remote_after),
    no_improvement_reasons: normalizeNoImprovementReasons(report.no_improvement_reasons)
  };
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
    if (!(field in report) && field !== "public_row_gain") {
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
