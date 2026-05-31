const crypto = require("crypto");
const {
  getPublicSeoCountryFallbackQueries,
  getPublicSeoPopularSearchItems
} = require("../../src/publicSeoRoutes");

const PUBLIC_ANALYTICS_SESSION_COOKIE = "ojs_anon_session";
const PUBLIC_ANALYTICS_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_LANGUAGE_COUNTRY_BY_CODE = Object.freeze({
  en: "US",
  tr: "TR",
  de: "DE",
  fr: "FR",
  es: "ES"
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
    buildLlmsTxt,
    buildRobotsTxt,
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

  app.use((req, res, next) => {
    const canonicalTarget = getCanonicalPublicHostRedirectTarget(req);
    if (canonicalTarget) return res.redirect(301, canonicalTarget);
    return next();
  });

  function recordPublicSearchEvent(req, res, eventType, search, payload, options = {}, info = {}) {
    if (DB_BACKEND !== "postgres" || typeof recordPostgresPublicSearchEvent !== "function") return;
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
    const languageCode = String(req.query.language || req.query.lang || "en").trim().toLowerCase();
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
            countryScope
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
                limit: 50
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
        trustedQueryCounts: useTrustedPopularQueries
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
      const result =
        DB_BACKEND === "postgres"
          ? await listPostgresPostings(postgresPool, options)
          : await listPostingsWithFilters(options);
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

      return {
        items: sanitizeFrontendValue(sanitizePublicPostings(resultItems)),
        count: publicCount,
        count_exact: result?.count_exact === false ? false : true,
        count_capped: Boolean(result?.count_capped),
        page_capped: Boolean(result?.page_capped),
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
        res.type("html").send(renderSeoIndexHtml(indexHtml, req));
      } catch (error) {
        next(error);
      }
    };

    app.get(["/", "/index.html"], sendSeoIndex);
    app.get("/robots.txt", (req, res) => {
      setPublicSeoCacheHeaders(res, 300, 3600);
      res.type("text/plain").send(buildRobotsTxt(req));
    });
    app.get("/llms.txt", (req, res) => {
      setPublicSeoCacheHeaders(res, 300, 3600);
      res.type("text/plain").send(buildLlmsTxt(req));
    });
    app.get("/sitemap.xml", (req, res) => {
      setPublicSeoCacheHeaders(res, 300, 3600);
      res.type("application/xml").send(buildSitemapXml(req));
    });
    app.use(express.static(webDistPath, {
      extensions: ["html"],
      index: false,
      maxAge: "5m"
    }));
    app.use((req, res, next) => {
      if (req.method === "GET" && req.accepts("html")) {
        return sendSeoIndex(req, res, next);
      }
      return next();
    });
  }

}

module.exports = {
  getCanonicalPublicHostRedirectTarget,
  registerPublicRoutes
};
