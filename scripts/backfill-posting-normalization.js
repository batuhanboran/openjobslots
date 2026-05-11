const { createPostgresPool, ensurePostgresSchema } = require("../server/backends/postgres");
const { acquireHeavyJobLock } = require("../server/backends/heavyJobLock");
const {
  normalizePosting,
  normalizePostingDate,
  normalizePostingValue,
  normalizeRegionFromCountry,
  validatePosting
} = require("../server/ingestion/posting");

const SAFE_BACKFILL_FIELDS = Object.freeze([
  "country",
  "region",
  "city",
  "remote_type",
  "source_job_id",
  "department",
  "employment_type",
  "description_plain",
  "posted_at_epoch_from_existing_posting_date"
]);

const REFETCH_REQUIRED_FIELDS = Object.freeze([
  "title",
  "company",
  "canonical_url",
  "apply_url",
  "description_html",
  "posted_at_when_source_date_is_absent",
  "posted_at_epoch_when_source_date_is_absent",
  "parser_confidence_without_existing_parser_metadata"
]);

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberOption(value, fallback, min, max) {
  const parsed = Number(value);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function parseBackfillArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    atsFilter: parseList(env.OPENJOBSLOTS_BACKFILL_ATS || ""),
    batchSize: parseNumberOption(env.OPENJOBSLOTS_BACKFILL_BATCH_SIZE || 2000, 2000, 100, 10000),
    limit: parseNumberOption(env.OPENJOBSLOTS_BACKFILL_LIMIT || 0, 0, 0, Number.MAX_SAFE_INTEGER),
    sampleLimit: parseNumberOption(env.OPENJOBSLOTS_BACKFILL_SAMPLE_LIMIT || 10, 10, 0, 100),
    startAfter: String(env.OPENJOBSLOTS_BACKFILL_START_AFTER || "").trim(),
    write: String(env.OPENJOBSLOTS_BACKFILL_WRITE || "").trim() === "1"
  };

  for (const arg of argv) {
    if (arg === "--write") {
      options.write = true;
    } else if (arg === "--dry-run") {
      options.write = false;
    } else if (arg.startsWith("--ats=")) {
      options.atsFilter = parseList(arg.slice("--ats=".length));
    } else if (arg.startsWith("--limit=")) {
      options.limit = parseNumberOption(arg.slice("--limit=".length), options.limit, 0, Number.MAX_SAFE_INTEGER);
    } else if (arg.startsWith("--batch-size=")) {
      options.batchSize = parseNumberOption(arg.slice("--batch-size=".length), options.batchSize, 100, 10000);
    } else if (arg.startsWith("--sample-limit=")) {
      options.sampleLimit = parseNumberOption(arg.slice("--sample-limit=".length), options.sampleLimit, 0, 100);
    } else if (arg.startsWith("--start-after=")) {
      options.startAfter = String(arg.slice("--start-after=".length) || "").trim();
    }
  }

  options.dryRun = !options.write;
  return options;
}

function decodePathText(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function formatLocationSegment(value) {
  return decodePathText(value)
    .replace(/--+/g, " - ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSourceJobIdFromUrl(row) {
  const current = String(row.source_job_id || "").trim();
  if (current) return current;
  const atsKey = String(row.ats_key || "").trim().toLowerCase();
  try {
    const parsed = new URL(String(row.canonical_url || ""));
    const path = parsed.pathname;
    const pathParts = path.split("/").filter(Boolean).map((part) => decodePathText(part));
    const lastPathPart = pathParts[pathParts.length - 1] || "";
    const lastStablePart = String(lastPathPart || "").replace(/\?.*$/, "").trim();
    const queryFirst = (...keys) => {
      for (const key of keys) {
        const value = String(parsed.searchParams.get(key) || "").trim();
        if (value) return value;
      }
      return "";
    };
    if (atsKey === "workday") return decodePathText(path.split("/").filter(Boolean).pop() || "").match(/_([A-Za-z0-9-]+)$/)?.[1] || "";
    if (atsKey === "taleo") return String(parsed.searchParams.get("job") || "").trim();
    if (atsKey === "applytojob") return path.match(/\/apply\/([^/]+)/i)?.[1] || "";
    if (atsKey === "breezy") return path.match(/\/p\/([^/]+)/i)?.[1] || "";
    if (atsKey === "icims") return path.match(/\/jobs\/(\d+)/i)?.[1] || "";
    if (atsKey === "applitrack") return String(parsed.searchParams.get("JobID") || parsed.searchParams.get("jobid") || "").trim();
    if (atsKey === "bamboohr") return path.match(/\/careers\/([^/]+)/i)?.[1] || "";
    if (atsKey === "recruitee") return path.match(/\/o\/([^/]+)/i)?.[1] || "";
    if (atsKey === "greenhouse") return queryFirst("gh_jid") || path.match(/\/jobs\/(\d+)/i)?.[1] || lastStablePart;
    if (atsKey === "lever" || atsKey === "ashby") return lastStablePart;
    if (atsKey === "smartrecruiters") return lastStablePart.match(/^(\d+)/)?.[1] || lastStablePart;
    if (atsKey === "manatal" || atsKey === "careerspage") return path.match(/\/job\/([^/]+)/i)?.[1] || lastStablePart;
    if (atsKey === "hrmdirect") return queryFirst("req", "reqid");
    if (atsKey === "zoho") return lastStablePart;
    if (atsKey === "recruitcrm") return lastStablePart;
    if (atsKey === "pinpointhq") return path.match(/\/postings\/([^/]+)/i)?.[1] || lastStablePart;
    if (atsKey === "jobvite") return path.match(/\/job\/([^/]+)/i)?.[1] || lastStablePart;
    if (atsKey === "careerplug") return path.match(/\/jobs\/([^/]+)/i)?.[1] || lastStablePart;
    if (atsKey === "teamtailor") return path.match(/\/jobs\/([^/]+)/i)?.[1] || lastStablePart.match(/^(\d+)/)?.[1] || lastStablePart;
    if (atsKey === "brassring") return queryFirst("jobid", "jobId", "reqid");
    if (atsKey === "governmentjobs") return path.match(/\/jobs\/(\d+)/i)?.[1] || queryFirst("jobid", "jobId");
    if (atsKey === "jobaps") return queryFirst("JobNum", "jobnum", "JobID", "jobid") || lastStablePart;
    if (atsKey === "applicantpro") return path.match(/\/jobs\/([^/]+)/i)?.[1] || lastStablePart;
    if (atsKey === "talentreef") return queryFirst("jobId", "jobid") || path.match(/\/jobs?\/([^/]+)/i)?.[1] || lastStablePart;
    if (atsKey === "oracle") return path.match(/\/job\/([^/]+)/i)?.[1] || queryFirst("job", "jobId", "id") || lastStablePart;
    if (atsKey === "adp_workforcenow" || atsKey === "adpworkforcenow") return queryFirst("jobId", "jobid", "job") || lastStablePart;
    if (atsKey === "adp_myjobs" || atsKey === "adpmyjobs") return queryFirst("jobId", "jobid", "reqId", "reqid") || lastStablePart;
    if (atsKey === "paylocity") return path.match(/\/jobs?\/details\/([^/]+)/i)?.[1] || queryFirst("jobId", "jobid") || lastStablePart;
    if (atsKey === "oracle" || atsKey === "ultipro" || atsKey === "pageup" || atsKey === "eightfold") return queryFirst("jobId", "jobid", "id", "reqId", "reqid") || lastStablePart;
    if (lastStablePart && !["jobs", "careers", "employment", "job-opening.php"].includes(lastStablePart.toLowerCase())) {
      return lastStablePart;
    }
  } catch {
    return "";
  }
  return "";
}

function extractIcimsTitleLocation(title, canonicalUrl) {
  const candidates = [];
  const titleText = String(title || "");
  for (const match of titleText.matchAll(/\(([^)]+)\)/g)) {
    if (match?.[1]) candidates.push(match[1]);
  }
  const dashParts = titleText.split(/\s+[-–—]{1,2}\s+/).map((part) => part.trim()).filter(Boolean);
  if (dashParts.length > 1) candidates.push(dashParts[dashParts.length - 1]);
  try {
    const parsed = new URL(String(canonicalUrl || ""));
    const parts = parsed.pathname.split("/").map((part) => formatLocationSegment(part)).filter(Boolean);
    const jobsIndex = parts.findIndex((part) => part.toLowerCase() === "jobs");
    if (jobsIndex >= 0 && parts[jobsIndex + 2]) candidates.push(parts[jobsIndex + 2]);
  } catch {
    // Ignore URL fallback.
  }
  for (const candidate of candidates) {
    const cleaned = normalizePostingValue(candidate);
    if (!cleaned || cleaned.length > 100) continue;
    if (/\b(remote|hybrid|work from home|telework|virtual)\b/i.test(cleaned)) return cleaned;
    if (/[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(cleaned)) return cleaned;
    if (/\b(United States|USA|US|Canada|Turkey|Turkiye|Netherlands|Nederland|Niederlande|Austria|Osterreich|Taiwan|China|Korea|Ulsan|Hsin Chu|Hsinchu)\b/i.test(cleaned)) {
      return cleaned;
    }
  }
  return "";
}

function extractLocationFromUrl(row) {
  const current = String(row.location_text || "").trim();
  if (current) return current;
  const atsKey = String(row.ats_key || "").trim().toLowerCase();
  try {
    const parsed = new URL(String(row.canonical_url || ""));
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (atsKey === "workday") {
      const jobIndex = parts.findIndex((part) => part.toLowerCase() === "job");
      if (jobIndex >= 0 && parts[jobIndex + 1]) return formatLocationSegment(parts[jobIndex + 1]);
    }
  } catch {
    // Continue with title fallback.
  }
  if (atsKey === "icims") return extractIcimsTitleLocation(row.position_name, row.canonical_url);
  if (/\b(remote|hybrid|work from home|telework|virtual)\b/i.test(String(row.position_name || ""))) return "Remote";
  return "";
}

function normalizePostingDateForBackfill(value) {
  const raw = String(value || "").trim();
  if (/^(?:true|false|null|undefined)$/i.test(raw)) return null;
  return raw || null;
}

function postedEpochFromBackfillDate(value, referenceEpoch) {
  const raw = normalizePostingDateForBackfill(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const baseEpoch = Number(referenceEpoch || 0) || Math.floor(Date.now() / 1000);
  if (normalized === "posted today" || normalized === "today") return baseEpoch;
  if (normalized === "posted yesterday" || normalized === "yesterday") return baseEpoch - 24 * 60 * 60;
  const relativeHours = normalized.match(/^posted\s+(\d+)\s+hour(?:s)?\s+ago$/) || normalized.match(/^(\d+)\s+hour(?:s)?\s+ago$/);
  if (relativeHours?.[1]) return baseEpoch - Number(relativeHours[1]) * 60 * 60;
  const relativeDays = normalized.match(/^posted\s+(\d+)\s+day(?:s)?\s+ago$/) || normalized.match(/^(\d+)\s+day(?:s)?\s+ago$/);
  if (relativeDays?.[1]) return baseEpoch - Number(relativeDays[1]) * 24 * 60 * 60;
  return normalizePostingDate(raw).epoch;
}

function shouldReplaceStoredCountry(row, normalizedCountry) {
  const currentCountry = String(row.country || "").trim();
  const nextCountry = String(normalizedCountry || "").trim();
  if (!nextCountry || !currentCountry || nextCountry === currentCountry) return false;
  const atsKey = String(row.ats_key || "").trim().toLowerCase();
  const location = String(row.location_text || "").trim();
  if (atsKey === "icims" && /^[A-Z]{2,3}[-\s]/.test(location)) return true;
  return false;
}

function deriveApplitrackDepartmentFromTitle(row) {
  if (String(row.ats_key || "").trim().toLowerCase() !== "applitrack") return "";
  const title = String(row.position_name || "").trim();
  const parts = title.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const department = parts.length > 1 ? parts[0] : "";
  if (!department || department.length > 80) return "";
  if (/^(job|position|opening|unknown|untitled|n\/?a)$/i.test(department)) return "";
  return department;
}

function deriveDepartmentForBackfill(row, normalized) {
  const current = String(row.department || "").trim();
  if (current) return current;
  const fromNormalized = String(normalized.department || "").trim();
  if (fromNormalized) return fromNormalized;
  const fromSourceCategory = String(row.industry || "").trim();
  if (fromSourceCategory) return fromSourceCategory;
  return deriveApplitrackDepartmentFromTitle(row);
}

function deriveEmploymentTypeForBackfill(row, normalized) {
  const current = String(row.employment_type || "").trim();
  if (current) return current;
  return String(normalized.employment_type || "").trim();
}

function deriveDescriptionPlainForBackfill(row, normalized) {
  const current = String(row.description_plain || "").trim();
  if (current) return current;
  return String(normalized.description_plain || "").trim();
}

function shouldChange(row, normalized) {
  const currentCountry = String(row.country || "").trim();
  const currentRegion = String(row.region || "").trim();
  const currentCity = String(row.city || "").trim();
  const currentRemoteType = String(row.remote_type || "unknown").trim() || "unknown";
  const currentLocationText = String(row.location_text || "").trim();
  const currentSourceJobId = String(row.source_job_id || "").trim();
  const currentPostingDateRaw = String(row.posting_date || "").trim();
  const currentPostingDate = normalizePostingDateForBackfill(row.posting_date);
  const currentPostedAtEpoch = Number(row.posted_at_epoch || 0) || null;
  const currentDepartment = String(row.department || "").trim();
  const currentEmploymentType = String(row.employment_type || "").trim();
  const currentDescriptionPlain = String(row.description_plain || "").trim();
  const normalizedCountry = String(normalized.country || "").trim();
  const nextCountry =
    shouldReplaceStoredCountry(row, normalizedCountry) || !currentCountry
      ? normalizedCountry || currentCountry
      : currentCountry;
  const nextRegion =
    nextCountry !== currentCountry
      ? String(normalized.region || normalizeRegionFromCountry(nextCountry) || "").trim()
      : currentRegion || String(normalized.region || normalizeRegionFromCountry(nextCountry) || "").trim();
  const nextCity = currentCity || String(normalized.city || "").trim();
  const nextRemoteType =
    currentRemoteType === "unknown"
      ? String(normalized.remote_type || "unknown").trim() || "unknown"
      : currentRemoteType;
  const nextLocationText = currentLocationText || String(normalized.location_text || normalized.location || "").trim();
  const nextSourceJobId = currentSourceJobId || String(normalized.source_job_id || "").trim();
  const nextPostingDate = currentPostingDate;
  const nextPostedAtEpoch =
    currentPostedAtEpoch ||
    Number(normalized.posted_at_epoch || normalized.posting_date_epoch || 0) ||
    (nextPostingDate ? postedEpochFromBackfillDate(nextPostingDate, row.last_seen_epoch) : null);
  const nextDepartment = deriveDepartmentForBackfill(row, normalized);
  const nextEmploymentType = deriveEmploymentTypeForBackfill(row, normalized);
  const nextDescriptionPlain = deriveDescriptionPlainForBackfill(row, normalized);

  return {
    changed:
      nextCountry !== currentCountry ||
      nextRegion !== currentRegion ||
      nextCity !== currentCity ||
      nextRemoteType !== currentRemoteType ||
      nextLocationText !== currentLocationText ||
      nextSourceJobId !== currentSourceJobId ||
      (currentPostingDateRaw && nextPostingDate !== currentPostingDateRaw) ||
      nextPostedAtEpoch !== currentPostedAtEpoch ||
      nextDepartment !== currentDepartment ||
      nextEmploymentType !== currentEmploymentType ||
      nextDescriptionPlain !== currentDescriptionPlain,
    nextCountry,
    nextRegion,
    nextCity,
    nextRemoteType,
    nextLocationText,
    nextSourceJobId,
    nextPostingDate,
    nextPostedAtEpoch,
    nextDepartment,
    nextEmploymentType,
    nextDescriptionPlain
  };
}

function toSearchPayload(row, next) {
  return {
    canonical_url: row.canonical_url,
    company_name: row.company_name,
    position_name: row.position_name,
    apply_url: row.apply_url,
    location_text: next.nextLocationText || row.location_text,
    city: next.nextCity || row.city,
    country: next.nextCountry,
    region: next.nextRegion,
    remote_type: next.nextRemoteType,
    industry: row.industry,
    ats_key: row.ats_key,
    source_job_id: next.nextSourceJobId || row.source_job_id,
    posting_date: next.nextPostingDate,
    posted_at_epoch: next.nextPostedAtEpoch || row.posted_at_epoch,
    last_seen_epoch: row.last_seen_epoch,
    hidden: row.hidden,
    department: next.nextDepartment || row.department,
    employment_type: next.nextEmploymentType || row.employment_type,
    description_plain: next.nextDescriptionPlain || row.description_plain
  };
}

function buildCandidateForNormalization(row) {
  return {
    ...row,
    country: "",
    region: "",
    source_job_id: extractSourceJobIdFromUrl(row),
    location_text: extractLocationFromUrl(row),
    job_posting_url: row.canonical_url,
    posting_date: normalizePostingDateForBackfill(row.posting_date)
  };
}

function normalizeRowForBackfill(row) {
  return normalizePosting(
    buildCandidateForNormalization(row),
    { company_name: row.company_name },
    row.ats_key,
    {
      parserVersion: row.parser_version,
      confidence: row.confidence,
      firstSeenEpoch: row.first_seen_epoch,
      lastSeenEpoch: row.last_seen_epoch
    }
  );
}

function getChangedFields(row, next) {
  const fields = [];
  const checks = [
    ["location_text", String(row.location_text || "").trim(), next.nextLocationText],
    ["city", String(row.city || "").trim(), next.nextCity],
    ["country", String(row.country || "").trim(), next.nextCountry],
    ["region", String(row.region || "").trim(), next.nextRegion],
    ["remote_type", String(row.remote_type || "unknown").trim() || "unknown", next.nextRemoteType],
    ["source_job_id", String(row.source_job_id || "").trim(), next.nextSourceJobId],
    ["posting_date", String(row.posting_date || "").trim(), next.nextPostingDate],
    ["posted_at_epoch", Number(row.posted_at_epoch || 0) || null, next.nextPostedAtEpoch],
    ["department", String(row.department || "").trim(), next.nextDepartment],
    ["employment_type", String(row.employment_type || "").trim(), next.nextEmploymentType],
    ["description_plain", String(row.description_plain || "").trim(), next.nextDescriptionPlain]
  ];
  for (const [field, before, after] of checks) {
    if (String(before ?? "") !== String(after ?? "")) fields.push(field);
  }
  return fields;
}

function incrementMap(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function incrementNestedMap(map, key, nestedKey, amount = 1) {
  if (!map.has(key)) map.set(key, new Map());
  incrementMap(map.get(key), nestedKey, amount);
}

function getStoredRowRejectionReason(row) {
  const validation = validatePosting({
    canonical_url: row?.canonical_url,
    job_posting_url: row?.canonical_url,
    company_name: row?.company_name,
    position_name: row?.position_name
  });
  return validation.ok ? "" : validation.error || "invalid posting";
}

function recordRejectedRow(summary, row, reason, options) {
  const normalizedReason = String(reason || "invalid posting").trim();
  summary.rejected += 1;
  incrementMap(summary.rejectedByReason, normalizedReason);
  incrementNestedMap(summary.rejectedByAtsAndReason, String(row?.ats_key || "unknown"), normalizedReason);
  if (summary.rejectedSamples.length < options.sampleLimit) {
    summary.rejectedSamples.push({
      ats_key: row?.ats_key || "",
      canonical_url: row?.canonical_url || "",
      reason: normalizedReason
    });
  }
}

function evaluateRowsForBackfill(rows, summary, options) {
  const changes = [];
  for (const row of rows) {
    let normalized;
    try {
      normalized = normalizeRowForBackfill(row);
    } catch (error) {
      recordRejectedRow(summary, row, `normalization failed: ${String(error?.message || error).slice(0, 120)}`, options);
      continue;
    }

    const rejectionReason = getStoredRowRejectionReason({
      ...row,
      canonical_url: normalized.canonical_url || row.canonical_url,
      company_name: normalized.company_name || row.company_name,
      position_name: normalized.position_name || row.position_name
    });
    if (rejectionReason) {
      recordRejectedRow(summary, row, rejectionReason, options);
      continue;
    }

    const next = shouldChange(row, normalized);
    if (!next.changed) continue;
    changes.push({ row, next, changedFields: getChangedFields(row, next) });
  }
  return changes;
}

function sortedObjectFromMap(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function nestedObjectFromMap(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([key, value]) => [
    key,
    sortedObjectFromMap(value)
  ]));
}

function summarizeSample(row, next, changedFields) {
  const before = {};
  const after = {};
  for (const field of changedFields) {
    before[field] = field === "posted_at_epoch" ? row.posted_at_epoch : row[field];
    const nextKey = `next${field.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}`;
    after[field] = next[nextKey];
  }
  return {
    ats_key: row.ats_key,
    canonical_url: row.canonical_url,
    changed_fields: changedFields,
    before,
    after
  };
}

function isTransientWriteError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "").toLowerCase();
  return ["40001", "40P01", "55P03", "53300", "57P03"].includes(code) ||
    /deadlock|serialization|lock timeout|too many connections|connection terminated|timeout/.test(message);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeBatchWithRetry(pool, changes, summary, options) {
  if (changes.length === 0) return;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const change of changes) {
        const { row, next } = change;
        await client.query(
          `
            UPDATE postings
            SET location_text = NULLIF($2, ''),
                city = $3,
                country = $4,
                region = $5,
                remote_type = $6,
                source_job_id = $7,
                posting_date = $8,
                posted_at_epoch = $9,
                department = $10,
                employment_type = $11,
                description_plain = $12,
                updated_at = now()
            WHERE canonical_url = $1;
          `,
          [
            row.canonical_url,
            next.nextLocationText,
            next.nextCity,
            next.nextCountry,
            next.nextRegion,
            next.nextRemoteType,
            next.nextSourceJobId,
            next.nextPostingDate,
            next.nextPostedAtEpoch,
            next.nextDepartment,
            next.nextEmploymentType,
            next.nextDescriptionPlain
          ]
        );
        await client.query(
          `
            UPDATE posting_cache
            SET location_text = NULLIF($2, ''),
                city = $3,
                country = $4,
                region = $5,
                remote_type = $6,
                source_job_id = $7,
                posting_date = $8,
                posted_at_epoch = $9,
                department = $10,
                employment_type = $11,
                description_plain = $12,
                updated_at = now()
            WHERE canonical_url = $1;
          `,
          [
            row.canonical_url,
            next.nextLocationText,
            next.nextCity,
            next.nextCountry,
            next.nextRegion,
            next.nextRemoteType,
            next.nextSourceJobId,
            next.nextPostingDate,
            next.nextPostedAtEpoch,
            next.nextDepartment,
            next.nextEmploymentType,
            next.nextDescriptionPlain
          ]
        );
        await client.query(
          `
            INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at)
            VALUES ($1, 'upsert', $2::jsonb, now());
          `,
          [row.canonical_url, JSON.stringify(toSearchPayload(row, next))]
        );

      }
      await client.query("COMMIT");
      mergeCommittedChanges(summary, changes, options);
      return;
    } catch (error) {
      await client.query("ROLLBACK");
      if (attempt >= maxAttempts || !isTransientWriteError(error)) throw error;
      await sleep(250 * attempt);
    } finally {
      client.release();
    }
  }
}

function mergeCommittedChanges(summary, changes, options) {
  for (const change of changes) {
    summary.changed += 1;
    incrementMap(summary.changedByAts, change.row.ats_key);
    for (const field of change.changedFields) {
      incrementMap(summary.changedByField, field);
      incrementNestedMap(summary.changedByAtsAndField, change.row.ats_key, field);
    }
    if (summary.samples.length < options.sampleLimit) {
      summary.samples.push(summarizeSample(change.row, change.next, change.changedFields));
    }
  }
}

function buildCandidateQuery(atsFilter) {
  const atsClause = atsFilter.length > 0 ? "AND ats_key = ANY($3::text[])" : "";
  return `
    SELECT
      canonical_url,
      company_name,
      position_name,
      apply_url,
      location_text,
      city,
      country,
      region,
      remote_type,
      industry,
      department,
      employment_type,
      description_plain,
      description_html,
      ats_key,
      source_job_id,
      posting_date,
      posted_at_epoch,
      first_seen_epoch,
      last_seen_epoch,
      hidden,
      parser_version,
      confidence
    FROM postings
    WHERE hidden = false
      AND canonical_url > $1
      AND btrim(coalesce(position_name, '')) <> ''
      AND btrim(coalesce(company_name, '')) <> ''
      AND btrim(coalesce(canonical_url, '')) ~* '^https?://'
      AND position_name !~* '^(untitled|unknown|n/?a|not available|job opening|new job|open position|position)$'
      AND (
        country = ''
        OR region = ''
        OR city = ''
        OR remote_type = 'unknown'
        OR source_job_id = ''
        OR (
          btrim(coalesce(department, '')) = ''
          AND (
            btrim(coalesce(industry, '')) <> ''
            OR ats_key = 'applitrack'
          )
        )
        OR posting_date in ('false', 'true', 'null', 'undefined')
        OR (
          posted_at_epoch IS NULL
          AND posting_date IS NOT NULL
          AND btrim(posting_date) <> ''
          AND lower(posting_date) NOT IN ('false', 'true', 'null', 'undefined')
        )
        OR (
          coalesce(location_text, '') = ''
          AND ats_key = ANY(ARRAY['workday','icims']::text[])
        )
        OR (
          ats_key = 'icims'
          AND location_text ~ '^[A-Z]{2,3}[-[:space:]]'
        )
      )
      AND (
        coalesce(location_text, '') <> ''
        OR position_name ~* '(remote|hybrid|telework|work from home|home office)'
        OR ats_key = ANY(ARRAY['workday','icims','applitrack','taleo','applytojob','breezy','bamboohr','recruitee']::text[])
      )
      ${atsClause}
    ORDER BY canonical_url ASC
    LIMIT $2;
  `;
}

function buildRejectedRowsQuery(atsFilter) {
  const atsClause = atsFilter.length > 0 ? "AND ats_key = ANY($1::text[])" : "";
  return `
    WITH rejected AS (
      SELECT
        ats_key,
        CASE
          WHEN btrim(coalesce(canonical_url, '')) = '' THEN 'missing job_posting_url'
          WHEN btrim(coalesce(canonical_url, '')) !~* '^https?://' THEN 'invalid job_posting_url'
          WHEN btrim(coalesce(company_name, '')) = '' THEN 'missing company_name'
          WHEN lower(btrim(coalesce(company_name, ''))) IN ('unknown', 'unknown company', 'unknown employer', 'n/a', 'na', 'none') THEN 'placeholder company_name'
          WHEN btrim(coalesce(position_name, '')) = '' THEN 'missing position_name'
          WHEN lower(btrim(coalesce(position_name, ''))) ~ '^(untitled|untitled position|unknown|unknown position|unknown job|n/?a|not available|job opening|new job|open position|position)$' THEN 'placeholder position_name'
          ELSE ''
        END AS reason
      FROM postings
      WHERE hidden = false
        ${atsClause}
    )
    SELECT ats_key, reason, COUNT(*)::int AS count
    FROM rejected
    WHERE reason <> ''
    GROUP BY ats_key, reason
    ORDER BY count DESC, ats_key ASC, reason ASC;
  `;
}

async function loadExistingRejectedRows(pool, options) {
  const params = options.atsFilter.length > 0 ? [options.atsFilter] : [];
  const result = await pool.query(buildRejectedRowsQuery(options.atsFilter), params);
  return result.rows || [];
}

function mergeExistingRejectedRows(summary, rows) {
  for (const row of rows || []) {
    const count = Number(row.count || 0);
    if (!count) continue;
    summary.existingInvalidRows += count;
    incrementMap(summary.existingInvalidRowsByReason, row.reason, count);
    incrementNestedMap(summary.existingInvalidRowsByAtsAndReason, row.ats_key || "unknown", row.reason, count);
  }
}

async function runBackfill(pool, options = parseBackfillArgs(), deps = {}) {
  const logger = deps.logger || console.log;
  const ensureSchema = deps.ensureSchema || ensurePostgresSchema;
  const useHeavyJobLock = deps.useHeavyJobLock === true;
  const summary = {
    ok: true,
    scanned: 0,
    changed: 0,
    dry_run: options.dryRun,
    write: options.write,
    ats_filter: options.atsFilter,
    start_after: options.startAfter,
    changedByAts: new Map(),
    changedByField: new Map(),
    changedByAtsAndField: new Map(),
    rejected: 0,
    rejectedByReason: new Map(),
    rejectedByAtsAndReason: new Map(),
    rejectedSamples: [],
    existingInvalidRows: 0,
    existingInvalidRowsByReason: new Map(),
    existingInvalidRowsByAtsAndReason: new Map(),
    samples: []
  };
  let lastCanonicalUrl = String(options.startAfter || "");
  let heavyJobLock = null;
  let failed = false;

  try {
    if (useHeavyJobLock) {
      heavyJobLock = await acquireHeavyJobLock(
        pool,
        options.write ? "normalization-backfill" : "normalization-backfill-dry-run"
      );
    }
    if (options.write) await ensureSchema(pool);
    mergeExistingRejectedRows(summary, await loadExistingRejectedRows(pool, options));

    while (true) {
      if (options.limit > 0 && summary.scanned >= options.limit) break;
      const remainingLimit = options.limit > 0 ? Math.min(options.batchSize, options.limit - summary.scanned) : options.batchSize;
      const params = [lastCanonicalUrl, remainingLimit];
      if (options.atsFilter.length > 0) params.push(options.atsFilter);
      const result = await pool.query(buildCandidateQuery(options.atsFilter), params);

      const rows = result.rows || [];
      if (rows.length === 0) break;

      for (const row of rows) {
        summary.scanned += 1;
        lastCanonicalUrl = String(row.canonical_url || "");
      }

      if (options.write) {
        await writeBatchWithRetry(pool, evaluateRowsForBackfill(rows, summary, options), summary, options);
      } else {
        mergeCommittedChanges(summary, evaluateRowsForBackfill(rows, summary, options), options);
      }

      logger(JSON.stringify(formatSummary(summary, true)));
    }

    const finalSummary = formatSummary(summary, false);
    logger(JSON.stringify(finalSummary));
    return finalSummary;
  } catch (error) {
    summary.ok = false;
    failed = true;
    throw error;
  } finally {
    if (heavyJobLock) await heavyJobLock.release(failed ? "failed" : "succeeded");
    if (typeof pool.end === "function") await pool.end();
  }
}

function formatSummary(summary, compact = false) {
  const formatted = {
    ok: true,
    scanned: summary.scanned,
    changed: summary.changed,
    dry_run: summary.dry_run,
    write: summary.write,
    ats_filter: summary.ats_filter,
    start_after: summary.start_after,
    safe_backfill_fields: SAFE_BACKFILL_FIELDS,
    refetch_required_fields: REFETCH_REQUIRED_FIELDS,
    changed_by_ats: sortedObjectFromMap(summary.changedByAts),
    changed_by_field: sortedObjectFromMap(summary.changedByField),
    changed_by_ats_and_field: nestedObjectFromMap(summary.changedByAtsAndField),
    rejected: summary.rejected,
    rejected_by_reason: sortedObjectFromMap(summary.rejectedByReason),
    rejected_by_ats_and_reason: nestedObjectFromMap(summary.rejectedByAtsAndReason),
    existing_invalid_rows: summary.existingInvalidRows,
    existing_invalid_rows_by_reason: sortedObjectFromMap(summary.existingInvalidRowsByReason),
    existing_invalid_rows_by_ats_and_reason: nestedObjectFromMap(summary.existingInvalidRowsByAtsAndReason)
  };
  if (!compact) {
    formatted.samples = summary.samples;
    formatted.rejected_samples = summary.rejectedSamples;
  }
  return formatted;
}

async function main() {
  const pool = createPostgresPool();
  await runBackfill(pool, parseBackfillArgs(), { useHeavyJobLock: true });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildCandidateForNormalization,
  buildCandidateQuery,
  buildRejectedRowsQuery,
  extractSourceJobIdFromUrl,
  formatSummary,
  getChangedFields,
  getStoredRowRejectionReason,
  normalizeRowForBackfill,
  parseBackfillArgs,
  runBackfill,
  shouldChange,
  toSearchPayload
};
