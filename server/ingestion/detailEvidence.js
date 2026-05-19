const crypto = require("node:crypto");
const { safeFetch } = require("./safeFetch");

const DETAIL_EVIDENCE_STATUS = Object.freeze({
  DISABLED: "disabled",
  FETCHED: "fetched",
  FAILED: "failed",
  PROVIDER_NOT_ALLOWED: "provider_not_allowed",
  PROVIDER_UNSUPPORTED: "provider_unsupported"
});

const DEFAULT_PROVIDER = "local";
const DEFAULT_PROVIDER_ALLOWLIST = Object.freeze(["local"]);
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_CONTEXT_CHARS = 120;
const DEFAULT_MAX_SPANS = 20;

const DEFAULT_EVIDENCE_PATTERNS = Object.freeze([
  { kind: "workplace", pattern: /\b(remote|hybrid|on[-\s]?site|work from home|telecommute)\b/gi },
  { kind: "location", pattern: /\b(location|city|country|region|state|province|office|address)\b/gi },
  { kind: "date", pattern: /\b(posted|published|date posted|last updated|updated)\b/gi },
  { kind: "source_id", pattern: /\b(job id|job requisition|req(?:uisition)? id|posting id|opening id)\b/gi }
]);

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeProvider(value) {
  return clean(value || DEFAULT_PROVIDER, 80).toLowerCase().replace(/[^a-z0-9_-]/g, "") || DEFAULT_PROVIDER;
}

function parseProviderAllowlist(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const providers = raw.map(normalizeProvider).filter(Boolean);
  return new Set(providers.length ? providers : DEFAULT_PROVIDER_ALLOWLIST);
}

function isDetailEvidenceEnabled(env = process.env, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "enabled")) return Boolean(options.enabled);
  return ["1", "true", "yes", "y", "on"].includes(
    String(env.OPENJOBSLOTS_DETAIL_EVIDENCE || "").trim().toLowerCase()
  );
}

function getConfiguredProvider(env = process.env, options = {}) {
  return normalizeProvider(options.provider || env.OPENJOBSLOTS_DETAIL_EVIDENCE_PROVIDER || DEFAULT_PROVIDER);
}

function getAllowedProviders(env = process.env, options = {}) {
  return parseProviderAllowlist(
    options.allowedProviders || env.OPENJOBSLOTS_DETAIL_EVIDENCE_PROVIDERS || DEFAULT_PROVIDER_ALLOWLIST
  );
}

function contentHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, number) => String.fromCodePoint(Number.parseInt(number, 10)));
}

function htmlToEvidenceText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|main|li|tr|h[1-6])>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizePatterns(patterns) {
  const values = Array.isArray(patterns) && patterns.length ? patterns : DEFAULT_EVIDENCE_PATTERNS;
  return values.map((item) => {
    if (item instanceof RegExp) return { kind: "custom", pattern: item };
    if (typeof item === "string") {
      return { kind: "custom", pattern: new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") };
    }
    if (item?.pattern instanceof RegExp) {
      return { kind: clean(item.kind || "custom", 80), pattern: item.pattern };
    }
    return null;
  }).filter(Boolean);
}

function selectEvidenceSpans(text, options = {}) {
  const source = String(text || "");
  const spans = [];
  const maxSpans = Math.max(0, Math.min(100, Number(options.maxSpans ?? DEFAULT_MAX_SPANS)));
  const contextChars = Math.max(20, Math.min(500, Number(options.contextChars ?? DEFAULT_CONTEXT_CHARS)));
  if (!source || !maxSpans) return spans;

  for (const item of normalizePatterns(options.patterns)) {
    const flags = item.pattern.flags.includes("g") ? item.pattern.flags : `${item.pattern.flags}g`;
    const pattern = new RegExp(item.pattern.source, flags);
    let match;
    while ((match = pattern.exec(source)) && spans.length < maxSpans) {
      const start = Math.max(0, match.index - contextChars);
      const end = Math.min(source.length, match.index + String(match[0] || "").length + contextChars);
      spans.push({
        kind: item.kind,
        match: clean(match[0], 120),
        start: match.index,
        end: match.index + String(match[0] || "").length,
        excerpt: clean(source.slice(start, end), contextChars * 2 + 120)
      });
    }
    if (spans.length >= maxSpans) break;
  }
  return spans;
}

function snapshotBase(input = {}) {
  const fetchedAt = input.fetchedAt || input.fetched_at || new Date().toISOString();
  return {
    ok: Boolean(input.ok),
    status: clean(input.status || DETAIL_EVIDENCE_STATUS.FAILED, 80),
    source_url: clean(input.sourceUrl || input.source_url || "", 2000),
    final_url: clean(input.finalUrl || input.final_url || "", 2000),
    http_status: Number(input.httpStatus || input.http_status || 0) || null,
    extractor: normalizeProvider(input.extractor || input.provider || DEFAULT_PROVIDER),
    extractor_version: clean(input.extractorVersion || input.extractor_version || "1", 80),
    fetched_at: fetchedAt,
    content_hash: "",
    content_hash_algorithm: "sha256",
    config: input.config || {},
    warnings: Array.from(new Set((Array.isArray(input.warnings) ? input.warnings : []).map((warning) => clean(warning, 240)).filter(Boolean))),
    markdown: "",
    html: "",
    text: "",
    markdown_length: 0,
    html_length: 0,
    text_length: 0,
    evidence_spans: []
  };
}

function buildDetailEvidenceSnapshot(input = {}, options = {}) {
  const base = snapshotBase(input);
  const html = String(input.html || "");
  const text = String(input.text || input.markdown || (html ? htmlToEvidenceText(html) : ""));
  const markdown = String(input.markdown || text);
  const content = markdown || text || html;
  const includeHtml = Boolean(options.includeHtml || input.include_html);

  return {
    ...base,
    ok: Boolean(input.ok ?? (base.status === DETAIL_EVIDENCE_STATUS.FETCHED)),
    markdown,
    html: includeHtml ? html : "",
    text,
    markdown_length: Buffer.byteLength(markdown, "utf8"),
    html_length: Buffer.byteLength(html, "utf8"),
    text_length: Buffer.byteLength(text, "utf8"),
    content_hash: content ? contentHash(content) : "",
    evidence_spans: Array.isArray(input.evidence_spans)
      ? input.evidence_spans
      : selectEvidenceSpans(markdown || text, options)
  };
}

function buildDisabledSnapshot(sourceUrl, options = {}) {
  return buildDetailEvidenceSnapshot({
    ok: false,
    status: DETAIL_EVIDENCE_STATUS.DISABLED,
    sourceUrl,
    extractor: getConfiguredProvider(options.env || process.env, options),
    warnings: ["detail_evidence_disabled"]
  }, options);
}

function buildProviderSnapshot(sourceUrl, status, provider, warnings, options = {}) {
  return buildDetailEvidenceSnapshot({
    ok: false,
    status,
    sourceUrl,
    extractor: provider,
    warnings
  }, options);
}

async function localExtractor(sourceUrl, options = {}) {
  const timeoutMs = Math.max(1000, Math.min(60_000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)));
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await safeFetch(
      sourceUrl,
      {
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
          ...(options.headers || {})
        },
        signal: controller?.signal
      },
      {
        fetcher: options.fetcher,
        lookup: options.lookup,
        maxRedirects: options.maxRedirects,
        maxResponseBytes: options.maxResponseBytes || DEFAULT_MAX_BYTES
      }
    );
    const html = await response.text();
    const text = htmlToEvidenceText(html);
    return {
      ok: Boolean(response.ok),
      status: DETAIL_EVIDENCE_STATUS.FETCHED,
      httpStatus: Number(response.status || 0) || null,
      finalUrl: response.url || sourceUrl,
      html,
      markdown: text,
      text,
      warnings: response.ok ? [] : [`http_status_${Number(response.status || 0) || "unknown"}`]
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function collectDetailEvidence(sourceUrl, options = {}) {
  const env = options.env || process.env;
  const provider = getConfiguredProvider(env, options);
  if (!isDetailEvidenceEnabled(env, options)) return buildDisabledSnapshot(sourceUrl, { ...options, provider, env });

  const allowedProviders = getAllowedProviders(env, options);
  if (!allowedProviders.has(provider)) {
    return buildProviderSnapshot(sourceUrl, DETAIL_EVIDENCE_STATUS.PROVIDER_NOT_ALLOWED, provider, [
      `detail_evidence_provider_not_allowlisted:${provider}`
    ], options);
  }

  const extractors = options.extractors || { local: localExtractor };
  const extractor = options.extractor || extractors[provider];
  if (typeof extractor !== "function") {
    return buildProviderSnapshot(sourceUrl, DETAIL_EVIDENCE_STATUS.PROVIDER_UNSUPPORTED, provider, [
      `detail_evidence_provider_not_implemented:${provider}`
    ], options);
  }

  try {
    const result = await extractor(sourceUrl, options);
    return buildDetailEvidenceSnapshot({
      ...result,
      sourceUrl,
      extractor: provider,
      config: {
        provider,
        max_bytes: Number(options.maxResponseBytes || DEFAULT_MAX_BYTES),
        timeout_ms: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
        evidence_only: true
      }
    }, options);
  } catch (error) {
    return buildDetailEvidenceSnapshot({
      ok: false,
      status: DETAIL_EVIDENCE_STATUS.FAILED,
      sourceUrl,
      extractor: provider,
      warnings: [clean(error?.code || error?.ingestionErrorType || "detail_evidence_failed", 120)],
      config: {
        provider,
        evidence_only: true
      }
    }, options);
  }
}

function buildDetailEvidenceSummary(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      present: false,
      status: "missing"
    };
  }
  return {
    present: Boolean(snapshot.content_hash || snapshot.markdown || snapshot.html || snapshot.text),
    status: clean(snapshot.status || "", 80),
    extractor: clean(snapshot.extractor || "", 80),
    final_url: clean(snapshot.final_url || "", 2000),
    http_status: Number(snapshot.http_status || 0) || null,
    fetched_at: clean(snapshot.fetched_at || "", 80),
    content_hash: clean(snapshot.content_hash || "", 128),
    markdown_length: Number(snapshot.markdown_length || 0),
    html_length: Number(snapshot.html_length || 0),
    text_length: Number(snapshot.text_length || 0),
    evidence_span_count: Array.isArray(snapshot.evidence_spans) ? snapshot.evidence_spans.length : 0,
    warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings.map((warning) => clean(warning, 160)).filter(Boolean) : []
  };
}

module.exports = {
  DEFAULT_EVIDENCE_PATTERNS,
  DEFAULT_PROVIDER,
  DEFAULT_PROVIDER_ALLOWLIST,
  DETAIL_EVIDENCE_STATUS,
  buildDetailEvidenceSnapshot,
  buildDetailEvidenceSummary,
  collectDetailEvidence,
  getAllowedProviders,
  getConfiguredProvider,
  htmlToEvidenceText,
  isDetailEvidenceEnabled,
  localExtractor,
  normalizeProvider,
  parseProviderAllowlist,
  selectEvidenceSpans
};
