function clean(value) {
  return String(value || "").trim();
}

function asUrl(value) {
  try {
    return new URL(clean(value));
  } catch {
    return null;
  }
}

function hostSlug(value) {
  const parsed = asUrl(value);
  const host = String(parsed?.hostname || "").toLowerCase();
  return host.split(".").filter(Boolean)[0] || "";
}

function buildCompanyContext(company = {}) {
  return {
    company_name: clean(company.company_name || company.companyName || company.name),
    url_string: clean(company.url_string || company.company_url || company.url),
    ATS_name: clean(company.ATS_name || company.ats_key)
  };
}

function normalizeCompanyName(company, fallback) {
  return clean(company?.company_name || company?.companyName || company?.name || fallback);
}

function makeSourceFetchError(code, message, detail = {}) {
  const error = new Error(message || code);
  error.ingestionErrorType = code;
  if (detail.status) error.status = detail.status;
  if (detail.url) error.url = detail.url;
  return error;
}

module.exports = {
  asUrl,
  buildCompanyContext,
  clean,
  hostSlug,
  makeSourceFetchError,
  normalizeCompanyName
};
