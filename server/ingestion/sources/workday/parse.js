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
      location: extractWorkdayLocationLabel(posting, jobUrl),
      city: structuredLocation.city || null,
      state: structuredLocation.state || null,
      country: structuredLocation.country || null,
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
