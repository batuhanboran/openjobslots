const crypto = require("crypto");

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

async function writePostingCache(db, posting, options = {}) {
  const nowEpoch = Number(options.nowEpoch || Math.floor(Date.now() / 1000));
  const parserVersion = String(options.parserVersion || "unknown");
  const sourceCompanyUrl = String(options.sourceCompanyUrl || "").trim();
  const validation = options.validation || { ok: true, error: "" };
  const validationStatus = validation.ok ? "valid" : "invalid";
  const validationError = String(validation.error || "");
  const canonicalUrl = String(posting?.job_posting_url || "").trim();
  const rawPayloadHash = hashPayload(posting || {});
  if (!canonicalUrl) {
    return { cached: false, changed: false, hash: rawPayloadHash };
  }

  const existing = await db.get(
    `
      SELECT raw_payload_hash
      FROM posting_cache
      WHERE canonical_url = ?;
    `,
    [canonicalUrl]
  );
  const changed = String(existing?.raw_payload_hash || "") !== rawPayloadHash;

  await db.run(
    `
      INSERT INTO posting_cache (
        canonical_url,
        ats_key,
        company_name,
        position_name,
        location,
        posting_date,
        raw_payload_hash,
        source_company_url,
        first_seen_epoch,
        last_seen_epoch,
        parser_version,
        validation_status,
        validation_error,
        raw_metadata,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(canonical_url) DO UPDATE SET
        ats_key = excluded.ats_key,
        company_name = excluded.company_name,
        position_name = excluded.position_name,
        location = excluded.location,
        posting_date = excluded.posting_date,
        raw_payload_hash = excluded.raw_payload_hash,
        source_company_url = excluded.source_company_url,
        last_seen_epoch = excluded.last_seen_epoch,
        parser_version = excluded.parser_version,
        validation_status = excluded.validation_status,
        validation_error = excluded.validation_error,
        raw_metadata = excluded.raw_metadata,
        updated_at = datetime('now');
    `,
    [
      canonicalUrl,
      String(posting?.ats_key || "").trim(),
      String(posting?.company_name || "").trim(),
      String(posting?.position_name || "").trim(),
      posting?.location || null,
      posting?.posting_date || null,
      rawPayloadHash,
      sourceCompanyUrl,
      nowEpoch,
      nowEpoch,
      parserVersion,
      validationStatus,
      validationError,
      JSON.stringify({
        source_company_url: sourceCompanyUrl,
        parser_version: parserVersion
      })
    ]
  );

  return { cached: true, changed, hash: rawPayloadHash };
}

module.exports = {
  hashPayload,
  stableStringify,
  writePostingCache
};
