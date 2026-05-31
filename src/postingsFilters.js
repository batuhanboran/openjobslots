function createDefaultPostingsFilters() {
  return {
    ats: "all",
    industries: [],
    regions: [],
    countries: [],
    states: [],
    counties: [],
    remote: "all",
    hide_no_date: false,
    freshness_days: "all",
    sort_by: "posted_date"
  };
}

function getPostingsFiltersSignature(filters = {}) {
  const normalizeArray = (value) => (Array.isArray(value) ? value.map(String).sort() : []);
  return JSON.stringify({
    ats: String(filters.ats || "all"),
    industries: normalizeArray(filters.industries),
    regions: normalizeArray(filters.regions),
    countries: normalizeArray(filters.countries),
    states: normalizeArray(filters.states),
    counties: normalizeArray(filters.counties),
    remote: String(filters.remote || "all"),
    hide_no_date: Boolean(filters.hide_no_date),
    freshness_days: String(filters.freshness_days || "all"),
    sort_by: String(filters.sort_by || "posted_date")
  });
}

module.exports = {
  createDefaultPostingsFilters,
  getPostingsFiltersSignature
};
