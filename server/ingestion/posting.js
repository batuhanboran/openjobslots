function normalizePostingValue(value) {
  return String(value || "").trim();
}

function canonicalizePostingUrl(value) {
  return normalizePostingValue(value).replace(/#.*$/, "");
}

function normalizeSearchText(value) {
  return normalizePostingValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeCountryFromLocation(value) {
  const location = normalizePostingValue(value);
  const normalized = normalizeSearchText(location);
  if (!normalized) return "";
  if (/\b(tr|turkiye|turkey|turkish|istanbul|ankara|izmir|antalya|bursa|gebze|kocaeli)\b/.test(normalized)) return "Turkey";
  if (/\b(united states|usa|u\.s\.|u\.s|us|new york|california|texas|washington|florida)\b/.test(normalized)) return "United States";
  if (/\b(united kingdom|uk|england|london)\b/.test(normalized)) return "United Kingdom";
  if (/\b(germany|deutschland|berlin)\b/.test(normalized)) return "Germany";
  if (/\b(france|paris)\b/.test(normalized)) return "France";
  if (/\b(canada|toronto|vancouver)\b/.test(normalized)) return "Canada";
  if (/\b(netherlands|amsterdam)\b/.test(normalized)) return "Netherlands";
  if (/\b(spain|madrid|barcelona)\b/.test(normalized)) return "Spain";
  if (/\b(italy|rome|milan)\b/.test(normalized)) return "Italy";
  if (/\b(ireland|dublin)\b/.test(normalized)) return "Ireland";
  return "";
}

function normalizeCountryName(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return "";
  const aliases = {
    tr: "Turkey",
    tur: "Turkey",
    turkiye: "Turkey",
    turkey: "Turkey",
    turkish: "Turkey",
    us: "United States",
    "u.s.": "United States",
    "u.s": "United States",
    usa: "United States",
    unitedstates: "United States",
    "united states": "United States",
    uk: "United Kingdom",
    gb: "United Kingdom",
    gbr: "United Kingdom",
    "united kingdom": "United Kingdom",
    de: "Germany",
    deu: "Germany",
    germany: "Germany",
    deutschland: "Germany",
    fr: "France",
    fra: "France",
    france: "France",
    ca: "Canada",
    can: "Canada",
    canada: "Canada",
    nl: "Netherlands",
    nld: "Netherlands",
    netherlands: "Netherlands",
    es: "Spain",
    esp: "Spain",
    spain: "Spain",
    it: "Italy",
    ita: "Italy",
    italy: "Italy",
    ie: "Ireland",
    irl: "Ireland",
    ireland: "Ireland"
  };
  return aliases[normalized] || "";
}

function normalizeRegionFromCountry(country) {
  const normalized = normalizeSearchText(country);
  if (["turkey", "united kingdom", "germany", "france", "netherlands", "spain", "italy", "ireland"].includes(normalized)) {
    return "EMEA";
  }
  if (normalized === "united states" || normalized === "canada") {
    return "North America";
  }
  return "";
}

function normalizeRemoteType(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return "unknown";
  if (normalized === "true") return "remote";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/\b(remote|work from home|wfh|anywhere)\b/.test(normalized)) return "remote";
  if (/\b(on[- ]?site|office based|in office)\b/.test(normalized)) return "onsite";
  return "unknown";
}

function normalizePostingDate(value) {
  const rawValue = normalizePostingValue(value);
  if (!rawValue) return { raw: null, epoch: null };
  if (/^\d{10}$/.test(rawValue)) {
    return { raw: rawValue, epoch: Number(rawValue) };
  }
  if (/^\d{13}$/.test(rawValue)) {
    return { raw: rawValue, epoch: Math.floor(Number(rawValue) / 1000) };
  }
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return { raw: rawValue, epoch: null };
  }
  return {
    raw: rawValue,
    epoch: Math.floor(parsed.getTime() / 1000)
  };
}

function stablePayloadHash(value) {
  const source = typeof value === "string" ? value : JSON.stringify(value || {});
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function firstValue(values) {
  for (const value of values) {
    if (value && typeof value === "object") continue;
    const normalized = normalizePostingValue(value);
    if (normalized) return normalized;
  }
  return "";
}

function extractLocationText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map(extractLocationText).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return firstValue([
      extractLocationText(value.location),
      value.locationName,
      value.name,
      value.text,
      [value.city, value.region, value.state, value.country].filter(Boolean).join(", ")
    ]);
  }
  return normalizePostingValue(value);
}

function normalizeConfidence(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function epochToIso(epoch) {
  const value = Number(epoch);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function isPlaceholderCompanyName(value) {
  const normalized = normalizeSearchText(value);
  return ["unknown", "unknown company", "unknown employer", "n/a", "na", "none"].includes(normalized);
}

function normalizePosting(posting, company, atsKey, options = {}) {
  const companyName =
    firstValue([
      posting?.company_name,
      posting?.company?.name,
      posting?.company?.companyName,
      posting?.companyName,
      posting?.organization?.name,
      company?.company_name
    ]);
  const positionName = firstValue([
    posting?.position_name,
    posting?.title,
    posting?.job_title,
    posting?.jobOpeningName,
    posting?.name
  ]);
  const jobPostingUrl = canonicalizePostingUrl(firstValue([
    posting?.job_posting_url,
    posting?.canonical_url,
    posting?.absolute_url,
    posting?.hostedUrl,
    posting?.careers_url,
    posting?.applicationUrl,
    posting?.applyUrl,
    posting?.url,
    posting?.ref,
    posting?.externalUrl
  ]));
  const applyUrl = canonicalizePostingUrl(firstValue([
    posting?.apply_url,
    posting?.applicationUrl,
    posting?.applyUrl,
    posting?.hostedUrl,
    jobPostingUrl
  ]));
  const location = firstValue([
    posting?.location_text,
    extractLocationText(posting?.location),
    extractLocationText(posting?.locations),
    extractLocationText(posting?.jobLocation),
    extractLocationText(posting?.PrimaryLocation),
    extractLocationText(posting?.workLocation),
    posting?.locationName,
    posting?.workplaceLocation,
    posting?.workplace
  ]) || null;
  const postingDate = normalizePostingDate(firstValue([
    posting?.posting_date,
    posting?.posted_at,
    posting?.postedAt,
    posting?.postedDate,
    posting?.releasedDate,
    posting?.created_at,
    posting?.createdAt,
    posting?.published_at,
    posting?.publishedAt
  ]));
  const remoteSignal = [
    posting?.remote_type,
    posting?.workplaceType,
    posting?.workplace_type,
    posting?.workplace_type_text,
    posting?.locationType,
    posting?.workLocationOption,
    posting?.remote,
    posting?.is_remote,
    posting?.isRemote,
    posting?.employment_type,
    posting?.job_type,
    location,
    positionName
  ].map((value) => (value === true ? "remote" : normalizePostingValue(value))).filter(Boolean).join(" ");
  const remoteType = normalizeRemoteType(remoteSignal);
  const country = firstValue([normalizeCountryName(posting?.country), normalizeCountryFromLocation(location)]);
  const region = firstValue([posting?.region, normalizeRegionFromCountry(country)]);
  const parserVersion = normalizePostingValue(options?.parserVersion) || "legacy-adapter-v1";
  const sourceJobId =
    normalizePostingValue(posting?.source_job_id) ||
    normalizePostingValue(posting?.id) ||
    normalizePostingValue(posting?.job_id) ||
    normalizePostingValue(posting?.jobId) ||
    normalizePostingValue(posting?.JobId) ||
    normalizePostingValue(posting?.jobID) ||
    normalizePostingValue(posting?.itemID) ||
    normalizePostingValue(posting?.itemId) ||
    normalizePostingValue(posting?.reqId) ||
    normalizePostingValue(posting?.reqID) ||
    normalizePostingValue(posting?.DocumentID) ||
    normalizePostingValue(posting?.documentId) ||
    normalizePostingValue(posting?.external_id) ||
    normalizePostingValue(posting?.externalId) ||
    normalizePostingValue(posting?.vacancyId) ||
    normalizePostingValue(posting?.JobControl) ||
    normalizePostingValue(posting?.jobNum) ||
    normalizePostingValue(posting?.JobNum) ||
    normalizePostingValue(posting?.openingId) ||
    normalizePostingValue(posting?.opening_id) ||
    normalizePostingValue(posting?.requisition_id) ||
    normalizePostingValue(posting?.requisitionId);
  const seenEpoch = Number(options?.nowEpoch || options?.lastSeenEpoch || 0) || null;
  const firstSeenEpoch = Number(options?.firstSeenEpoch || seenEpoch || 0) || null;
  const lastSeenEpoch = Number(options?.lastSeenEpoch || seenEpoch || 0) || null;
  return {
    ...posting,
    ats_key: atsKey,
    source_job_id: sourceJobId,
    canonical_url: jobPostingUrl,
    apply_url: applyUrl || jobPostingUrl,
    title: positionName,
    company: companyName,
    company_name: companyName,
    position_name: positionName,
    job_posting_url: jobPostingUrl,
    location_text: location,
    location,
    posting_date: postingDate.raw,
    posted_at: postingDate.raw,
    posting_date_epoch: postingDate.epoch,
    posted_at_epoch: postingDate.epoch,
    country,
    region,
    remote_type: remoteType,
    industry: firstValue([posting?.industry, posting?.department, posting?.team, posting?.category]),
    first_seen: epochToIso(firstSeenEpoch),
    last_seen: epochToIso(lastSeenEpoch),
    first_seen_epoch: firstSeenEpoch,
    last_seen_epoch: lastSeenEpoch,
    parser_version: parserVersion,
    raw_hash: stablePayloadHash(posting),
    confidence: normalizeConfidence(options?.confidence, 0.5),
    is_remote: remoteType === "remote" || remoteType === "hybrid"
  };
}

function validatePosting(posting) {
  const url = normalizePostingValue(posting?.canonical_url || posting?.job_posting_url);
  const companyName = normalizePostingValue(posting?.company_name || posting?.company);
  const positionName = normalizePostingValue(posting?.position_name || posting?.title);
  const normalizedTitle = normalizeSearchText(positionName);
  const normalizedCompany = normalizeSearchText(companyName);

  if (!url) {
    return { ok: false, error: "missing job_posting_url" };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "invalid job_posting_url" };
  }
  if (!companyName) {
    return { ok: false, error: "missing company_name" };
  }
  if (isPlaceholderCompanyName(normalizedCompany)) {
    return { ok: false, error: "placeholder company_name" };
  }
  if (!positionName) {
    return { ok: false, error: "missing position_name" };
  }
  if (["untitled", "untitled position", "unknown", "unknown position", "unknown job"].includes(normalizedTitle)) {
    return { ok: false, error: "placeholder position_name" };
  }
  return { ok: true, error: "" };
}

module.exports = {
  canonicalizePostingUrl,
  extractLocationText,
  isPlaceholderCompanyName,
  normalizeCountryFromLocation,
  normalizeCountryName,
  normalizePosting,
  normalizePostingDate,
  normalizePostingValue,
  normalizeRegionFromCountry,
  normalizeRemoteType,
  stablePayloadHash,
  validatePosting
};
