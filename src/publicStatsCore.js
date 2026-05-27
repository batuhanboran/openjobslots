function toFiniteNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function formatExactNumberLabel(value, fallback = "0") {
  const numberValue = toFiniteNumber(value, NaN);
  if (!Number.isFinite(numberValue)) return fallback;
  return numberValue.toLocaleString("en-US");
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const numberValue = toFiniteNumber(value, 0);
    if (numberValue > 0) return numberValue;
  }
  return 0;
}

function buildPublicStatsChips(status = {}) {
  const source = status || {};
  return [
    {
      key: "job-slots",
      value: formatExactNumberLabel(firstPositiveNumber(source.job_slot_count, source.posting_count)),
      label: "job slots"
    },
    {
      key: "ats",
      value: formatExactNumberLabel(firstPositiveNumber(source.configured_ats_count, source.visible_ats_count, source.configured_enabled_ats_count)),
      label: "ATS"
    },
    {
      key: "companies",
      value: formatExactNumberLabel(firstPositiveNumber(source.visible_company_count, source.company_count)),
      label: "companies"
    }
  ];
}

module.exports = {
  buildPublicStatsChips,
  formatExactNumberLabel
};
