const { createPostgresPool, ensurePostgresSchema } = require("../server/backends/postgres");
const {
  buildApplitrackDetailUrl,
  extractApplitrackDetailFields,
  extractIcimsLocationFromHtml,
  extractIcimsPostingDateFromHtml,
  extractIcimsRemoteTypeFromHtml
} = require("../server/index");
const {
  normalizePosting,
  normalizePostingValue,
  normalizeRegionFromCountry
} = require("../server/ingestion/posting");

const SUPPORTED_ATS = new Set(["icims", "applitrack"]);
const LIMIT = Math.max(1, Number(process.env.OPENJOBSLOTS_DETAIL_BACKFILL_LIMIT || 50));
const DRY_RUN = String(process.env.OPENJOBSLOTS_DETAIL_BACKFILL_DRY_RUN || "1").trim() !== "0";
const DELAY_MS = Math.max(0, Number(process.env.OPENJOBSLOTS_DETAIL_BACKFILL_DELAY_MS || 1200));
const ATS_FILTER = String(process.env.OPENJOBSLOTS_DETAIL_BACKFILL_ATS || "icims,applitrack")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter((item) => SUPPORTED_ATS.has(item));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalizeRowUrl(row) {
  return String(row?.canonical_url || "").trim();
}

function isAllowedDetailUrl(atsKey, urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase();
    if (atsKey === "icims") return hostname.endsWith(".icims.com");
    if (atsKey === "applitrack") return hostname.endsWith(".applitrack.com");
  } catch {
    return false;
  }
  return false;
}

function extractSourceJobIdFromUrl(row) {
  const current = normalizePostingValue(row?.source_job_id);
  if (current) return current;
  const url = canonicalizeRowUrl(row);
  try {
    const parsed = new URL(url);
    if (row.ats_key === "icims") return parsed.pathname.match(/\/jobs\/(\d+)/i)?.[1] || "";
    if (row.ats_key === "applitrack") {
      return String(parsed.searchParams.get("JobID") || parsed.searchParams.get("jobid") || "").trim();
    }
  } catch {
    return "";
  }
  return "";
}

function applitrackSiteRootFromUrl(urlValue) {
  const parsed = new URL(String(urlValue || ""));
  const path = String(parsed.pathname || "");
  const lowerPath = path.toLowerCase();
  const onlineAppIndex = lowerPath.indexOf("/onlineapp/");
  if (onlineAppIndex >= 0) {
    return `${parsed.protocol}//${parsed.host}${path.slice(0, onlineAppIndex + "/onlineapp/".length)}`;
  }
  const defaultIndex = lowerPath.indexOf("default.aspx");
  if (defaultIndex >= 0) {
    const rootPath = path.slice(0, defaultIndex);
    return `${parsed.protocol}//${parsed.host}${rootPath.endsWith("/") ? rootPath : `${rootPath}/`}`;
  }
  return `${parsed.protocol}//${parsed.host}/onlineapp/`;
}

function detailUrlForRow(row) {
  const url = canonicalizeRowUrl(row);
  if (!url) return "";
  if (row.ats_key === "icims") {
    const parsed = new URL(url);
    parsed.searchParams.set("in_iframe", "1");
    return parsed.toString();
  }
  if (row.ats_key === "applitrack") {
    return buildApplitrackDetailUrl(applitrackSiteRootFromUrl(url), extractSourceJobIdFromUrl(row), url);
  }
  return "";
}

async function fetchDetailHtml(row) {
  const detailUrl = detailUrlForRow(row);
  if (!detailUrl || !isAllowedDetailUrl(row.ats_key, detailUrl)) {
    return { ok: false, detailUrl, error: "blocked_detail_url" };
  }
  const response = await fetch(detailUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "openjobslots-detail-certifier/1.0"
    }
  });
  if (!response.ok) {
    return { ok: false, detailUrl, error: `http_${response.status}` };
  }
  return { ok: true, detailUrl, html: await response.text() };
}

function extractDetailFields(row, html) {
  if (row.ats_key === "icims") {
    return {
      location: extractIcimsLocationFromHtml(html),
      posting_date: extractIcimsPostingDateFromHtml(html),
      remote_type: extractIcimsRemoteTypeFromHtml(html)
    };
  }
  if (row.ats_key === "applitrack") {
    return extractApplitrackDetailFields(html);
  }
  return {};
}

function toSearchPayload(row, next) {
  return {
    canonical_url: row.canonical_url,
    company_name: row.company_name,
    position_name: row.position_name,
    apply_url: row.apply_url,
    location_text: next.location_text,
    country: next.country,
    region: next.region,
    remote_type: next.remote_type,
    industry: next.industry,
    ats_key: row.ats_key,
    source_job_id: next.source_job_id,
    posting_date: next.posting_date,
    posted_at_epoch: next.posted_at_epoch,
    last_seen_epoch: row.last_seen_epoch,
    hidden: row.hidden
  };
}

function buildNextRow(row, detail) {
  const normalized = normalizePosting(
    {
      ...row,
      source_job_id: extractSourceJobIdFromUrl(row),
      job_posting_url: row.canonical_url,
      location_text: row.location_text || detail.location || "",
      posting_date: row.posting_date || detail.posting_date || "",
      remote_type:
        String(row.remote_type || "unknown").trim() === "unknown"
          ? detail.remote_type || row.remote_type
          : row.remote_type
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

  const country = row.country || normalized.country || "";
  return {
    location_text: row.location_text || normalized.location_text || "",
    country,
    region: row.region || normalized.region || normalizeRegionFromCountry(country) || "",
    remote_type:
      String(row.remote_type || "unknown").trim() === "unknown"
        ? normalized.remote_type || "unknown"
        : row.remote_type,
    source_job_id: row.source_job_id || normalized.source_job_id || "",
    posting_date: row.posting_date || normalized.posting_date || null,
    posted_at_epoch: row.posted_at_epoch || normalized.posted_at_epoch || null,
    industry: row.industry || normalized.industry || ""
  };
}

function rowChanged(row, next) {
  return (
    String(row.location_text || "") !== String(next.location_text || "") ||
    String(row.country || "") !== String(next.country || "") ||
    String(row.region || "") !== String(next.region || "") ||
    String(row.remote_type || "unknown") !== String(next.remote_type || "unknown") ||
    String(row.source_job_id || "") !== String(next.source_job_id || "") ||
    String(row.posting_date || "") !== String(next.posting_date || "") ||
    Number(row.posted_at_epoch || 0) !== Number(next.posted_at_epoch || 0)
  );
}

async function updateRow(client, row, next) {
  await client.query(
    `
      UPDATE postings
      SET location_text = NULLIF($2, ''),
          country = $3,
          region = $4,
          remote_type = $5,
          source_job_id = $6,
          posting_date = $7,
          posted_at_epoch = $8,
          updated_at = now()
      WHERE canonical_url = $1;
    `,
    [
      row.canonical_url,
      next.location_text,
      next.country,
      next.region,
      next.remote_type,
      next.source_job_id,
      next.posting_date,
      next.posted_at_epoch
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
          posted_at_epoch = $8,
          updated_at = now()
      WHERE canonical_url = $1;
    `,
    [
      row.canonical_url,
      next.location_text,
      next.country,
      next.region,
      next.remote_type,
      next.source_job_id,
      next.posting_date,
      next.posted_at_epoch
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

async function main() {
  if (ATS_FILTER.length === 0) {
    throw new Error("No supported ATS selected for detail-page backfill.");
  }
  const pool = createPostgresPool();
  let scanned = 0;
  let fetched = 0;
  let changed = 0;
  const changedByAts = new Map();
  const errorsByAts = new Map();

  try {
    await ensurePostgresSchema(pool);
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
          AND ats_key = ANY($1::text[])
          AND (
            coalesce(location_text, '') = ''
            OR coalesce(country, '') = ''
            OR coalesce(region, '') = ''
            OR remote_type = 'unknown'
            OR source_job_id = ''
            OR posting_date IS NULL
            OR posted_at_epoch IS NULL
          )
        ORDER BY last_seen_epoch DESC NULLS LAST, canonical_url ASC
        LIMIT $2;
      `,
      [ATS_FILTER, LIMIT]
    );

    const client = DRY_RUN ? null : await pool.connect();
    try {
      if (client) await client.query("BEGIN");
      for (const row of result.rows || []) {
        scanned += 1;
        const fetchedDetail = await fetchDetailHtml(row);
        if (!fetchedDetail.ok) {
          errorsByAts.set(row.ats_key, (errorsByAts.get(row.ats_key) || 0) + 1);
          continue;
        }
        fetched += 1;
        const detail = extractDetailFields(row, fetchedDetail.html);
        const next = buildNextRow(row, detail);
        if (rowChanged(row, next)) {
          changed += 1;
          changedByAts.set(row.ats_key, (changedByAts.get(row.ats_key) || 0) + 1);
          if (client) await updateRow(client, row, next);
        }
        if (DELAY_MS > 0) await sleep(DELAY_MS);
      }
      if (client) await client.query("COMMIT");
    } catch (error) {
      if (client) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (client) client.release();
    }

    console.log(JSON.stringify({
      ok: true,
      dry_run: DRY_RUN,
      ats_filter: ATS_FILTER,
      scanned,
      fetched,
      changed,
      changed_by_ats: Object.fromEntries([...changedByAts.entries()].sort((a, b) => b[1] - a[1])),
      fetch_errors_by_ats: Object.fromEntries([...errorsByAts.entries()].sort((a, b) => b[1] - a[1]))
    }, null, 2));
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
