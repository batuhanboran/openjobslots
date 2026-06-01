"use strict";

const { isRemoteOnlyLocationValue } = require("../../parsers/shared/location");
const { extractSourceIdFromPostingUrl } = require("../../parsers/shared/sourceIds");
const { normalizeCountryFromLocation } = require("../../posting");

const BAMBOOHR_COUNTRY_HINTS = Object.freeze({
  barbados: "Barbados",
  bolivia: "Bolivia",
  chile: "Chile",
  colombia: "Colombia",
  "dominican republic": "Dominican Republic",
  elsalvador: "El Salvador",
  "el salvador": "El Salvador",
  guatemala: "Guatemala",
  guyana: "Guyana",
  honduras: "Honduras",
  iceland: "Iceland",
  italy: "Italy",
  jamaica: "Jamaica",
  malaysia: "Malaysia",
  mozambique: "Mozambique",
  netherlands: "Netherlands",
  nicaragua: "Nicaragua",
  panama: "Panama",
  "puerto rico": "Puerto Rico",
  "rep dom": "Dominican Republic",
  repdom: "Dominican Republic",
  "rep.dom": "Dominican Republic",
  serbia: "Serbia",
  singapore: "Singapore",
  sudan: "Sudan",
  "south sudan": "South Sudan",
  syria: "Syria",
  tanzania: "Tanzania",
  "trinidad and tobago": "Trinidad and Tobago",
  uae: "United Arab Emirates",
  "united arab emirates": "United Arab Emirates",
  "united kingdom": "United Kingdom",
  uruguay: "Uruguay",
  zambia: "Zambia"
});

const BAMBOOHR_COUNTRY_REGIONS = Object.freeze({
  Barbados: "North America",
  Bolivia: "LATAM",
  "Dominican Republic": "North America",
  "El Salvador": "LATAM",
  Guatemala: "LATAM",
  Guyana: "LATAM",
  Honduras: "LATAM",
  Iceland: "EMEA",
  Jamaica: "North America",
  Mozambique: "EMEA",
  Nicaragua: "LATAM",
  Panama: "LATAM",
  Sudan: "EMEA",
  "South Sudan": "EMEA",
  Syria: "EMEA",
  Tanzania: "EMEA",
  "Trinidad and Tobago": "North America",
  Zambia: "EMEA"
});

const BAMBOOHR_ADMIN_REGION_COUNTRY_HINTS = Object.freeze({
  aberdeenshire: "United Kingdom",
  berkshire: "United Kingdom",
  buckinghamshire: "United Kingdom",
  cambridgeshire: "United Kingdom",
  cheshire: "United Kingdom",
  conwy: "United Kingdom",
  "county down": "United Kingdom",
  cornwall: "United Kingdom",
  cumbria: "United Kingdom",
  derbyshire: "United Kingdom",
  devon: "United Kingdom",
  durham: "United Kingdom",
  essex: "United Kingdom",
  "east sussex": "United Kingdom",
  fife: "United Kingdom",
  gloucestershire: "United Kingdom",
  "greater london": "United Kingdom",
  hampshire: "United Kingdom",
  hertfordshire: "United Kingdom",
  highland: "United Kingdom",
  kent: "United Kingdom",
  lancashire: "United Kingdom",
  leicestershire: "United Kingdom",
  merseyside: "United Kingdom",
  "mid glamorgan": "United Kingdom",
  middlesex: "United Kingdom",
  norfolk: "United Kingdom",
  nottinghamshire: "United Kingdom",
  northamptonshire: "United Kingdom",
  "north yorkshire": "United Kingdom",
  oxfordshire: "United Kingdom",
  renfrewshire: "United Kingdom",
  shropshire: "United Kingdom",
  "south yorkshire": "United Kingdom",
  "south ayrshire": "United Kingdom",
  staffordshire: "United Kingdom",
  "stockton-on-tees": "United Kingdom",
  surrey: "United Kingdom",
  somerset: "United Kingdom",
  "tyne and wear": "United Kingdom",
  warwickshire: "United Kingdom",
  "west sussex": "United Kingdom",
  "west yorkshire": "United Kingdom",
  wiltshire: "United Kingdom",
  worcestershire: "United Kingdom",
  wirral: "United Kingdom",
  denbighshire: "United Kingdom",
  "western cape": "South Africa",
  gauteng: "South Africa",
  "eastern cape": "South Africa",
  "kwazulu-natal": "South Africa",
  "kwazulu natal": "South Africa",
  limpopo: "South Africa",
  mpumalanga: "South Africa",
  "north west": "South Africa",
  "northern cape": "South Africa",
  "free state": "South Africa",
  "new south wales": "Australia",
  nsw: "Australia",
  queensland: "Australia",
  qld: "Australia",
  victoria: "Australia",
  vic: "Australia",
  "western australia": "Australia",
  "south australia": "Australia",
  tasmania: "Australia",
  tas: "Australia",
  "australian capital territory": "Australia",
  act: "Australia",
  "northern territory": "Australia",
  lagos: "Nigeria",
  hokkaido: "Japan",
  hyogo: "Japan",
  okinawa: "Japan",
  "dki jakarta": "Indonesia",
  jakarta: "Indonesia",
  "east kalimantan": "Indonesia",
  "south jakarta": "Indonesia",
  banten: "Indonesia",
  bali: "Indonesia",
  "selangor darul ehsan": "Malaysia",
  "johor darul takzim": "Malaysia",
  maputo: "Mozambique",
  attica: "Greece",
  piraeus: "Greece",
  colima: "Mexico",
  "miguel hidalgo": "Mexico",
  "las condes": "Chile",
  pudahuel: "Chile",
  oruro: "Bolivia",
  barranquilla: "Colombia",
  "el oro": "Ecuador",
  ncr: "Philippines",
  "metro manila": "Philippines",
  "makati city": "Philippines",
  "legaspi village": "Philippines",
  "new providence": "Bahamas",
  eleuthera: "Bahamas",
  copperbelt: "Zambia",
  kitwe: "Zambia",
  juba: "South Sudan",
  idleb: "Syria",
  idlib: "Syria",
  hasaka: "Syria",
  "der alzor": "Syria",
  "der alzor hasaka": "Syria",
  "deir ez zor": "Syria",
  montrouge: "France",
  bergamo: "Italy",
  lombardy: "Italy",
  "rheinland-pfalz": "Germany",
  munster: "Ireland",
  "buenos aires": "Argentina",
  "grad zagreb": "Croatia",
  zagrebacka: "Croatia",
  harjumaa: "Estonia",
  riga: "Latvia",
  "tel aviv": "Israel",
  bangkok: "Thailand",
  hcmc: "Vietnam"
});

function clean(value) {
  return String(value || "").trim();
}

function normalizeSearchText(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeHintKey(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9.]+/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeBambooHrCountry(value) {
  const normalized = normalizeHintKey(value);
  if (!normalized) return "";
  return BAMBOOHR_COUNTRY_HINTS[normalized] || BAMBOOHR_COUNTRY_HINTS[normalized.replace(/\s+/g, "")] || "";
}

function normalizeBambooHrRegion(country) {
  return BAMBOOHR_COUNTRY_REGIONS[country] || "";
}

function normalizeBambooHrAdminRegionCountry(value) {
  const normalized = normalizeHintKey(value);
  if (!normalized) return "";
  return BAMBOOHR_ADMIN_REGION_COUNTRY_HINTS[normalized] || "";
}

function isBlankLocationPart(value) {
  const normalized = normalizeHintKey(value);
  return !normalized || ["n/a", "n a", "na", "none", "null", "nil", "-", "--", "."].includes(normalized);
}

function cleanLocationPart(value) {
  return isBlankLocationPart(value) ? "" : clean(value);
}

function pushUniqueText(values, value) {
  const text = clean(value);
  if (!text) return;
  if (values.some((existing) => existing.toLowerCase() === text.toLowerCase())) return;
  values.push(text);
}

function inferSparseStructuredCountry(parts) {
  const city = normalizeSearchText(parts.city);
  const state = normalizeSearchText(parts.state);
  const locationName = normalizeSearchText(parts.locationName);
  const rawLocationText = normalizeSearchText(parts.rawLocationText);
  const rawAtsLocationText = normalizeSearchText(parts.rawAtsLocationText);

  if (city === "bruxelles" || state === "brussels" || state === "bruxelles") return "Belgium";
  if (city === "brussels" && !state) return "Belgium";
  if (city === "valletta" || state === "malta") return "Malta";
  if (city === "luxembourg" || state === "luxembourg") return "Luxembourg";
  if (/\bbruxelles\b/.test(locationName) || /\bbruxelles\b/.test(rawLocationText)) return "Belgium";
  if (/\bvalletta\b/.test(locationName) || /\bvalletta\b/.test(rawAtsLocationText)) return "Malta";
  if (/\bluxembourg\b/.test(locationName) || /\bluxembourg\b/.test(rawLocationText)) return "Luxembourg";
  return "";
}

function isAmbiguousBambooHrCity(value) {
  const text = normalizeSearchText(value);
  if (!text) return false;
  return /^(multiple|various|several|many)\b/.test(text) || /\bmultiple bases\b/.test(text);
}

function isCountryScopeBroadBambooHrCity(value) {
  const text = normalizeHintKey(value);
  return text === "various" || text === "various locations" || text === "various location";
}

function buildStructuredLocation(parts) {
  const values = [];
  pushUniqueText(values, parts.city);
  pushUniqueText(values, parts.state);
  pushUniqueText(values, parts.country);
  return values.join(", ");
}

function hasStructuredLocationValue(locationObject) {
  return Boolean(
    cleanLocationPart(locationObject?.city) ||
      cleanLocationPart(locationObject?.state) ||
      cleanLocationPart(locationObject?.province) ||
      cleanLocationPart(locationObject?.region) ||
      cleanLocationPart(locationObject?.country) ||
      cleanLocationPart(locationObject?.countryName) ||
      cleanLocationPart(locationObject?.countryCode)
  );
}

function bambooHrStructuredLocationParts(parts) {
  const rawCity = cleanLocationPart(parts.city);
  const hasAmbiguousCity = isAmbiguousBambooHrCity(rawCity);
  const countryScopeBroadCity = isCountryScopeBroadBambooHrCity(rawCity);
  let city = isRemoteOnlyLocationValue(rawCity) || hasAmbiguousCity ? "" : rawCity;
  let state = cleanLocationPart(parts.state);
  const explicitCountryRaw = cleanLocationPart(parts.country);
  let country = explicitCountryRaw;
  let ruleName = "bamboohr_structured_location";
  let countryScopeEligible = false;

  const explicitCountry = normalizeBambooHrCountry(country);
  if (explicitCountry) {
    country = explicitCountry;
    countryScopeEligible = true;
  }

  const cityCountry = normalizeBambooHrCountry(city);
  const stateCountry = normalizeBambooHrCountry(state);
  const stateAdminCountry = city ? normalizeBambooHrAdminRegionCountry(state) : "";
  const cityAdminCountry = !state ? normalizeBambooHrAdminRegionCountry(city) : "";
  const broadStateAdminCountry = countryScopeBroadCity ? normalizeBambooHrAdminRegionCountry(state) : "";

  if (!country && cityCountry && state && !stateCountry) {
    country = cityCountry;
    city = state;
    state = "";
    ruleName = "bamboohr_country_token_location";
    countryScopeEligible = true;
  } else if (!country && stateCountry) {
    country = stateCountry;
    state = "";
    ruleName = "bamboohr_country_token_location";
    countryScopeEligible = true;
  } else if (!country && cityCountry) {
    country = cityCountry;
    city = "";
    state = "";
    ruleName = "bamboohr_country_token_location";
    countryScopeEligible = true;
  } else if (!country && cityAdminCountry) {
    country = cityAdminCountry;
    ruleName = "bamboohr_admin_region_location";
    countryScopeEligible = true;
  } else if (!country && stateAdminCountry) {
    country = stateAdminCountry;
    ruleName = "bamboohr_admin_region_location";
    countryScopeEligible = true;
  } else if (!country && broadStateAdminCountry) {
    country = broadStateAdminCountry;
    ruleName = "bamboohr_admin_region_location";
    countryScopeEligible = true;
  } else if (country && stateCountry === country) {
    state = "";
    ruleName = "bamboohr_country_token_location";
  } else if (country && cityCountry === country && state && !stateCountry) {
    city = state;
    state = "";
    ruleName = "bamboohr_country_token_location";
  }

  if (!country) {
    country =
      inferSparseStructuredCountry({
        city: parts.city,
        state,
        country,
        locationName: parts.locationName,
        rawLocationText: parts.rawLocationText,
        rawAtsLocationText: parts.rawAtsLocationText
      }) ||
      normalizeCountryFromLocation(buildStructuredLocation({ city: parts.city, state, country: "" }));
    if (country) ruleName = "bamboohr_sparse_structured_location";
  }

  const countryScopeLocation = countryScopeBroadCity && country && countryScopeEligible;
  if (countryScopeLocation) {
    ruleName = "bamboohr_country_scope_location";
  }

  return {
    city,
    state,
    country,
    location: countryScopeLocation
      ? country
      : buildStructuredLocation({ city: hasAmbiguousCity ? rawCity : city, state, country }),
    rawLocation: buildStructuredLocation({ city: rawCity, state, country: explicitCountryRaw || country }),
    ruleName
  };
}

function bambooHrRemoteTypeFromSource(item) {
  if (item?.isRemote === true) {
    return {
      value: "remote",
      path: "result[].isRemote",
      raw: "true"
    };
  }

  const candidates = [
    ["result[].workplaceType", item?.workplaceType],
    ["result[].workplace_type", item?.workplace_type],
    ["result[].remoteStatus", item?.remoteStatus],
    ["result[].locationType", item?.locationType]
  ];

  for (const [path, rawValue] of candidates) {
    const value = clean(rawValue);
    if (!value) continue;
    const normalized = normalizeHintKey(value);
    if (path === "result[].locationType") {
      if (normalized === "0") return { value: "onsite", path, raw: value };
      if (normalized === "1") return { value: "remote", path, raw: value };
      if (normalized === "2") return { value: "hybrid", path, raw: value };
    }
    if (/\bhybrid\b/.test(normalized)) return { value: "hybrid", path, raw: value };
    if (/\b(remote|virtual|work from home|wfh)\b/.test(normalized)) return { value: "remote", path, raw: value };
    if (/\b(on site|onsite|office based|in office)\b/.test(normalized)) return { value: "onsite", path, raw: value };
  }

  return { value: "", path: "", raw: "" };
}

function parseBambooHrPostingsFromApi(companyNameForPostings, config, responseJson) {
  const result = Array.isArray(responseJson?.result) ? responseJson.result : [];
  const postings = [];
  const seenUrls = new Set();

  for (const row of result) {
    const item = row && typeof row === "object" ? row : {};
    const postingId = String(item?.id || "").trim();
    const itemUrlRaw = String(item?.url || item?.jobUrl || item?.applyUrl || item?.applicationUrl || "").trim();
    if (!itemUrlRaw && !postingId) continue;
    const jobUrl = itemUrlRaw
      ? new URL(itemUrlRaw, `${config.baseOrigin || config.boardUrl || ""}/`).toString()
      : postingId
        ? `${config.boardUrl}/${encodeURIComponent(postingId)}`
        : "";
    if (!jobUrl || seenUrls.has(jobUrl)) continue;
    const title = clean(item?.jobOpeningName || item?.title || item?.jobTitle);
    if (!title) continue;

    const locationObject = item?.location && typeof item.location === "object" ? item.location : {};
    const atsLocationObject = item?.atsLocation && typeof item.atsLocation === "object" ? item.atsLocation : {};
    const rawLocationText = typeof item?.location === "string" ? clean(item.location) : "";
    const rawAtsLocationText = typeof item?.atsLocation === "string" ? clean(item.atsLocation) : "";
    const rawCity = cleanLocationPart(locationObject?.city || atsLocationObject?.city);
    const state = cleanLocationPart(
      locationObject?.state ||
        locationObject?.province ||
        locationObject?.region ||
        atsLocationObject?.state ||
        atsLocationObject?.province ||
        atsLocationObject?.region ||
        ""
    );
    const countryRaw = cleanLocationPart(
      locationObject?.country ||
        atsLocationObject?.country ||
        locationObject?.countryName ||
        atsLocationObject?.countryName ||
        locationObject?.countryCode ||
        atsLocationObject?.countryCode ||
        ""
    );
    const locationName = cleanLocationPart(
      locationObject?.name ||
        atsLocationObject?.name ||
        locationObject?.label ||
        atsLocationObject?.label ||
        locationObject?.displayName ||
        atsLocationObject?.displayName ||
        ""
    );
    const structured = bambooHrStructuredLocationParts({
      city: rawCity,
      state,
      country: countryRaw,
      locationName,
      rawLocationText,
      rawAtsLocationText
    });
    const remoteType = bambooHrRemoteTypeFromSource(item);
    const location =
      structured.location ||
      locationName ||
      rawLocationText ||
      rawAtsLocationText ||
      clean(item?.employmentLocation || item?.workplaceLocation) ||
      (item?.isRemote ? "Remote" : null);
    const locationPath = hasStructuredLocationValue(locationObject)
      ? "result[].location"
      : hasStructuredLocationValue(atsLocationObject)
        ? "result[].atsLocation"
        : "";
    const sourceEvidence = locationPath
      ? {
          location_source: "list_api",
          location_path: locationPath,
          location_rule_name:
            structured.ruleName === "bamboohr_structured_location" &&
            structured.country &&
            (!countryRaw || locationPath === "result[].atsLocation")
              ? "bamboohr_sparse_structured_location"
              : structured.ruleName,
          location_raw: structured.rawLocation || location
        }
      : undefined;

    const postingDate =
      clean(
        item?.postingDate ||
          item?.postedDate ||
          item?.postedAt ||
          item?.publishedAt ||
          item?.publishDate ||
          item?.datePosted ||
          item?.createdDate ||
          item?.createdAt ||
          item?.updatedDate ||
          item?.updatedAt ||
          item?.openedDate ||
          item?.openDate ||
          ""
      ) ||
      null;

    postings.push({
      company_name: companyNameForPostings,
      source_job_id: postingId || extractSourceIdFromPostingUrl(jobUrl, "bamboohr"),
      id: postingId,
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location,
      city: structured.city || null,
      country: structured.country || null,
      region: normalizeBambooHrRegion(structured.country) || null,
      remote: remoteType.value === "remote",
      is_remote: remoteType.value === "remote" || remoteType.value === "hybrid",
      remote_type: remoteType.value || null,
      workplaceType:
        remoteType.value ||
        clean(item?.workplaceType || item?.workplace_type || item?.remoteStatus || item?.locationType) ||
        (item?.isRemote === true ? "remote" : null),
      department: clean(item?.departmentLabel || item?.department) || null,
      employment_type: clean(item?.employmentStatusLabel || item?.employmentStatus) || null,
      source_evidence: {
        ...(sourceEvidence || {}),
        ...(remoteType.value
          ? {
              remote_source: "list_api",
              remote_path: remoteType.path,
              remote_rule_name: "bamboohr_location_type",
              remote_raw: remoteType.raw
            }
          : {}),
        ...(postingDate
          ? {
              posting_date_source: "list_api",
              posting_date_path: "result[].postingDate",
              posting_date_rule_name: "bamboohr_source_posting_date"
            }
          : {})
      }
    });
    seenUrls.add(jobUrl);
  }

  return postings;
}

module.exports = {
  normalizeBambooHrAdminRegionCountry,
  normalizeBambooHrCountry,
  normalizeBambooHrRegion,
  parseBambooHrPostingsFromApi
};
