const crypto = require("crypto");
const {
  getPublicSeoCountryFallbackQueries,
  getPublicSeoPopularSearchItems,
  normalizePublicSeoLanguageCode
} = require("../../src/publicSeoRoutes");

const PUBLIC_ANALYTICS_SESSION_COOKIE = "ojs_anon_session";
const PUBLIC_ANALYTICS_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_LANGUAGE_HINT_COOKIE = "ojs_public_language_hint";
const PUBLIC_LANGUAGE_HINT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_LANGUAGE_COUNTRY_BY_CODE = Object.freeze({
  en: "US",
  tr: "TR",
  de: "DE",
  fr: "FR",
  es: "ES",
  "pt-br": "BR",
  "pt-pt": "PT",
  it: "IT",
  nl: "NL",
  pl: "PL",
  ja: "JP",
  ko: "KR",
  "zh-cn": "CN",
  hi: "IN",
  ar: "AE",
  id: "ID",
  sv: "SE",
  da: "DK",
  no: "NO",
  fi: "FI"
});
const PUBLIC_POPULAR_COUNTRY_ANALYTICS_MIN_QUERIES = 4;

function getRequestHeader(req, name) {
  if (req && typeof req.get === "function") return req.get(name) || "";
  return req?.headers?.[String(name || "").toLowerCase()] || "";
}

function normalizeRequestHost(value) {
  const raw = String(value || "").split(",")[0].trim().toLowerCase();
  return raw.replace(/:\d+$/, "");
}

function normalizeRedirectPath(value) {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function normalizePublicPostingRedirectUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2000) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function normalizePublicCountryCode(value) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : "";
}

function getRequestCountryCode(req) {
  return normalizePublicCountryCode(
    getRequestHeader(req, "cf-ipcountry") ||
      getRequestHeader(req, "x-vercel-ip-country") ||
      getRequestHeader(req, "x-country-code")
  );
}

function getPublicLanguageCountryCode(languageCode) {
  return PUBLIC_LANGUAGE_COUNTRY_BY_CODE[String(languageCode || "").trim().toLowerCase()] || "";
}

function getCanonicalPublicHostRedirectTarget(req) {
  const method = String(req?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return "";
  const forwardedHost = getRequestHeader(req, "x-forwarded-host");
  const host = normalizeRequestHost(forwardedHost || getRequestHeader(req, "host"));
  if (host !== "www.openjobslots.com") return "";
  return `https://openjobslots.com${normalizeRedirectPath(req?.originalUrl || req?.url || "/")}`;
}

function parseCookieHeader(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (!name || valueParts.length === 0) continue;
    cookies[name] = valueParts.join("=");
  }
  return cookies;
}

function isValidPublicAnalyticsSessionId(value) {
  return /^[a-f0-9-]{32,64}$/i.test(String(value || "").trim());
}

function createPublicAnalyticsSessionId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function shouldUseSecureAnalyticsCookie(req) {
  const forwardedProto = String(req.get ? req.get("x-forwarded-proto") : "").toLowerCase();
  return Boolean(req.secure || forwardedProto.split(",").map((item) => item.trim()).includes("https"));
}

function appendResponseVaryHeader(res, values = []) {
  const existing = String(res.getHeader?.("Vary") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const next = new Set(existing);
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) next.add(normalized);
  }
  if (next.size > 0) res.setHeader("Vary", Array.from(next).join(", "));
}

function getPublicAnalyticsSessionKey(req, res) {
  const cookies = parseCookieHeader(req.get ? req.get("cookie") : req.headers?.cookie);
  let sessionId = String(cookies[PUBLIC_ANALYTICS_SESSION_COOKIE] || "").trim();
  if (!isValidPublicAnalyticsSessionId(sessionId)) {
    sessionId = createPublicAnalyticsSessionId();
    if (res && typeof res.cookie === "function" && !res.headersSent) {
      res.cookie(PUBLIC_ANALYTICS_SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: shouldUseSecureAnalyticsCookie(req),
        maxAge: PUBLIC_ANALYTICS_SESSION_MAX_AGE_MS,
        path: "/"
      });
    }
  }
  return crypto
    .createHash("sha256")
    .update(`openjobslots-public-analytics-v1:${sessionId}`)
    .digest("hex");
}

function getPublicAnalyticsCountryScope(req, options = {}) {
  return (
    normalizePublicCountryCode(
      options.countryScope ||
        options.page_country ||
        options.visitor_country ||
        req?.query?.country_scope ||
        req?.query?.page_country ||
        req?.query?.visitor_country
    ) || getRequestCountryCode(req)
  );
}

function getPublicAnalyticsLanguageScope(req, options = {}) {
  return normalizePublicSeoLanguageCode(
    options.page_language ||
      options.language ||
      options.languageCode ||
      req?.query?.page_language ||
      req?.query?.language ||
      req?.query?.lang ||
      ""
  );
}

function getPublicPopularSearchCountryScope(req, languageCode) {
  return (
    normalizePublicCountryCode(
      req?.query?.country ||
        req?.query?.country_scope ||
        req?.query?.page_country ||
        req?.query?.visitor_country
    ) ||
    getPublicLanguageCountryCode(languageCode) ||
    getRequestCountryCode(req)
  );
}

function isInternalPublicAnalyticsProbe(req) {
  if (req?.query?._validation || req?.query?._research) return true;
  const userAgent = String(getRequestHeader(req, "user-agent") || "");
  if (/^OpenJobSlots-Codex-/i.test(userAgent)) return true;
  if (/bot|googlebot|bingbot|yandex|baidu|crawler|spider|slurp|facebookexternalhit|ia_archiver/i.test(userAgent)) return true;

  const searchSource = req?.query?.search_source || "";
  if (searchSource === "cv_parse" || searchSource === "cv") return true;

  const searchVal = String(req?.query?.search || "").trim();
  if (/\bOR\b/i.test(searchVal)) return true;

  return false;
}

function registerPublicRoutes(app, context) {
  const {
    ATS_FILTER_OPTION_ITEMS,
    DB_BACKEND,
    QUEUE_BACKEND,
    SEARCH_BACKEND,
    STATE_CODE_TO_NAME,
    appendFrontendLogEntry,
    buildPublicIngestionStatusItem,
    buildPublicPreferences,
    buildLlmsFullTxt,
    buildLlmsTxt,
    buildRobotsTxt,
    buildSitemapSectionXml,
    buildSitemapXml,
    createEmptyGrowthSummary,
    db,
    express,
    fs,
    getCounts,
    getIngestionWorkerStatus,
    getParserAttentionByAts,
    getPostgresCounts,
    getPostgresFilterOptions,
    getPostgresGrowthSummary,
    getPostgresParserAttentionByAts,
    getPostgresDailyRedditPost,
    getPostgresPublicSearchReport,
    getPostgresSuggestions,
    getPostgresSyncStatus,
    getPostingLocationGeoFilterOptions,
    getPublicPostingSortOptions,
    getSearchSuggestions,
    getSyncScopeStats,
    getSyncServiceSettings,
    getWritePressure,
    hasAdminAccess,
    listPostgresPostings,
    listPostingsWithFilters,
    normalizeBoolean,
    normalizeFreshnessDays,
    normalizePostingSort,
    normalizeSyncEnabledAts,
    parseCsvParam,
    path,
    postgresPool,
    publicSiteUrl,
    publicReadCache,
    readMeiliReindexStatus,
    recordPostgresPublicSearchEvent,
    renderSeoIndexHtml,
    sanitizeFrontendValue,
    sanitizePublicPostings,
    sanitizePublicSourceFacets,
    sendCachedPublicJson,
    syncStatus
  } = context;

  function setPublicSeoCacheHeaders(res, maxAgeSeconds, edgeMaxAgeSeconds) {
    const browserTtl = Math.max(0, Number(maxAgeSeconds || 0));
    const edgeTtl = Math.max(browserTtl, Number(edgeMaxAgeSeconds || browserTtl || 0));
    res.setHeader(
      "Cache-Control",
      `public, max-age=${browserTtl}, s-maxage=${edgeTtl}, stale-while-revalidate=86400`
    );
  }

  function escapePrivacyPolicyHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function getPrivacyPolicySiteOrigin(req) {
    const configuredOrigin = String(publicSiteUrl || "").trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(configuredOrigin)) return configuredOrigin;

    const host = String(
      typeof req?.get === "function"
        ? req.get("x-forwarded-host") || req.get("host")
        : req?.headers?.["x-forwarded-host"] || req?.headers?.host || ""
    ).split(",")[0].trim();
    if (!host) return "https://openjobslots.com";

    const protocol = String(
      typeof req?.get === "function"
        ? req.get("x-forwarded-proto")
        : req?.headers?.["x-forwarded-proto"] || req?.protocol || "https"
    ).split(",")[0].trim().replace(/:$/, "") || "https";
    return `${protocol}://${host}`.replace(/\/+$/, "");
  }

  function buildPrivacyPolicyHtml(req) {
    const siteOrigin = getPrivacyPolicySiteOrigin(req);
    const canonicalUrl = `${siteOrigin}/privacy`;
    const dataDeletionUrl = `${siteOrigin}/data-deletion`;
    const effectiveDate = "June 3, 2026";
    const title = "Privacy Policy | OpenJobSlots";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapePrivacyPolicyHtml(title)}</title>
  <meta name="description" content="OpenJobSlots privacy policy for the public job search website and Android app." />
  <link rel="canonical" href="${escapePrivacyPolicyHtml(canonicalUrl)}" />
  <style>
    :root { color-scheme: light dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f8fb; color: #20262e; line-height: 1.58; }
    main { max-width: 820px; margin: 0 auto; padding: 48px 20px 72px; }
    h1 { margin: 0 0 8px; font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1.05; letter-spacing: 0; }
    h2 { margin: 32px 0 8px; font-size: 1.15rem; }
    p, li { font-size: 1rem; color: #374151; }
    a { color: #4b39ef; }
    .updated { margin: 0 0 28px; color: #667085; }
    .panel { background: #fff; border: 1px solid #e4e7ec; border-radius: 8px; padding: 28px; }
    @media (prefers-color-scheme: dark) {
      body { background: #08130e; color: #f4f7f2; }
      .panel { background: #111a15; border-color: #2b3a32; }
      p, li, .updated { color: #cbd5cf; }
      a { color: #b79cff; }
    }
  </style>
</head>
<body>
  <main>
    <h1>OpenJobSlots Privacy Policy</h1>
    <p class="updated">Effective date: ${escapePrivacyPolicyHtml(effectiveDate)}</p>
    <section class="panel" aria-label="Privacy policy">
      <p>OpenJobSlots is a public job search service for finding job openings from public employer career pages and applicant tracking system job boards. This policy explains how the OpenJobSlots website and Android app handle information.</p>

      <h2>Information we process</h2>
      <p>OpenJobSlots does not require an account and does not ask users to upload resumes, submit applications, enter payment details, provide government identifiers, or provide health or financial information.</p>
      <p>When you use the service, we may process search text, selected filters, selected language and theme preferences, anonymous session or preference identifiers, approximate request location signals such as country headers, device or browser information, IP address, timestamps, pages viewed, and technical diagnostics.</p>

      <h2>How we use information</h2>
      <ul>
        <li>To return public job search results and suggestions.</li>
        <li>To remember basic preferences such as language and theme.</li>
        <li>To measure aggregate usage, reliability, and performance.</li>
        <li>To prevent abuse, investigate outages, and keep the service secure.</li>
        <li>To improve public job search quality and coverage.</li>
      </ul>

      <h2>Third-party job links</h2>
      <p>OpenJobSlots links to employer career pages and third-party ATS websites. If you apply for a job or share information on those external sites, their own privacy policies and terms apply. OpenJobSlots does not control those third-party application forms.</p>

      <h2>Cookies and analytics</h2>
      <p>The service may use limited cookies or local identifiers for anonymous sessions, preferences, and aggregate analytics. You can clear cookies or browser storage through your browser or device settings.</p>

      <h2>Sharing</h2>
      <p>OpenJobSlots does not sell personal information. Information may be processed by infrastructure, hosting, analytics, security, and app distribution providers only as needed to operate and protect the service.</p>

      <h2>Retention</h2>
      <p>Preference identifiers may be retained for up to 30 days. Operational logs and analytics are retained only as long as reasonably needed for reliability, security, debugging, abuse prevention, legal compliance, or aggregate reporting.</p>

      <h2>Children</h2>
      <p>OpenJobSlots is not directed to children under 13 and does not knowingly collect personal information from children under 13.</p>

      <h2>Your choices</h2>
      <p>You can avoid entering personal information in search queries, clear local cookies or app data, use the employer or ATS website directly when applying for jobs, and request deletion of OpenJobSlots app data through <a href="${escapePrivacyPolicyHtml(dataDeletionUrl)}">OpenJobSlots data deletion</a>.</p>

      <h2>Contact</h2>
      <p>For privacy questions, contact the OpenJobSlots operator through <a href="https://batuhanboran.com" rel="noopener">batuhanboran.com</a>.</p>
    </section>
  </main>
</body>
</html>`;
  }

  function buildDataDeletionHtml(req) {
    const siteOrigin = getPrivacyPolicySiteOrigin(req);
    const dataDeletionPath = req?.path === "/google-play-data-deletion" ? "/google-play-data-deletion" : "/data-deletion";
    const canonicalUrl = `${siteOrigin}${dataDeletionPath}`;
    const privacyUrl = `${siteOrigin}/privacy`;
    const effectiveDate = "June 3, 2026";
    const title = "Data Deletion | OpenJobSlots";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapePrivacyPolicyHtml(title)}</title>
  <meta name="description" content="How to request deletion of OpenJobSlots Android app and website data." />
  <link rel="canonical" href="${escapePrivacyPolicyHtml(canonicalUrl)}" />
  <style>
    :root { color-scheme: light dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f8fb; color: #20262e; line-height: 1.58; }
    main { max-width: 820px; margin: 0 auto; padding: 48px 20px 72px; }
    h1 { margin: 0 0 8px; font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1.05; letter-spacing: 0; }
    h2 { margin: 32px 0 8px; font-size: 1.15rem; }
    p, li { font-size: 1rem; color: #374151; }
    a { color: #4b39ef; }
    .updated { margin: 0 0 28px; color: #667085; }
    .panel { background: #fff; border: 1px solid #e4e7ec; border-radius: 8px; padding: 28px; }
    @media (prefers-color-scheme: dark) {
      body { background: #08130e; color: #f4f7f2; }
      .panel { background: #111a15; border-color: #2b3a32; }
      p, li, .updated { color: #cbd5cf; }
      a { color: #b79cff; }
    }
  </style>
</head>
<body>
  <main>
    <h1>OpenJobSlots Data Deletion</h1>
    <p class="updated">Effective date: ${escapePrivacyPolicyHtml(effectiveDate)}</p>
    <section class="panel" aria-label="Data deletion instructions">
      <p>OpenJobSlots does not require users to create an account and does not store resumes, job applications, payment details, government identifiers, health information, or financial information in the public Android app or website.</p>

      <h2>How to request deletion</h2>
      <p>To request deletion of OpenJobSlots app or website data associated with your use of the service, contact the OpenJobSlots operator through <a href="https://batuhanboran.com" rel="noopener">batuhanboran.com</a> and include the subject line "OpenJobSlots data deletion request".</p>
      <p>Include the email address where you want to receive the response and any details that help identify the data to delete, such as approximate dates of use or search terms you want removed. Do not send resumes, government IDs, payment information, health information, or other sensitive documents.</p>

      <h2>Data that can be deleted</h2>
      <ul>
        <li>OpenJobSlots search activity and filter activity that can be associated with your request.</li>
        <li>Anonymous session or preference identifiers that can be associated with your request.</li>
        <li>Operational diagnostics that can reasonably be located and removed without affecting security, legal, or aggregate reporting obligations.</li>
      </ul>

      <h2>Data kept or not controlled by OpenJobSlots</h2>
      <p>OpenJobSlots links to employer career pages and third-party applicant tracking system websites. If you apply for a job or share information on those external sites, you must contact that employer or ATS provider for deletion requests related to their systems.</p>
      <p>OpenJobSlots may retain limited records when needed for security, abuse prevention, legal compliance, backup integrity, or aggregate reporting. Aggregated analytics that no longer identify a user or session may be kept.</p>

      <h2>More information</h2>
      <p>Read the <a href="${escapePrivacyPolicyHtml(privacyUrl)}">OpenJobSlots Privacy Policy</a> for more details about information processed by the Android app and website.</p>
    </section>
  </main>
</body>
</html>`;
  }

  function setPublicLanguageHintCookie(req, res) {
    if (typeof buildPublicPreferences !== "function" || !res || res.headersSent || typeof res.cookie !== "function") return;
    const preferences = buildPublicPreferences(req);
    const nextLanguage = normalizePublicSeoLanguageCode(preferences?.default_language);
    if (!nextLanguage || nextLanguage === "en") return;

    const cookies = parseCookieHeader(req.get ? req.get("cookie") : req.headers?.cookie);
    if (String(cookies[PUBLIC_LANGUAGE_HINT_COOKIE] || "").trim() === nextLanguage) return;

    res.cookie(PUBLIC_LANGUAGE_HINT_COOKIE, nextLanguage, {
      httpOnly: false,
      sameSite: "lax",
      secure: shouldUseSecureAnalyticsCookie(req),
      maxAge: PUBLIC_LANGUAGE_HINT_MAX_AGE_MS,
      path: "/"
    });
    appendResponseVaryHeader(res, ["Accept-Language", "CF-IPCountry"]);
    res.setHeader("Cache-Control", "private, max-age=60");
  }

  app.use((req, res, next) => {
    const canonicalTarget = getCanonicalPublicHostRedirectTarget(req);
    if (canonicalTarget) return res.redirect(301, canonicalTarget);
    return next();
  });

  function recordPublicSearchEvent(req, res, eventType, search, payload, options = {}, info = {}) {
    if (DB_BACKEND !== "postgres" || typeof recordPostgresPublicSearchEvent !== "function") return;
    if (isInternalPublicAnalyticsProbe(req)) return;
    const event = {
      eventType,
      search,
      resultCount: payload && Number.isFinite(Number(payload.count)) ? Number(payload.count) : null,
      resultItems: Array.isArray(payload?.items) ? payload.items.length : null,
      limit: options.limit,
      offset: options.offset,
      sortBy: options.sort_by,
      remote: options.remote,
      ats: options.ats,
      countries: options.countries,
      regions: options.regions,
      referrer: req.get ? req.get("referer") || req.get("referrer") : "",
      userAgent: req.get ? req.get("user-agent") : "",
      cacheStatus: info.cacheStatus,
      countryScope: getPublicAnalyticsCountryScope(req, options),
      pageLanguage: getPublicAnalyticsLanguageScope(req, options),
      anonymousSessionKey: getPublicAnalyticsSessionKey(req, res)
    };
    Promise.resolve(recordPostgresPublicSearchEvent(postgresPool, event)).catch((error) => {
      console.warn("[openjobslots] public_search_event_write_failed", String(error?.message || error));
    });
  }

  app.post("/frontend/log", async (req, res) => {
    try {
      appendFrontendLogEntry(
        req.body?.level,
        req.body?.event,
        req.body?.message,
        req.body?.context && typeof req.body.context === "object" ? req.body.context : {}
      );
      res.status(202).json({ ok: true });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.get("/health", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      if (DB_BACKEND === "postgres") {
        const counts = await getPostgresCounts(postgresPool);
        return {
          ok: true,
          db_backend: DB_BACKEND,
          search_backend: SEARCH_BACKEND,
          queue_backend: QUEUE_BACKEND,
          legacy_api_sync: false,
          ...counts
        };
      }

      const counts = await getCounts();
      return {
        ok: true,
        db_backend: DB_BACKEND,
        search_backend: SEARCH_BACKEND,
        queue_backend: QUEUE_BACKEND,
        legacy_api_sync: true,
        ...counts
      };
    });
  });

  app.get("/public/preferences", (req, res) => {
    res.setHeader("Vary", "Accept-Language, CF-IPCountry");
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.json(buildPublicPreferences(req));
  });

  app.get("/sync/status", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const includeAdminDiagnostics = hasAdminAccess(req);
      if (DB_BACKEND === "postgres") {
        const [status, parserAttentionByAts, counts] = await Promise.all([
          getPostgresSyncStatus(postgresPool, { includeWorkerDiagnostics: includeAdminDiagnostics }),
          getPostgresParserAttentionByAts(postgresPool),
          getPostgresCounts(postgresPool)
        ]);
        return sanitizeFrontendValue({
          running: Boolean(status.running),
          queued: Boolean(status.queued),
          status: String(status.status || ""),
          stopping: Boolean(status.stopping),
          cancel_requested: Boolean(status.cancel_requested),
          legacy_api_sync: Boolean(status.legacy_api_sync),
          last_sync_at: status.last_sync_at || null,
          last_failed_sync_at: status.last_failed_sync_at || null,
          last_sync_summary: status.last_sync_summary || {},
          db_backend: status.db_backend || DB_BACKEND,
          search_backend: status.search_backend || SEARCH_BACKEND,
          search_reindex: readMeiliReindexStatus(),
          queue_backend: status.queue_backend || QUEUE_BACKEND,
          queue_depth: Number(status.queue_depth || 0),
          sync_enabled_company_count: Number(status.sync_enabled_company_count || 0),
          configured_enabled_ats_count: Number(status.configured_enabled_ats_count || 0),
          full_enabled_ats_count: Number(status.full_enabled_ats_count || counts.full_enabled_ats_count || 0),
          canary_enabled_ats_count: Number(status.canary_enabled_ats_count || counts.canary_enabled_ats_count || 0),
          quarantine_only_ats_count: Number(status.quarantine_only_ats_count || counts.quarantine_only_ats_count || 0),
          disabled_ats_count: Number(status.disabled_ats_count || counts.disabled_ats_count || 0),
          worker_auto_eligible_ats_count: Number(status.worker_auto_eligible_ats_count || counts.worker_auto_eligible_ats_count || 0),
          excluded_ats_count: Number(status.excluded_ats_count || 0),
          company_count: Number(status.company_count || counts.company_count || 0),
          posting_count: Number(counts.posting_count || status.posting_count || 0),
          job_slot_count: Number(counts.job_slot_count || counts.posting_count || status.posting_count || 0),
          visible_company_count: Number(counts.visible_company_count || 0),
          configured_ats_count: Number(counts.configured_ats_count || 0),
          visible_ats_count: Number(counts.visible_ats_count || 0),
          postings_seen_24h_count: Number(status.postings_seen_24h_count || 0),
          write_pressure: status.running ? "active" : Number(status.queue_depth || 0) > 0 ? "due" : "idle",
          parser_attention_count: parserAttentionByAts.reduce((sum, item) => sum + Number(item?.error_count || 0), 0),
          ingestion_worker: buildPublicIngestionStatusItem(status.ingestion_worker || {}, {
            db_backend: status.db_backend || DB_BACKEND,
            search_backend: status.search_backend || SEARCH_BACKEND,
            search_reindex: readMeiliReindexStatus(),
            queue_backend: status.queue_backend || QUEUE_BACKEND,
            write_pressure: status.running ? "active" : Number(status.queue_depth || 0) > 0 ? "due" : "idle",
            parser_attention_count: parserAttentionByAts.reduce((sum, item) => sum + Number(item?.error_count || 0), 0),
            include_worker_diagnostics: includeAdminDiagnostics
          })
        });
      }

      const [counts, syncScopeStats, ingestionWorker, parserAttentionByAts] = await Promise.all([
        getCounts(),
        getSyncScopeStats(),
        getIngestionWorkerStatus(),
        getParserAttentionByAts()
      ]);
      return sanitizeFrontendValue({
        ...syncStatus,
        ...syncScopeStats,
        ...counts,
        db_backend: DB_BACKEND,
        search_backend: SEARCH_BACKEND,
        search_reindex: readMeiliReindexStatus(),
        queue_backend: QUEUE_BACKEND,
        legacy_api_sync: true,
        write_pressure: getWritePressure(ingestionWorker),
        parser_attention_count: parserAttentionByAts.reduce((sum, item) => sum + Number(item?.error_count || 0), 0),
        ingestion_worker: buildPublicIngestionStatusItem(ingestionWorker, {
          db_backend: DB_BACKEND,
          search_backend: SEARCH_BACKEND,
          search_reindex: readMeiliReindexStatus(),
          queue_backend: QUEUE_BACKEND,
          write_pressure: getWritePressure(ingestionWorker),
          parser_attention_count: parserAttentionByAts.reduce((sum, item) => sum + Number(item?.error_count || 0), 0),
          include_worker_diagnostics: includeAdminDiagnostics
        })
      });
    });
  });

  app.get("/ingestion/status", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const includeAdminDiagnostics = hasAdminAccess(req);
      if (DB_BACKEND === "postgres") {
        const [status, parserAttentionByAts, growth24h] = await Promise.all([
          getPostgresSyncStatus(postgresPool, { includeWorkerDiagnostics: includeAdminDiagnostics }),
          getPostgresParserAttentionByAts(postgresPool),
          includeAdminDiagnostics ? getPostgresGrowthSummary(postgresPool, { hours: 24 }) : Promise.resolve(null)
        ]);
        return sanitizeFrontendValue({
          ok: true,
          item: buildPublicIngestionStatusItem(status.ingestion_worker || {}, {
            db_backend: DB_BACKEND,
            search_backend: SEARCH_BACKEND,
            search_reindex: readMeiliReindexStatus(),
            queue_backend: QUEUE_BACKEND,
            write_pressure: status.running ? "active" : Number(status.queue_depth || 0) > 0 ? "due" : "idle",
            parser_attention_count: parserAttentionByAts.reduce((sum, item) => sum + Number(item?.error_count || 0), 0),
            include_worker_diagnostics: includeAdminDiagnostics,
            ...(includeAdminDiagnostics ? { growth_24h: growth24h } : {})
          })
        });
      }

      const [status, parserAttentionByAts] = await Promise.all([
        getIngestionWorkerStatus(),
        getParserAttentionByAts()
      ]);
      return sanitizeFrontendValue({
        ok: true,
        item: buildPublicIngestionStatusItem(status, {
          db_backend: DB_BACKEND,
          search_backend: SEARCH_BACKEND,
          search_reindex: readMeiliReindexStatus(),
          queue_backend: QUEUE_BACKEND,
          write_pressure: getWritePressure(status),
          parser_attention_count: parserAttentionByAts.reduce((sum, item) => sum + Number(item?.error_count || 0), 0),
          include_worker_diagnostics: includeAdminDiagnostics,
          ...(includeAdminDiagnostics ? { growth_24h: createEmptyGrowthSummary({ hours: 24 }) } : {})
        })
      });
    });
  });

  app.get("/search/popular", async (req, res) => {
    const languageCode = normalizePublicSeoLanguageCode(req.query.language || req.query.lang || "en");
    const limit = Math.max(1, Math.min(20, Number(req.query.limit || 8)));
    const countryScope = getPublicPopularSearchCountryScope(req, languageCode);
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      let report = null;
      let topQueries = [];
      let source = "fallback";
      let countryScopeApplied = false;
      let useTrustedPopularQueries = false;

      if (DB_BACKEND === "postgres" && typeof getPostgresPublicSearchReport === "function") {
        try {
          report = await getPostgresPublicSearchReport(postgresPool, {
            date: req.query.date || "today",
            limit: 50,
            countryScope,
            languageCode
          });
          topQueries = Array.isArray(report?.top_final_posting_searches)
            ? report.top_final_posting_searches
            : Array.isArray(report?.top_terms)
              ? report.top_terms
              : [];
          countryScopeApplied = Boolean(report?.country_scope_applied);
          if (
            countryScopeApplied &&
            topQueries.length > 0 &&
            topQueries.length < Math.min(limit, PUBLIC_POPULAR_COUNTRY_ANALYTICS_MIN_QUERIES)
          ) {
            topQueries = [];
          }
          if (topQueries.length > 0) source = countryScopeApplied ? "analytics_country" : "analytics";
          if (topQueries.length === 0 && countryScopeApplied) {
            topQueries = getPublicSeoCountryFallbackQueries(countryScope, languageCode, 50);
            if (topQueries.length > 0) {
              source = "research_country_fallback";
              useTrustedPopularQueries = true;
            } else {
              report = await getPostgresPublicSearchReport(postgresPool, {
                date: req.query.date || "today",
                limit: 50,
                languageCode
              });
              topQueries = Array.isArray(report?.top_final_posting_searches)
                ? report.top_final_posting_searches
                : Array.isArray(report?.top_terms)
                  ? report.top_terms
                  : [];
              if (topQueries.length > 0) source = "analytics_global_fallback";
            }
          }
        } catch (error) {
          console.warn("[openjobslots public search] popular search analytics fallback:", String(error?.message || error).slice(0, 240));
        }
      }
      if (topQueries.length === 0 && countryScope) {
        topQueries = getPublicSeoCountryFallbackQueries(countryScope, languageCode, 50);
        if (topQueries.length > 0) {
          source = "research_country_fallback";
          countryScopeApplied = true;
          useTrustedPopularQueries = true;
        }
      }

      const items = getPublicSeoPopularSearchItems(languageCode, topQueries, limit, {
        trustedQueryCounts: useTrustedPopularQueries,
        countryCode: countryScope
      });
      return {
        ok: true,
        items,
        count: items.length,
        source,
        date: report?.date || null,
        country_scope: countryScope || null,
        country_scope_applied: source === "analytics_country" || source === "research_country_fallback",
        country_scope_source: source
      };
    });
  });

  app.get("/search/suggest", async (req, res) => {
    const search = String(req.query.search || req.query.q || "").trim();
    const options = {
      search,
      limit: Number(req.query.limit || 8)
    };
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      if (DB_BACKEND === "postgres") {
        const items = await getPostgresSuggestions(postgresPool, search, Number(req.query.limit || 8), ATS_FILTER_OPTION_ITEMS);
        return {
          ok: true,
          items,
          count: items.length
        };
      }

      const items = await getSearchSuggestions(search, Number(req.query.limit || 8));
      return {
        ok: true,
        items,
        count: items.length
      };
    }, {
      afterPayload: (payload, info) => recordPublicSearchEvent(req, res, "suggest", search, payload, options, info)
    });
  });

  app.get("/postings/daily-reddit", async (req, res) => {
    const options = {
      date: req.query.date || "today",
      timezone: req.query.timezone || "Europe/Istanbul",
      limit: Number(req.query.limit || 10),
      country: req.query.country || "United States",
      remote: req.query.remote || "remote",
      seed: req.query.seed || "",
      publicSiteUrl
    };
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      if (DB_BACKEND !== "postgres" || typeof getPostgresDailyRedditPost !== "function") {
        return {
          ok: false,
          read_only: true,
          error: "daily_reddit_post_requires_postgres"
        };
      }
      return sanitizeFrontendValue(await getPostgresDailyRedditPost(postgresPool, options));
    });
  });

  app.get("/postings/open", async (req, res) => {
    const requestedUrl = normalizePublicPostingRedirectUrl(req.query.url || "");
    if (!requestedUrl) {
      return res.status(400).json({
        ok: false,
        error: "valid_url_required"
      });
    }

    if (DB_BACKEND !== "postgres" || !postgresPool || typeof postgresPool.query !== "function") {
      return res.status(404).json({
        ok: false,
        error: "posting_not_found"
      });
    }

    try {
      const result = await postgresPool.query(
        `
          SELECT canonical_url
          FROM postings
          WHERE hidden = false
            AND canonical_url = $1
          LIMIT 1;
        `,
        [requestedUrl]
      );
      const targetUrl = normalizePublicPostingRedirectUrl(result.rows?.[0]?.canonical_url || "");
      if (!targetUrl) {
        return res.status(404).json({
          ok: false,
          error: "posting_not_found"
        });
      }
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=900");
      return res.redirect(302, targetUrl);
    } catch (error) {
      console.warn("[openjobslots] public_posting_redirect_failed", String(error?.message || error).slice(0, 240));
      return res.status(500).json({
        ok: false,
        error: "posting_redirect_failed"
      });
    }
  });

  app.get("/postings/filter-options", async (req, res) => {
    const options = {
      search: String(req.query.search || "").trim(),
      freshness_days: req.query.freshness_days,
      ats: parseCsvParam(req.query.ats),
      industries: parseCsvParam(req.query.industries),
      states: parseCsvParam(req.query.states),
      counties: parseCsvParam(req.query.counties),
      countries: parseCsvParam(req.query.countries),
      regions: parseCsvParam(req.query.regions),
      remote: req.query.remote,
      hide_no_date: normalizeBoolean(req.query.hide_no_date, false),
      include_applied: false,
      include_ignored: false
    };
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      if (DB_BACKEND === "postgres") {
        return getPostgresFilterOptions(postgresPool, ATS_FILTER_OPTION_ITEMS, options);
      }

      const selectedStates = parseCsvParam(req.query.states).map((state) => state.toUpperCase());
      const syncSettings = await getSyncServiceSettings();
      const enabledAts = new Set(normalizeSyncEnabledAts(syncSettings?.sync_enabled_ats));
      const ats = ATS_FILTER_OPTION_ITEMS.map((item) => ({
        value: item.value,
        label: item.label,
        enabled: enabledAts.has(item.value)
      }));
      const sort_options = getPublicPostingSortOptions();

      let industries = [];
      try {
        industries = await db.all(
          `
            SELECT industry_key AS value, industry_label AS label
            FROM job_industry_categories
            ORDER BY industry_label ASC;
          `
        );
      } catch {
        try {
          industries = await db.all(
            `
              SELECT industry_key AS value, industry_label AS label
              FROM job_position_industry
              GROUP BY industry_key, industry_label
              ORDER BY industry_label ASC;
            `
          );
        } catch {
          industries = [];
        }
      }

      let states = [];
      try {
        const stateRows = await db.all(
          `
            SELECT DISTINCT state_usps
            FROM state_location_index
            WHERE state_usps IS NOT NULL AND TRIM(state_usps) <> ''
            ORDER BY state_usps ASC;
          `
        );
        states = stateRows.map((row) => {
          const code = String(row?.state_usps || "").trim().toUpperCase();
          const readableName = STATE_CODE_TO_NAME[code];
          return {
            value: code,
            label: readableName ? `${code} - ${readableName.replace(/\b\w/g, (c) => c.toUpperCase())}` : code
          };
        });
      } catch {
        states = [];
      }

      let counties = [];
      try {
        let countyRows = [];
        if (selectedStates.length === 0) {
          countyRows = await db.all(
            `
              SELECT DISTINCT state_usps, search_location_name
              FROM state_location_index
              WHERE location_type = 'county'
                AND search_location_name IS NOT NULL
                AND TRIM(search_location_name) <> ''
              ORDER BY state_usps ASC, search_location_name ASC;
            `
          );
        } else {
          const placeholders = selectedStates.map(() => "?").join(", ");
          countyRows = await db.all(
            `
              SELECT DISTINCT state_usps, search_location_name
              FROM state_location_index
              WHERE location_type = 'county'
                AND search_location_name IS NOT NULL
                AND TRIM(search_location_name) <> ''
                AND state_usps IN (${placeholders})
              ORDER BY state_usps ASC, search_location_name ASC;
            `,
            selectedStates
          );
        }

        counties = countyRows.map((row) => {
          const stateCode = String(row?.state_usps || "").trim().toUpperCase();
          const countyName = String(row?.search_location_name || "").trim();
          return {
            value: `${stateCode}|${countyName}`,
            label: `${countyName} (${stateCode})`,
            state: stateCode,
            county: countyName
          };
        });
      } catch {
        counties = [];
      }

      const locationGeoOptions = getPostingLocationGeoFilterOptions();

      return {
        ats,
        sort_options,
        industries,
        regions: Array.isArray(locationGeoOptions?.regions) ? locationGeoOptions.regions : [],
        countries: Array.isArray(locationGeoOptions?.countries) ? locationGeoOptions.countries : [],
        states,
        counties
      };
    }, {
      afterPayload: (payload, info) => recordPublicSearchEvent(req, res, "filter_options", options.search, payload, options, info)
    });
  });

  app.get("/postings", async (req, res) => {
    const options = {
      search: String(req.query.search || "").trim(),
      limit: Number(req.query.limit || 500),
      offset: Number(req.query.offset || 0),
      sort_by: String(req.query.sort_by || "posted_date").trim(),
      freshness_days: req.query.freshness_days,
      ats: parseCsvParam(req.query.ats),
      industries: parseCsvParam(req.query.industries),
      states: parseCsvParam(req.query.states),
      counties: parseCsvParam(req.query.counties),
      countries: parseCsvParam(req.query.countries),
      regions: parseCsvParam(req.query.regions),
      remote: req.query.remote,
      hide_no_date: normalizeBoolean(req.query.hide_no_date, false),
      include_applied: false,
      include_ignored: false
    };
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const rawSearch = options.search || "";
      let result;
      if (/\bOR\b/i.test(rawSearch)) {
        const subQueries = rawSearch.split(/\s+OR\s+/i).map(q => q.trim()).filter(Boolean);
        if (subQueries.length > 1) {
          const promises = subQueries.map(async (subQ) => {
            const subOptions = { ...options, search: subQ };
            try {
              return DB_BACKEND === "postgres"
                ? await listPostgresPostings(postgresPool, subOptions)
                : await listPostingsWithFilters(subOptions);
            } catch (err) {
              console.error(`[OR Search] Subquery "${subQ}" failed:`, err);
              return { items: [], count: 0, source_facets: [] };
            }
          });
          const results = await Promise.all(promises);

          const mergedMap = new Map();
          let countExact = true;
          let pageCapped = false;
          let countCapped = false;
          let visibleAtsCount = 0;
          let visibleCompanyCount = 0;
          const sourceFacetsMap = new Map();

          results.forEach(res => {
            const items = res?.items || [];
            items.forEach(item => {
              const url = item.canonical_url || item.job_posting_url || "";
              if (url && !mergedMap.has(url)) {
                mergedMap.set(url, item);
              }
            });

            if (res?.count_exact === false) countExact = false;
            if (res?.page_capped) pageCapped = true;
            if (res?.count_capped) countCapped = true;
            if (res?.visible_ats_count) visibleAtsCount = Math.max(visibleAtsCount, res.visible_ats_count);
            if (res?.visible_company_count) visibleCompanyCount = Math.max(visibleCompanyCount, res.visible_company_count);

            const facets = res?.source_facets || [];
            facets.forEach(f => {
              const val = f.value;
              if (sourceFacetsMap.has(val)) {
                const existing = sourceFacetsMap.get(val);
                existing.count += f.count;
                if (typeof f.fresh_count === "number") {
                  existing.fresh_count = (existing.fresh_count || 0) + f.fresh_count;
                }
              } else {
                sourceFacetsMap.set(val, { ...f });
              }
            });
          });

          let mergedItems = Array.from(mergedMap.values());
          const sortBy = String(options.sort_by || "posted_date").trim().toLowerCase();
          if (sortBy === "posted_date" || sortBy === "posted_at") {
            mergedItems.sort((a, b) => {
              const aTime = Number(a.posted_at_epoch || a.posting_date_epoch || 0);
              const bTime = Number(b.posted_at_epoch || b.posting_date_epoch || 0);
              if (bTime !== aTime) return bTime - aTime;
              const aSeen = Number(a.last_seen_epoch || 0);
              const bSeen = Number(b.last_seen_epoch || 0);
              return bSeen - aSeen;
            });
          } else if (sortBy === "last_seen" || sortBy === "recent" || sortBy === "fresh_source") {
            mergedItems.sort((a, b) => {
              const aSeen = Number(a.last_seen_epoch || 0);
              const bSeen = Number(b.last_seen_epoch || 0);
              return bSeen - aSeen;
            });
          } else if (sortBy === "confidence") {
            mergedItems.sort((a, b) => {
              const aConf = Number(a.confidence || 0);
              const bConf = Number(b.confidence || 0);
              if (bConf !== aConf) return bConf - aConf;
              const aQual = Number(a.quality_score || 0);
              const bQual = Number(b.quality_score || 0);
              return bQual - aQual;
            });
          }

          const limit = Math.max(1, Number(options.limit || 500));
          const offset = Math.max(0, Number(options.offset || 0));
          const paginatedItems = mergedItems.slice(offset, offset + limit);

          const sortedFacets = Array.from(sourceFacetsMap.values())
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
            .slice(0, 8);

          // Calculate fresh_percentage for facets
          sortedFacets.forEach(facet => {
            if (facet.count > 0) {
              facet.fresh_percentage = Math.round(((facet.fresh_count || 0) / facet.count) * 100);
            }
          });

          result = {
            items: paginatedItems,
            count: mergedItems.length,
            count_exact: countExact,
            count_capped: countCapped,
            page_capped: pageCapped,
            visible_ats_count: visibleAtsCount,
            visible_company_count: visibleCompanyCount,
            source_facets: sortedFacets,
            limit,
            offset,
            filters: {
              search: rawSearch,
              sort_by: options.sort_by,
              freshness_days: options.freshness_days,
              ...(results[0]?.filters || {})
            }
          };
        }
      }

      if (!result) {
        result =
          DB_BACKEND === "postgres"
            ? await listPostgresPostings(postgresPool, options)
            : await listPostingsWithFilters(options);
      }
      const resultItems = Array.isArray(result.items) ? result.items : [];
      const resultLimit = Math.max(1, Number(result.limit || options.limit || 500));
      const resultOffset = Math.max(0, Number(result.offset || options.offset || 0));
      const resultCount = Math.max(0, Number(result.count || 0));
      const loadedThrough = resultOffset + resultItems.length;
      const hasMore =
        resultCount > loadedThrough ||
        (resultItems.length >= resultLimit && resultCount <= loadedThrough);
      const publicCount = hasMore
        ? Math.max(resultCount, loadedThrough + 1)
        : Math.max(resultCount, loadedThrough);
      const visibleAtsCount = Number.isFinite(Number(result?.visible_ats_count))
        ? Math.max(0, Number(result.visible_ats_count))
        : undefined;
      const visibleCompanyCount = Number.isFinite(Number(result?.visible_company_count))
        ? Math.max(0, Number(result.visible_company_count))
        : undefined;

      return {
        items: sanitizeFrontendValue(sanitizePublicPostings(resultItems)),
        count: publicCount,
        count_exact: result?.count_exact === false ? false : true,
        count_capped: Boolean(result?.count_capped),
        page_capped: Boolean(result?.page_capped),
        ...(visibleAtsCount === undefined ? {} : { visible_ats_count: visibleAtsCount }),
        ...(visibleCompanyCount === undefined ? {} : { visible_company_count: visibleCompanyCount }),
        source_facets: sanitizeFrontendValue(sanitizePublicSourceFacets(result?.source_facets)),
        limit: resultLimit,
        offset: resultOffset,
        filters: sanitizeFrontendValue(result?.filters || {
          search: options.search,
          sort_by: normalizePostingSort(options.sort_by),
          freshness_days: normalizeFreshnessDays(options.freshness_days)
        }),
        has_more: Boolean(hasMore && resultItems.length > 0),
        next_offset: hasMore && resultItems.length > 0 ? loadedThrough : null
      };
    }, {
      afterPayload: (payload, info) => recordPublicSearchEvent(req, res, "postings", options.search, payload, options, info)
    });
  });

  const webDistPath = context.webDistPath || path.resolve(__dirname, "..", "..", "dist");
  const webIndexPath = context.webIndexPath || path.join(webDistPath, "index.html");
  if (fs.existsSync(webIndexPath)) {
    const sendSeoIndex = (req, res, next) => {
      try {
        const indexHtml = fs.readFileSync(webIndexPath, "utf8");
        setPublicSeoCacheHeaders(res, 60, 300);
        setPublicLanguageHintCookie(req, res);
        res.type("html").send(renderSeoIndexHtml(indexHtml, req));
      } catch (error) {
        next(error);
      }
    };

    app.get(["/", "/index.html"], sendSeoIndex);
    app.get("/privacy", (req, res) => {
      setPublicSeoCacheHeaders(res, 300, 3600);
      res.type("html").send(buildPrivacyPolicyHtml(req));
    });
    app.get("/privacy-policy", (req, res) => {
      res.redirect(301, "/privacy");
    });
    const sendDataDeletionPage = (req, res) => {
      setPublicSeoCacheHeaders(res, 300, 3600);
      res.type("html").send(buildDataDeletionHtml(req));
    };
    app.get(["/data-deletion", "/google-play-data-deletion"], sendDataDeletionPage);
    app.delete(["/data-deletion", "/google-play-data-deletion"], sendDataDeletionPage);
    app.get("/robots.txt", (req, res) => {
      setPublicSeoCacheHeaders(res, 300, 3600);
      res.type("text/plain").send(buildRobotsTxt(req));
    });
    app.get("/llms.txt", (req, res) => {
      setPublicSeoCacheHeaders(res, 300, 3600);
      res.type("text/plain").send(buildLlmsTxt(req));
    });
    app.get("/llms-full.txt", (req, res) => {
      setPublicSeoCacheHeaders(res, 300, 3600);
      res.type("text/plain").send(buildLlmsFullTxt(req));
    });
    app.get("/sitemap.xml", (req, res) => {
      setPublicSeoCacheHeaders(res, 300, 3600);
      res.type("application/xml").send(buildSitemapXml(req));
    });
    app.get(["/sitemaps/static.xml", "/sitemaps/ats-sources.xml"], (req, res, next) => {
      const xml = buildSitemapSectionXml(req, req.path);
      if (!xml) return next();
      setPublicSeoCacheHeaders(res, 300, 3600);
      return res.type("application/xml").send(xml);
    });
    app.use(express.static(webDistPath, {
      extensions: ["html"],
      index: false,
      maxAge: "5m"
    }));
    app.use((req, res, next) => {
      if ((req.method === "GET" || req.method === "HEAD") && req.accepts("html")) {
        return sendSeoIndex(req, res, next);
      }
      return next();
    });
  }

}

module.exports = {
  getCanonicalPublicHostRedirectTarget,
  isInternalPublicAnalyticsProbe,
  registerPublicRoutes
};
