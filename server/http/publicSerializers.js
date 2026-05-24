function createPublicSerializers(dependencies = {}) {
  const {
    atsFilterLabelByValue = new Map(),
    inferAtsFromJobPostingUrl = () => "",
    normalizeAtsFilterValue = (value) => String(value || "").trim().toLowerCase(),
    nowEpochSeconds = () => Math.floor(Date.now() / 1000),
    sanitizeFrontendText = (value, fallback = "") => String(value || fallback || ""),
    sourceFacetFreshDays = 3,
    sourceFacetLimit = 8
  } = dependencies;

  function sanitizePublicPostingItem(posting) {
    return {
      id: Number(posting?.id || 0),
      company_name: String(posting?.company_name || ""),
      position_name: String(posting?.position_name || ""),
      job_posting_url: String(posting?.job_posting_url || ""),
      location: posting?.location || null,
      posting_date: posting?.posting_date || null,
      last_seen_epoch: Number(posting?.last_seen_epoch || 0),
      ats: String(posting?.ats || "")
    };
  }

  function sanitizePublicPostings(items) {
    return (Array.isArray(items) ? items : []).map(sanitizePublicPostingItem);
  }

  function roundPublicMetric(value, digits = 2) {
    const numberValue = Number(value || 0);
    if (!Number.isFinite(numberValue)) return 0;
    const factor = 10 ** digits;
    return Math.round(numberValue * factor) / factor;
  }

  function getPublicSourceLabel(value) {
    const normalized = normalizeAtsFilterValue(value);
    if (!normalized || normalized === "unknown") return "Unknown source";
    return atsFilterLabelByValue.get(normalized) || normalized;
  }

  function sanitizePublicSourceFacetItem(item) {
    const value = normalizeAtsFilterValue(item?.value || item?.ats || item?.source || "");
    const count = Math.max(0, Number(item?.count || 0));
    const freshCount = Math.max(0, Math.min(count, Number(item?.fresh_count || 0)));
    const freshPercentage = Number.isFinite(Number(item?.fresh_percentage))
      ? Math.max(0, Math.min(100, Math.round(Number(item.fresh_percentage))))
      : count > 0
        ? Math.round((freshCount / count) * 100)
        : 0;

    return {
      value: value || "unknown",
      label: sanitizeFrontendText(item?.label || getPublicSourceLabel(value), "Unknown source"),
      count,
      avg_confidence: roundPublicMetric(item?.avg_confidence, 2),
      avg_quality: roundPublicMetric(item?.avg_quality, 1),
      latest_seen_epoch: Math.max(0, Number(item?.latest_seen_epoch || 0)),
      fresh_count: freshCount,
      fresh_percentage: freshPercentage
    };
  }

  function sanitizePublicSourceFacets(items) {
    return (Array.isArray(items) ? items : [])
      .map(sanitizePublicSourceFacetItem)
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, sourceFacetLimit);
  }

  function buildPublicSourceFacets(rows, limit = sourceFacetLimit) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const freshCutoffEpoch = nowEpochSeconds() - sourceFacetFreshDays * 24 * 60 * 60;
    const bySource = new Map();

    for (const row of sourceRows) {
      const jobPostingUrl = String(row?.job_posting_url || row?.canonical_url || "").trim();
      const value = normalizeAtsFilterValue(row?.ats || row?.ats_key || inferAtsFromJobPostingUrl(jobPostingUrl)) || "unknown";
      const existing = bySource.get(value) || {
        value,
        label: getPublicSourceLabel(value),
        count: 0,
        confidenceSum: 0,
        qualitySum: 0,
        latest_seen_epoch: 0,
        fresh_count: 0
      };
      existing.count += 1;
      existing.confidenceSum += Math.max(0, Number(row?.confidence ?? row?.confidence_score ?? 0) || 0);
      existing.qualitySum += Math.max(0, Number(row?.quality_score ?? row?.quality ?? 0) || 0);
      const lastSeenEpoch = Math.max(0, Number(row?.last_seen_epoch || 0));
      if (lastSeenEpoch > existing.latest_seen_epoch) {
        existing.latest_seen_epoch = lastSeenEpoch;
      }
      if (lastSeenEpoch >= freshCutoffEpoch) {
        existing.fresh_count += 1;
      }
      bySource.set(value, existing);
    }

    return sanitizePublicSourceFacets(
      Array.from(bySource.values()).map((item) => ({
        value: item.value,
        label: item.label,
        count: item.count,
        avg_confidence: item.count > 0 ? item.confidenceSum / item.count : 0,
        avg_quality: item.count > 0 ? item.qualitySum / item.count : 0,
        latest_seen_epoch: item.latest_seen_epoch,
        fresh_count: item.fresh_count,
        fresh_percentage: item.count > 0 ? Math.round((item.fresh_count / item.count) * 100) : 0
      }))
    ).slice(0, limit);
  }

  return {
    buildPublicSourceFacets,
    getPublicSourceLabel,
    roundPublicMetric,
    sanitizePublicPostingItem,
    sanitizePublicPostings,
    sanitizePublicSourceFacetItem,
    sanitizePublicSourceFacets
  };
}

module.exports = {
  createPublicSerializers
};
