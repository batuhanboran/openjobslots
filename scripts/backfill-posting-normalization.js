const { createPostgresPool, ensurePostgresSchema } = require("../server/backends/postgres");
const {
  normalizePosting,
  normalizePostingValue,
  normalizeRegionFromCountry
} = require("../server/ingestion/posting");

const BATCH_SIZE = Math.max(100, Math.min(10000, Number(process.env.OPENJOBSLOTS_BACKFILL_BATCH_SIZE || 2000)));
const LIMIT = Math.max(0, Number(process.env.OPENJOBSLOTS_BACKFILL_LIMIT || 0));
const DRY_RUN = String(process.env.OPENJOBSLOTS_BACKFILL_DRY_RUN || "").trim() === "1";
const ATS_FILTER = String(process.env.OPENJOBSLOTS_BACKFILL_ATS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

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

function shouldChange(row, normalized) {
  const currentCountry = String(row.country || "").trim();
  const currentRegion = String(row.region || "").trim();
  const currentRemoteType = String(row.remote_type || "unknown").trim() || "unknown";
  const currentLocationText = String(row.location_text || "").trim();
  const currentSourceJobId = String(row.source_job_id || "").trim();
  const currentPostingDateRaw = String(row.posting_date || "").trim();
  const currentPostingDate = normalizePostingDateForBackfill(row.posting_date);
  const nextCountry = currentCountry || String(normalized.country || "").trim();
  const nextRegion = currentRegion || String(normalized.region || normalizeRegionFromCountry(nextCountry) || "").trim();
  const nextRemoteType =
    currentRemoteType === "unknown"
      ? String(normalized.remote_type || "unknown").trim() || "unknown"
      : currentRemoteType;
  const nextLocationText = currentLocationText || String(normalized.location_text || normalized.location || "").trim();
  const nextSourceJobId = currentSourceJobId || String(normalized.source_job_id || "").trim();
  const nextPostingDate = currentPostingDate;

  return {
    changed:
      nextCountry !== currentCountry ||
      nextRegion !== currentRegion ||
      nextRemoteType !== currentRemoteType ||
      nextLocationText !== currentLocationText ||
      nextSourceJobId !== currentSourceJobId ||
      (currentPostingDateRaw && nextPostingDate !== currentPostingDateRaw),
    nextCountry,
    nextRegion,
    nextRemoteType,
    nextLocationText,
    nextSourceJobId,
    nextPostingDate
  };
}

function toSearchPayload(row, next) {
  return {
    canonical_url: row.canonical_url,
    company_name: row.company_name,
    position_name: row.position_name,
    apply_url: row.apply_url,
    location_text: next.nextLocationText || row.location_text,
    country: next.nextCountry,
    region: next.nextRegion,
    remote_type: next.nextRemoteType,
    industry: row.industry,
    ats_key: row.ats_key,
    source_job_id: next.nextSourceJobId || row.source_job_id,
    posting_date: next.nextPostingDate,
    posted_at_epoch: row.posted_at_epoch,
    last_seen_epoch: row.last_seen_epoch,
    hidden: row.hidden
  };
}

async function main() {
  const pool = createPostgresPool();
  let scanned = 0;
  let changed = 0;
  let lastCanonicalUrl = "";
  const changedByAts = new Map();

  try {
    await ensurePostgresSchema(pool);

    while (true) {
      if (LIMIT > 0 && scanned >= LIMIT) break;
      const remainingLimit = LIMIT > 0 ? Math.min(BATCH_SIZE, LIMIT - scanned) : BATCH_SIZE;
      const params = [lastCanonicalUrl, remainingLimit];
      let atsClause = "";
      if (ATS_FILTER.length > 0) {
        params.push(ATS_FILTER);
        atsClause = `AND ats_key = ANY($${params.length}::text[])`;
      }

      const result = await pool.query(
        `
          SELECT
            canonical_url,
            company_name,
            position_name,
            apply_url,
            location_text,
            country,
            region,
            remote_type,
            industry,
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
            AND (
              country = ''
              OR region = ''
              OR remote_type = 'unknown'
              OR source_job_id = ''
              OR posting_date in ('false', 'true', 'null', 'undefined')
              OR (
                coalesce(location_text, '') = ''
                AND ats_key = ANY(ARRAY['workday','icims']::text[])
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
        `,
        params
      );

      const rows = result.rows || [];
      if (rows.length === 0) break;

      if (!DRY_RUN) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const row of rows) {
            scanned += 1;
            lastCanonicalUrl = String(row.canonical_url || "");
            const normalized = normalizePosting(
              {
                ...row,
                source_job_id: extractSourceJobIdFromUrl(row),
                location_text: extractLocationFromUrl(row),
                job_posting_url: row.canonical_url,
                posting_date: normalizePostingDateForBackfill(row.posting_date)
              },
              { company_name: row.company_name },
              row.ats_key,
              {
                parserVersion: row.parser_version,
                confidence: row.confidence,
                firstSeenEpoch: row.first_seen_epoch,
                lastSeenEpoch: row.last_seen_epoch
              }
            );
            const next = shouldChange(row, normalized);
            if (!next.changed) continue;

            await client.query(
              `
                UPDATE postings
                SET location_text = NULLIF($2, ''),
                    country = $3,
                    region = $4,
                    remote_type = $5,
                    source_job_id = $6,
                    posting_date = $7,
                    updated_at = now()
                WHERE canonical_url = $1;
              `,
              [
                row.canonical_url,
                next.nextLocationText,
                next.nextCountry,
                next.nextRegion,
                next.nextRemoteType,
                next.nextSourceJobId,
                next.nextPostingDate
              ]
            );
            await client.query(
              `
                UPDATE posting_cache
                SET location_text = NULLIF($2, ''),
                    country = $3,
                    region = $4,
                    remote_type = $5,
                    source_job_id = $6,
                    posting_date = $7,
                    updated_at = now()
                WHERE canonical_url = $1;
              `,
              [
                row.canonical_url,
                next.nextLocationText,
                next.nextCountry,
                next.nextRegion,
                next.nextRemoteType,
                next.nextSourceJobId,
                next.nextPostingDate
              ]
            );
            await client.query(
              `
                INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at)
                VALUES ($1, 'upsert', $2::jsonb, now());
              `,
              [row.canonical_url, JSON.stringify(toSearchPayload(row, next))]
            );
            changed += 1;
            changedByAts.set(row.ats_key, (changedByAts.get(row.ats_key) || 0) + 1);
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } else {
        for (const row of rows) {
          scanned += 1;
          lastCanonicalUrl = String(row.canonical_url || "");
          const normalized = normalizePosting(
            {
              ...row,
              source_job_id: extractSourceJobIdFromUrl(row),
              location_text: extractLocationFromUrl(row),
              job_posting_url: row.canonical_url,
              posting_date: normalizePostingDateForBackfill(row.posting_date)
            },
            { company_name: row.company_name },
            row.ats_key
          );
          const next = shouldChange(row, normalized);
          if (!next.changed) continue;
          changed += 1;
          changedByAts.set(row.ats_key, (changedByAts.get(row.ats_key) || 0) + 1);
        }
      }

      console.log(JSON.stringify({
        scanned,
        changed,
        dry_run: DRY_RUN,
        changed_by_ats: Object.fromEntries([...changedByAts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20))
      }));
    }

    console.log(JSON.stringify({
      ok: true,
      scanned,
      changed,
      dry_run: DRY_RUN,
      changed_by_ats: Object.fromEntries([...changedByAts.entries()].sort((a, b) => b[1] - a[1]))
    }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
