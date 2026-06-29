"use strict";

const { decodeHtmlEntities } = require("../../parsers/shared/html");
const { normalizeCountryName, normalizeRemoteType } = require("../../posting");

function stripSearchDiacritics(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I");
}

function normalizeSearchText(value) {
  return stripSearchDiacritics(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractRecruiteePropsFromHtml(pageHtml) {
  const source = String(pageHtml || "");
  const patterns = [
    /data-component=(?:"|')PublicApp(?:"|')[^>]*data-props=(?:"|')([^"']+)(?:"|')/is,
    /data-props=(?:"|')([^"']+)(?:"|')[^>]*data-component=(?:"|')PublicApp(?:"|')/is
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const encodedProps = String(match?.[1] || "");
    if (!encodedProps) continue;

    const decodedProps = decodeHtmlEntities(encodedProps);
    try {
      const parsedProps = JSON.parse(decodedProps);
      if (parsedProps && typeof parsedProps === "object") return parsedProps;
    } catch {
      // Continue with the next extraction pattern.
    }
  }

  return null;
}

function pickRecruiteeTranslation(translations, preferredLangCode = "") {
  const byLang = translations && typeof translations === "object" ? translations : {};
  const candidates = [];
  const preferred = String(preferredLangCode || "").trim();

  if (preferred && byLang[preferred] && typeof byLang[preferred] === "object") {
    candidates.push(byLang[preferred]);
  }
  if (byLang.en && typeof byLang.en === "object") {
    candidates.push(byLang.en);
  }
  for (const value of Object.values(byLang)) {
    if (value && typeof value === "object") candidates.push(value);
  }

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate;
  }

  return {};
}

function extractRecruiteeTitle(offer, preferredLangCode = "") {
  const translation = pickRecruiteeTranslation(offer?.translations, offer?.primaryLangCode || preferredLangCode);
  return String(
    translation?.title ||
      translation?.name ||
      offer?.title ||
      offer?.sharing_title ||
      offer?.name ||
      ""
  ).trim();
}

function pushUniqueRecruiteeValue(values, value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return;
  const normalized = normalizeSearchText(cleaned);
  if (!normalized) return;
  if (values.some((existing) => normalizeSearchText(existing) === normalized)) return;
  values.push(cleaned);
}

function buildRecruiteeLocationLabel(location, preferredLangCode = "") {
  if (typeof location === "string") return String(location || "").replace(/\s+/g, " ").trim() || null;
  const translation = pickRecruiteeTranslation(location?.translations, preferredLangCode);
  const city = String(translation?.city || location?.city || "").trim();
  const name = String(translation?.name || location?.name || location?.label || "").trim();
  const region = String(location?.state_name || location?.region || location?.state || location?.province || "").trim();
  const country = String(
    translation?.country ||
      location?.country ||
      location?.countryName ||
      location?.country_code ||
      location?.countryCode ||
      location?.isoCountry ||
      ""
  ).trim();
  const values = [city || name, region, country].filter(Boolean);
  return values.length > 0 ? values.join(", ") : null;
}

function collectRecruiteeLocationsFromOffer(offer, locationById, preferredLangCode = "") {
  const values = [];
  const locationIds = Array.isArray(offer?.locationIds)
    ? offer.locationIds
    : Array.isArray(offer?.location_ids)
      ? offer.location_ids
      : [];
  for (const locationId of locationIds) {
    pushUniqueRecruiteeValue(values, locationById.get(String(locationId ?? "").trim()) || "");
  }

  if (Array.isArray(offer?.locations)) {
    for (const location of offer.locations) {
      if (location && typeof location === "object") {
        const id = String(location?.id ?? location?.uuid ?? "").trim();
        pushUniqueRecruiteeValue(values, id ? locationById.get(id) : "");
        pushUniqueRecruiteeValue(values, buildRecruiteeLocationLabel(location, preferredLangCode));
      } else {
        pushUniqueRecruiteeValue(values, locationById.get(String(location ?? "").trim()) || location);
      }
    }
  }

  pushUniqueRecruiteeValue(values, buildRecruiteeLocationLabel(offer?.location || {}, preferredLangCode));
  pushUniqueRecruiteeValue(values, buildRecruiteeLocationLabel({
    city: offer?.city,
    state: offer?.state_name || offer?.state,
    province: offer?.province,
    country: offer?.country,
    countryCode: offer?.country_code
  }, preferredLangCode));

  return values;
}

function normalizeRecruiteeWorkplaceType(offer = {}) {
  const explicit = String(
    offer?.workplaceType ||
      offer?.workplace_type ||
      offer?.remoteStatus ||
      offer?.locationType ||
      offer?.location_type ||
      ""
  ).trim();
  if (explicit) return explicit;
  if (offer?.hybrid === true) return "hybrid";
  if (offer?.remote === true || offer?.isRemote === true) return "remote";
  if (offer?.on_site === true || offer?.onSite === true) return "onsite";
  if (offer?.location?.remote === true || offer?.location?.isRemote === true) return "remote";
  return null;
}

function parseRecruiteePostingsFromPublicApp(companyNameForPostings, config, response) {
  const source = typeof response === "string"
    ? (extractRecruiteePropsFromHtml(response) || {})
    : response && typeof response === "object"
      ? (
          typeof response.html === "string"
            ? (extractRecruiteePropsFromHtml(response.html) || response)
            : response
        )
      : {};
  const appConfig =
    source?.appConfig && typeof source.appConfig === "object"
      ? source.appConfig
      : source?.props?.appConfig && typeof source.props.appConfig === "object"
        ? source.props.appConfig
        : source?.data?.appConfig && typeof source.data.appConfig === "object"
          ? source.data.appConfig
          : source?.data && typeof source.data === "object" && Array.isArray(source.data.offers)
            ? source.data
            : source;
  const preferredLangCode = String(appConfig?.primaryLangCode || appConfig?.defaultLangCode || "").trim();
  const offers = Array.isArray(appConfig?.offers) ? appConfig.offers : [];
  const locations = Array.isArray(appConfig?.locations)
    ? appConfig.locations
    : Array.isArray(source?.locations)
      ? source.locations
      : [];
  const departments = Array.isArray(appConfig?.departments)
    ? appConfig.departments
    : Array.isArray(source?.departments)
      ? source.departments
      : [];

  const locationById = new Map();
  for (const location of locations) {
    const id = String(location?.id ?? location?.uuid ?? "").trim();
    if (!id) continue;
    const label = buildRecruiteeLocationLabel(location, preferredLangCode);
    if (label) locationById.set(id, label);
  }

  const departmentById = new Map();
  for (const department of departments) {
    const id = String(department?.id ?? department?.uuid ?? "").trim();
    if (!id) continue;
    const translation = pickRecruiteeTranslation(department?.translations, preferredLangCode);
    const label = String(translation?.name || department?.name || department?.label || "").trim();
    if (label) departmentById.set(id, label);
  }

  const postings = [];
  const seenUrls = new Set();
  for (const offer of offers) {
    const slug = String(offer?.slug || "").trim();
    const offerId = String(offer?.id ?? offer?.uuid ?? offer?.guid ?? slug).trim();
    if (!slug && !offerId) continue;
    const explicitUrl = String(offer?.careers_url || offer?.careersUrl || offer?.url || "").trim();
    const jobUrl = explicitUrl || (slug ? `${config.baseUrl}/o/${slug}` : offerId ? `${config.baseUrl}/o/${offerId}` : config.baseUrl);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;

    const publishedValue =
      offer?.publishedAt ??
      offer?.published_at ??
      offer?.createdAt ??
      offer?.created_at ??
      offer?.updatedAt ??
      offer?.updated_at;
    let postingDate = null;
    if (typeof publishedValue === "string" && publishedValue.trim()) {
      postingDate = publishedValue.trim();
    } else if (typeof publishedValue === "number" && Number.isFinite(publishedValue) && publishedValue > 0) {
      postingDate = new Date(publishedValue).toISOString();
    }

    const locationNames = collectRecruiteeLocationsFromOffer(offer, locationById, preferredLangCode);

    const departmentId = String(offer?.departmentId ?? offer?.department_id ?? offer?.department?.id ?? "").trim();
    const department = departmentById.get(departmentId) || String(
      offer?.department?.name ||
        offer?.departmentName ||
        offer?.category_code ||
        ""
    ).trim() || null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: offerId,
      id: offerId,
      position_name: extractRecruiteeTitle(offer, preferredLangCode),
      job_posting_url: offer?.careers_url || offer?.careersUrl || offer?.url || jobUrl,
      apply_url: offer?.careers_apply_url || offer?.careersApplyUrl || offer?.apply_url || offer?.application_url || null,
      posting_date: postingDate,
      location: locationNames.length > 0 ? [...new Set(locationNames)].join(" / ") : null,
      city: String(offer?.city || "").trim(),
      country: normalizeCountryName(offer?.country || offer?.country_code || "") || String(offer?.country || offer?.country_code || "").trim(),
      department,
      employment_type: String(offer?.employment_type_code || offer?.contract_type || "").trim(),
      description_html: String(offer?.description || offer?.requirements || "").trim(),
      remote:
        offer?.remote === true ||
        offer?.isRemote === true ||
        offer?.location?.remote === true ||
        offer?.location?.isRemote === true,
      workplaceType: normalizeRecruiteeWorkplaceType(offer),
      remote_type: (() => {
        const raw = normalizeRecruiteeWorkplaceType(offer);
        if (!raw) return null;
        const result = normalizeRemoteType(raw);
        return result === "unknown" ? null : result;
      })(),
      source_evidence: Object.freeze({
        route_kind: "recruitee_public_app",
        title_source: "api",
        canonical_url_source: "api",
        location_source: (offer?.locations || offer?.location || offer?.city) ? "api_location" : "",
        remote_source: (() => {
          const raw = normalizeRecruiteeWorkplaceType(offer);
          if (!raw) return "";
          const result = normalizeRemoteType(raw);
          return result !== "unknown" ? "api_workplacetype" : "";
        })()
      })
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  extractRecruiteePropsFromHtml,
  parseRecruiteePostingsFromPublicApp
};
