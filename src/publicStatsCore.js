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
  return [
    {
      key: "job-slots",
      value: formatExactNumberLabel(firstPositiveNumber(status.job_slot_count, status.posting_count)),
      label: "job slots"
    },
    {
      key: "ats",
      value: formatExactNumberLabel(firstPositiveNumber(status.configured_ats_count, status.visible_ats_count, status.configured_enabled_ats_count)),
      label: "ATS"
    },
    {
      key: "companies",
      value: formatExactNumberLabel(firstPositiveNumber(status.visible_company_count, status.company_count)),
      label: "companies"
    }
  ];
}

module.exports = {
  buildPublicStatsChips,
  formatExactNumberLabel
};
