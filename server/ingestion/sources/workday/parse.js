"use strict";

function buildJobUrl(companyBaseUrl, externalPath) {
  if (typeof externalPath !== "string" || !externalPath.trim()) return "";
  if (/^https?:\/\//i.test(externalPath.trim())) return externalPath.trim();
  const normalizedPath = externalPath.startsWith("/") ? externalPath : `/${externalPath}`;
  return `${companyBaseUrl}${normalizedPath}`;
}

function formatLocationSegment(rawLocation) {
  if (typeof rawLocation !== "string") return null;
  const trimmed = rawLocation.trim();
  if (!trimmed) return null;

  const doubleDashToken = "__DOUBLE_DASH__";
  return trimmed
    .replace(/--+/g, doubleDashToken)
    .replace(/-/g, " ")
    .replace(new RegExp(doubleDashToken, "g"), "- ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferWorkdayLocationFromJobUrl(jobPostingUrl) {
  try {
    const parsed = new URL(String(jobPostingUrl || ""));
    const pathParts = parsed.pathname
      .split("/")
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    const jobIndex = pathParts.findIndex((part) => part.toLowerCase() === "job");
    if (jobIndex >= 0 && pathParts[jobIndex + 1] && pathParts[jobIndex + 2]) {
      const rawLocation = decodeURIComponent(pathParts[jobIndex + 1]);
      return formatLocationSegment(rawLocation);
    }
    return null;
  } catch {
    return null;
  }
}

function extractWorkdaySourceJobId(posting, jobPostingUrl) {
  const source = posting && typeof posting === "object" ? posting : {};
  const externalPath = String(source?.externalPath || "").trim();
  const fromExternalPath = externalPath.match(/_([A-Za-z0-9-]+)$/)?.[1] || "";
  if (fromExternalPath && /^(?:jr|req|r)-?[a-z0-9-]+$/i.test(fromExternalPath)) return fromExternalPath;

  const direct = String(
    source?.jobRequisitionId ||
      source?.jobReqId ||
      source?.requisitionId ||
      source?.requisition_id ||
      source?.jobId ||
      source?.jobID ||
      source?.id ||
      ""
  ).trim();
  if (direct) return direct;

  if (fromExternalPath) return fromExternalPath;

  try {
    const parsed = new URL(String(jobPostingUrl || ""));
    const lastPart = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    return String(lastPart.match(/_([A-Za-z0-9-]+)$/)?.[1] || "").trim();
  } catch {
    return "";
  }
}

function collectWorkdayLocationValues(posting, jobPostingUrl) {
  const source = posting && typeof posting === "object" ? posting : {};
  const values = [];
  const pushValue = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) pushValue(item);
      return;
    }
    if (typeof value === "object") {
      pushValue(value.descriptor);
      pushValue(value.location);
      pushValue(value.locationName);
      pushValue(value.displayName);
      pushValue(value.name);
      pushValue(value.text);
      pushValue(value.label);
      pushValue(value.city);
      pushValue([value.city, value.state || value.region || value.province, value.country || value.countryName].filter(Boolean).join(", "));
      return;
    }
    const text = String(value || "").trim();
    if (!text) return;
    const normalized = text.toLowerCase();
    if (values.some((existing) => existing.toLowerCase() === normalized)) return;
    values.push(text);
  };

  pushValue(source.locationsText);
  pushValue(source.locationText);
  pushValue(source.primaryLocation);
  pushValue(source.location);
  pushValue(source.locations);
  pushValue(source.jobLocation);
  pushValue(source.bulletFields);
  pushValue(inferWorkdayLocationFromJobUrl(jobPostingUrl));

  return values.filter(Boolean);
}

function extractWorkdayLocationLabel(posting, jobPostingUrl) {
  const values = collectWorkdayLocationValues(posting, jobPostingUrl);
  return values.length > 0 ? values.join(" / ") : null;
}

function extractWorkdayStructuredLocation(posting) {
  const source = posting && typeof posting === "object" ? posting : {};
  const candidates = [
    source.primaryLocation,
    source.location,
    Array.isArray(source.locations) ? source.locations[0] : source.locations,
    source.jobLocation
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const city = String(candidate.city || "").trim();
    const state = String(candidate.state || candidate.region || candidate.province || "").trim();
    const country = String(candidate.country || candidate.countryName || "").trim();
    const label = String(candidate.descriptor || candidate.displayName || candidate.locationName || candidate.name || "").trim();
    if (city || state || country || label) {
      return { city, state, country, label };
    }
  }
  return { city: "", state: "", country: "", label: "" };
}

function extractWorkdayRemoteSignal(posting, jobPostingUrl) {
  const source = posting && typeof posting === "object" ? posting : {};
  return [
    source?.remoteType,
    source?.remote_type,
    source?.workplaceType,
    source?.workplace_type,
    source?.locationType,
    source?.timeType,
    source?.isRemote === true ? "remote" : "",
    source?.remote === true ? "remote" : "",
    source?.title,
    source?.locationsText,
    source?.locationText,
    source?.externalPath,
    inferWorkdayLocationFromJobUrl(jobPostingUrl)
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

const US_STATES = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO",
  "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
  "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
  "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
  "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
  "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
  "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC"
};
const US_STATE_CODES = new Set(Object.values(US_STATES));

function parseLocationText(locationText) {
  if (typeof locationText !== "string") return null;
  const clean = locationText.replace(/__DOUBLE_DASH__/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;

  let parts = clean.split(/[,\/]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    parts = clean.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  }

  if (parts.length >= 2) {
    let city = "";
    let state = "";
    let country = "";

    const lastPart = parts[parts.length - 1];
    const lastPartLower = lastPart.toLowerCase();

    const commonCountries = {
      "united states": "United States", "usa": "United States", "united states of america": "United States",
      "united kingdom": "United Kingdom", "uk": "United Kingdom", "england": "United Kingdom",
      "canada": "Canada", "germany": "Germany", "deutschland": "Germany", "france": "France",
      "netherlands": "Netherlands", "india": "India", "australia": "Australia", "japan": "Japan",
      "turkey": "Turkey", "türkiye": "Turkey", "turkiye": "Turkey", "spain": "Spain", "italy": "Italy"
    };

    if (commonCountries[lastPartLower]) {
      country = commonCountries[lastPartLower];
      parts.pop();
    }

    if (parts.length > 0) {
      const nextLast = parts[parts.length - 1];
      const nextLastLower = nextLast.toLowerCase();
      if (US_STATES[nextLastLower]) {
        state = US_STATES[nextLastLower];
        parts.pop();
        if (!country) country = "United States";
      } else if (US_STATE_CODES.has(nextLast.toUpperCase())) {
        state = nextLast.toUpperCase();
        parts.pop();
        if (!country) country = "United States";
      }
    }

    if (parts.length > 0) {
      city = parts[0];
      if (/^(?:remote|various|multiple|tbd|home based|home-based|flexible|anywhere|virtual)$/i.test(city)) {
        city = "";
      }
    }

    if (city || state || country) {
      return { city, state, country };
    }
  }

  return null;
}

function parseWorkdayPostingsFromApi(companyNameForPostings, config, response) {
  const postings = Array.isArray(response?.jobPostings)
    ? response.jobPostings
    : Array.isArray(response?.data?.jobPostings)
      ? response.data.jobPostings
      : Array.isArray(response?.data?.jobs)
        ? response.data.jobs
        : Array.isArray(response?.jobs)
          ? response.jobs
          : [];
  const companyName = String(companyNameForPostings || "").trim();
  const collected = [];
  const seenUrls = new Set();

  for (const posting of postings) {
    const jobUrl = buildJobUrl(config?.companyBaseUrl, posting?.externalPath);
    if (!jobUrl || seenUrls.has(jobUrl)) continue;
    const structuredLocation = extractWorkdayStructuredLocation(posting);
    let city = structuredLocation.city || null;
    let state = structuredLocation.state || null;
    let country = structuredLocation.country || null;

    if (!city || !country) {
      const label = extractWorkdayLocationLabel(posting, jobUrl);
      const parsed = parseLocationText(label);
      if (parsed) {
        if (!city && parsed.city) city = parsed.city;
        if (!state && parsed.state) state = parsed.state;
        if (!country && parsed.country) country = parsed.country;
      }
    }

    const finalLocation = [city, state, country].filter(Boolean).join(", ") || extractWorkdayLocationLabel(posting, jobUrl);

    collected.push({
      company_name: companyName,
      source_job_id: extractWorkdaySourceJobId(posting, jobUrl),
      id: String(posting?.id || posting?.jobId || "").trim() || undefined,
      position_name: String(posting?.title || "").trim() || "Untitled Position",
      job_posting_url: jobUrl,
      posting_date:
        String(
          posting?.postedOn ||
            posting?.postedOnDate ||
            posting?.postedDate ||
            posting?.postingDate ||
            posting?.externalPostedOn ||
            posting?.updatedOn ||
            ""
        ).trim() || null,
      location: finalLocation,
      city: city || null,
      state: state || null,
      country: country || null,
      workplaceType: extractWorkdayRemoteSignal(posting, jobUrl)
    });
    seenUrls.add(jobUrl);
  }

  return collected;
}

module.exports = {
  extractWorkdayLocationLabel,
  extractWorkdaySourceJobId,
  inferWorkdayLocationFromJobUrl,
  parseWorkdayPostingsFromApi
};

