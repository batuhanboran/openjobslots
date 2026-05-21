function registerAdminRoutes(app, context) {
  const {
    DB_BACKEND,
    DB_PATH,
    PORT,
    QUEUE_BACKEND,
    SEARCH_BACKEND,
    createEmptyGrowthSummary,
    db,
    getAdapterMetadata,
    getCounts,
    getIngestionWorkerStatus,
    getMeiliSettingsStatus,
    getPostgresAtsAdmin,
    getPostgresAtsFieldQualityByAts,
    getPostgresCounts,
    getPostgresGrowthSummary,
    getPostgresParserAdmin,
    getPostgresParserAttentionByAts,
    getPostgresParserStats,
    getPostgresPostingDiagnostics,
    getPostgresQualitySummary,
    getPostgresQuarantineSummary,
    getPostgresSourceQualityDashboard,
    getPostgresSyncStatus,
    getSqliteParserStats,
    getSqlitePostingDiagnostics,
    getSqliteQualitySummary,
    getSyncPromise,
    getSyncScopeStats,
    listPostgresIngestionErrors,
    listPostgresIngestionRuns,
    listPostgresIngestionSources,
    listPostgresParserDriftEvents,
    listPostgresRejections,
    listSqliteRejections,
    normalizeAtsFilterValue,
    normalizeGrowthHours,
    nowEpochSeconds,
    parseJsonArray,
    parseJsonObject,
    postgresPool,
    publicReadCache,
    readMeiliReindexStatus,
    readSourceQualityThresholds,
    requestSyncStart,
    requestSyncStop,
    runWorkdaySync,
    sanitizeFrontendValue,
    sendCachedPublicJson,
    syncStatus
  } = context;

  const handleSyncRequest = async (req, res) => {
    if (DB_BACKEND === "postgres") {
      const control = await requestSyncStart(postgresPool);
      const status = await getPostgresSyncStatus(postgresPool);
      return res.status(202).json(sanitizeFrontendValue({
        ok: true,
        started: String(control?.status || "") === "requested",
        running: true,
        ...status
      }));
    }

    const wait = String(req.query.wait || "").toLowerCase();
    const shouldWait = wait === "1" || wait === "true";
    const wasRunning = Boolean(getSyncPromise());
    const promise = runWorkdaySync();

    if (shouldWait) {
      await promise;
      const [counts, syncScopeStats] = await Promise.all([getCounts(), getSyncScopeStats()]);
      return res.json({
        ok: true,
        started: !wasRunning,
        running: syncStatus.running,
        ...syncStatus,
        ...syncScopeStats,
        ...counts
      });
    }

    return res.status(202).json({
      ok: true,
      started: !wasRunning,
      running: true
    });
  };

  app.get("/ingestion/growth-summary", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const hours = normalizeGrowthHours(req.query.hours || 24);
      const report = DB_BACKEND === "postgres"
        ? await getPostgresGrowthSummary(postgresPool, { hours })
        : {
            ...createEmptyGrowthSummary({ hours }),
            skipped: true,
            reason: "growth summary requires the Postgres production source of truth"
          };
      return sanitizeFrontendValue({
        ok: true,
        db_backend: DB_BACKEND,
        search_backend: SEARCH_BACKEND,
        ...report
      });
    });
  });

  app.get("/postings/diagnostics", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const canonicalUrl = String(req.query.url || "").trim();
      const item = DB_BACKEND === "postgres"
        ? await getPostgresPostingDiagnostics(postgresPool, { canonicalUrl })
        : await getSqlitePostingDiagnostics({ canonicalUrl });
      if (!item) {
        return {
          ok: false,
          error: "Posting diagnostics not found"
        };
      }
      return sanitizeFrontendValue({ ok: true, item });
    });
  });

  app.get("/postings/:id/diagnostics", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const id = Number(req.params.id || 0);
      const item = DB_BACKEND === "postgres"
        ? null
        : await getSqlitePostingDiagnostics({ id });
      if (!item) {
        return {
          ok: false,
          error: "Posting diagnostics not found"
        };
      }
      return sanitizeFrontendValue({ ok: true, item });
    });
  });

  app.get("/ingestion/quality/summary", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const limit = Number(req.query.limit || 100);
      const report = DB_BACKEND === "postgres"
        ? await getPostgresQualitySummary(postgresPool, limit)
        : await getSqliteQualitySummary(limit);
      return sanitizeFrontendValue({
        ok: true,
        db_backend: DB_BACKEND,
        search_backend: SEARCH_BACKEND,
        summary: report.summary,
        by_source: report.by_source,
        by_parser: report.by_parser || [],
        visibility: report.visibility || {},
        items: report.items || report.by_source || [],
        count: Number(report.count || (report.items || report.by_source || []).length)
      });
    });
  });

  app.get("/ingestion/rejections", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const limit = Number(req.query.limit || 50);
      const items = DB_BACKEND === "postgres"
        ? await listPostgresRejections(postgresPool, limit)
        : await listSqliteRejections(limit);
      return sanitizeFrontendValue({
        ok: true,
        items,
        count: items.length
      });
    });
  });

  app.get("/ingestion/parser-stats", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const limit = Number(req.query.limit || 100);
      const items = DB_BACKEND === "postgres"
        ? await getPostgresParserStats(postgresPool, limit)
        : await getSqliteParserStats(limit);
      return sanitizeFrontendValue({
        ok: true,
        db_backend: DB_BACKEND,
        search_backend: SEARCH_BACKEND,
        items,
        count: items.length
      });
    });
  });

  app.get("/ingestion/source-quality", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const limit = Number(req.query.limit || 100);
      const items = DB_BACKEND === "postgres"
        ? await getPostgresSourceQualityDashboard(postgresPool, limit)
        : [];
      return sanitizeFrontendValue({
        ok: true,
        db_backend: DB_BACKEND,
        search_backend: SEARCH_BACKEND,
        thresholds: DB_BACKEND === "postgres" ? readSourceQualityThresholds() : {},
        items,
        count: items.length
      });
    });
  });

  app.get("/ingestion/parser-drift", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const limit = Number(req.query.limit || 100);
      const items = DB_BACKEND === "postgres"
        ? await listPostgresParserDriftEvents(postgresPool, limit)
        : [];
      return sanitizeFrontendValue({
        ok: true,
        db_backend: DB_BACKEND,
        items,
        count: items.length
      });
    });
  });

  app.get("/ingestion/quarantine-summary", async (req, res) => {
    return sendCachedPublicJson(req, res, publicReadCache, async () => {
      const limit = Number(req.query.limit || 100);
      const summary = DB_BACKEND === "postgres"
        ? await getPostgresQuarantineSummary(postgresPool, limit)
        : { by_source: [], by_reason: [], by_parser: [] };
      return sanitizeFrontendValue({
        ok: true,
        db_backend: DB_BACKEND,
        ...summary
      });
    });
  });

  app.get("/admin/services", async (_req, res) => {
    res.json(sanitizeFrontendValue({
      ok: true,
      services: {
        app: {
          role: "api-and-static-web",
          public: true,
          port: PORT
        },
        worker: {
          role: "ingestion",
          public: false
        },
        postgres: {
          role: "primary-database-and-durable-cache",
          active: DB_BACKEND === "postgres",
          public: false
        },
        meilisearch: {
          role: "search-index",
          active: SEARCH_BACKEND === "meili",
          public: false
        },
        redis_or_valkey: {
          active: false,
          reason: "Not needed for the single-machine v1 stack."
        },
        extra_load_balancer: {
          active: false,
          reason: "Nginx Proxy Manager remains the only public reverse proxy."
        }
      }
    }));
  });

  app.get("/admin/storage", async (_req, res) => {
    const counts = DB_BACKEND === "postgres" ? await getPostgresCounts(postgresPool) : await getCounts();
    res.json(sanitizeFrontendValue({
      ok: true,
      db_backend: DB_BACKEND,
      search_backend: SEARCH_BACKEND,
      queue_backend: QUEUE_BACKEND,
      primary_store: DB_BACKEND === "postgres" ? "postgres" : "sqlite",
      search_store: SEARCH_BACKEND === "meili" ? "meilisearch" : "sqlite",
      search_settings: getMeiliSettingsStatus(),
      search_reindex: readMeiliReindexStatus(),
      sqlite_path: DB_BACKEND === "postgres" ? "backup/import only" : DB_PATH,
      ...counts
    }));
  });

  app.get("/admin/queue", async (_req, res) => {
    const status = DB_BACKEND === "postgres" ? await getPostgresSyncStatus(postgresPool) : {
      running: syncStatus.running,
      queue_depth: 0,
      queue_backend: QUEUE_BACKEND,
      ingestion_worker: await getIngestionWorkerStatus()
    };
    res.json(sanitizeFrontendValue({
      ok: true,
      db_backend: DB_BACKEND,
      search_backend: SEARCH_BACKEND,
      queue_backend: QUEUE_BACKEND,
      running: Boolean(status.running),
      stopping: Boolean(status.stopping),
      cancel_requested: Boolean(status.cancel_requested),
      queue_depth: Number(status.queue_depth || status.ingestion_worker?.queue_due_count || 0),
      active_ats: status.active_ats || status.ingestion_worker?.active_ats || []
    }));
  });

  app.post("/sync/start", handleSyncRequest);

  app.post("/sync/stop", async (_req, res) => {
    if (DB_BACKEND === "postgres") {
      const control = await requestSyncStop(postgresPool);
      const status = await getPostgresSyncStatus(postgresPool);
      return res.status(202).json(sanitizeFrontendValue({
        ok: true,
        stopped: String(control?.status || "") === "idle",
        stopping: status.stopping,
        running: status.running,
        ...status
      }));
    }

    return res.status(202).json({
      ok: true,
      stopping: Boolean(getSyncPromise()),
      running: Boolean(getSyncPromise()),
      legacy_api_sync: true,
      message: getSyncPromise()
        ? "Legacy in-process sync cannot cancel mid-run. Restart the app container to interrupt it."
        : "No sync is running."
    });
  });

  app.post("/sync/workday", handleSyncRequest);
  app.post("/sync/ats", handleSyncRequest);

  app.get("/admin/ats", async (_req, res) => {
    if (DB_BACKEND === "postgres") {
      return res.json({
        ok: true,
        db_backend: DB_BACKEND,
        search_backend: SEARCH_BACKEND,
        queue_backend: QUEUE_BACKEND,
        items: await getPostgresAtsAdmin(postgresPool)
      });
    }

    const rows = await db.all(
      `
        SELECT
          s.ats_key,
          s.display_name,
          s.enabled,
          s.default_ttl_seconds,
          s.rate_limit_ms,
          COUNT(c.id) AS company_count
        FROM ats_sources s
        LEFT JOIN companies c
          ON LOWER(TRIM(c.ATS_name)) = s.ats_key
        GROUP BY s.ats_key, s.display_name, s.enabled, s.default_ttl_seconds, s.rate_limit_ms
        ORDER BY s.display_name ASC;
      `
    );
    res.json({
      ok: true,
      db_backend: DB_BACKEND,
      search_backend: SEARCH_BACKEND,
      queue_backend: QUEUE_BACKEND,
      items: rows.map((row) => ({
        ats_key: String(row?.ats_key || ""),
        display_name: String(row?.display_name || ""),
        enabled: Number(row?.enabled || 0) === 1,
        default_ttl_seconds: Number(row?.default_ttl_seconds || 0),
        rate_limit_ms: Number(row?.rate_limit_ms || 0),
        company_count: Number(row?.company_count || 0)
      }))
    });
  });

  app.get("/admin/parsers", async (_req, res) => {
    if (DB_BACKEND === "postgres") {
      const [atsItems, parserAttentionByAts, fieldQualityByAts] = await Promise.all([
        getPostgresAtsAdmin(postgresPool),
        getPostgresParserAttentionByAts(postgresPool, 100),
        getPostgresAtsFieldQualityByAts(postgresPool)
      ]);
      const attentionByKey = new Map(parserAttentionByAts.map((item) => [item.ats_key, item]));
      const fieldQualityByKey = new Map(fieldQualityByAts.map((item) => [item.ats_key, item]));
      return res.json(sanitizeFrontendValue({
        ok: true,
        db_backend: DB_BACKEND,
        search_backend: SEARCH_BACKEND,
        queue_backend: QUEUE_BACKEND,
        items: atsItems.map((item) => {
          const metadata = getAdapterMetadata(item.ats_key, item.display_name);
          const attention = attentionByKey.get(item.ats_key) || null;
          const fieldQuality = fieldQualityByKey.get(item.ats_key) || null;
          return {
            ...item,
            parser_version: "postgres-adapter-v1",
            fixture_status: metadata.fixtureStatus,
            parser_fixture_status: metadata.parserFixtureStatus,
            confidence: metadata.confidence,
            tier: metadata.tier,
            parse_strategy: metadata.parseStrategy,
            enabled_by_default: metadata.enabledByDefault,
            field_quality: fieldQuality,
            parser_attention_count_24h: Number(attention?.error_count || 0),
            latest_parser_error_at: attention?.latest_error_at || "",
            latest_parser_error: attention?.latest_error || ""
          };
        })
      }));
    }

    const rows = await db.all(
      `
        SELECT ats_key, display_name, enabled, default_ttl_seconds, rate_limit_ms
        FROM ats_sources
        ORDER BY display_name ASC;
      `
    );
    const parserAttentionByAts = await getParserAttentionByAts();
    const attentionByKey = new Map(parserAttentionByAts.map((item) => [item.ats_key, item]));
    return res.json(sanitizeFrontendValue({
      ok: true,
      db_backend: DB_BACKEND,
      search_backend: SEARCH_BACKEND,
      queue_backend: QUEUE_BACKEND,
      items: rows.map((row) => {
        const metadata = getAdapterMetadata(row.ats_key, row.display_name);
        const attention = attentionByKey.get(String(row.ats_key || "")) || null;
        return {
          ats_key: String(row.ats_key || ""),
          display_name: String(row.display_name || ""),
          enabled: Number(row.enabled || 0) === 1,
          default_ttl_seconds: Number(row.default_ttl_seconds || 0),
          rate_limit_ms: Number(row.rate_limit_ms || 0),
          parser_version: "legacy-adapter-v1",
          fixture_status: metadata.fixtureStatus,
          parser_fixture_status: metadata.parserFixtureStatus,
          confidence: metadata.confidence,
          tier: metadata.tier,
          parse_strategy: metadata.parseStrategy,
          enabled_by_default: metadata.enabledByDefault,
          parser_attention_count_24h: Number(attention?.error_count || 0),
          latest_parser_error_at: attention?.latest_error_at || "",
          latest_parser_error: attention?.latest_error || ""
        };
      })
    }));
  });

  app.get("/admin/parsers/:ats_key", async (req, res) => {
    if (DB_BACKEND === "postgres") {
      const item = await getPostgresParserAdmin(postgresPool, req.params.ats_key);
      if (!item) {
        return res.status(404).json({ ok: false, error: "ATS parser not found" });
      }
      return res.json({ ok: true, item });
    }

    const atsKey = normalizeAtsFilterValue(req.params.ats_key);
    const source = await db.get(
      `
        SELECT ats_key, display_name, enabled, default_ttl_seconds, rate_limit_ms
        FROM ats_sources
        WHERE ats_key = ?;
      `,
      [atsKey]
    );
    if (!source) {
      return res.status(404).json({ ok: false, error: "ATS parser not found" });
    }
    const errorRows = await db.all(
      `
        SELECT run_id, company_url, company_name, error_type, error_message, http_status, created_at
        FROM ingestion_run_errors
        WHERE ats_key = ?
        ORDER BY id DESC
        LIMIT 25;
      `,
      [atsKey]
    );
    return res.json({
      ok: true,
      item: {
        ats_key: String(source.ats_key || ""),
        display_name: String(source.display_name || ""),
        enabled: Number(source.enabled || 0) === 1,
        default_ttl_seconds: Number(source.default_ttl_seconds || 0),
        rate_limit_ms: Number(source.rate_limit_ms || 0),
        parser_version: "legacy-adapter-v1",
        fixture_status: getAdapterMetadata(atsKey, source.display_name).fixtureStatus,
        confidence: getAdapterMetadata(atsKey, source.display_name).confidence,
        tier: getAdapterMetadata(atsKey, source.display_name).tier,
        parse_strategy: getAdapterMetadata(atsKey, source.display_name).parseStrategy,
        enabled_by_default: getAdapterMetadata(atsKey, source.display_name).enabledByDefault,
        recent_errors: errorRows.map((row) => ({
          run_id: Number(row?.run_id || 0),
          company_url: String(row?.company_url || ""),
          company_name: String(row?.company_name || ""),
          error_type: String(row?.error_type || "unknown"),
          error_message: String(row?.error_message || ""),
          http_status: row?.http_status == null ? null : Number(row.http_status),
          created_at: String(row?.created_at || "")
        }))
      }
    });
  });

  app.get("/admin/ingestion/runs", async (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
    if (DB_BACKEND === "postgres") {
      return res.json({
        ok: true,
        items: await listPostgresIngestionRuns(postgresPool, limit)
      });
    }

    const rows = await db.all(
      `
        SELECT
          id,
          started_at_epoch,
          finished_at_epoch,
          status,
          total_targets,
          success_count,
          failure_count,
          cache_hit_count,
          cache_write_count,
          posting_upsert_count,
          rejected_count,
          duplicate_count,
          db_busy_count,
          current_ats,
          current_company_url,
          current_company_name,
          http_status_counts,
          active_ats,
          last_error
        FROM ingestion_runs
        ORDER BY id DESC
        LIMIT ?;
      `,
      [limit]
    );
    res.json({
      ok: true,
      items: rows.map((row) => ({
        id: Number(row?.id || 0),
        started_at_epoch: Number(row?.started_at_epoch || 0),
        finished_at_epoch: Number(row?.finished_at_epoch || 0),
        status: String(row?.status || ""),
        total_targets: Number(row?.total_targets || 0),
        success_count: Number(row?.success_count || 0),
        failure_count: Number(row?.failure_count || 0),
        cache_hit_count: Number(row?.cache_hit_count || 0),
        cache_write_count: Number(row?.cache_write_count || 0),
        posting_upsert_count: Number(row?.posting_upsert_count || 0),
        rejected_count: Number(row?.rejected_count || 0),
        duplicate_count: Number(row?.duplicate_count || 0),
        db_busy_count: Number(row?.db_busy_count || 0),
        current_ats: String(row?.current_ats || ""),
        current_company_url: String(row?.current_company_url || ""),
        current_company_name: String(row?.current_company_name || ""),
        http_status_counts: parseJsonObject(row?.http_status_counts),
        active_ats: parseJsonArray(row?.active_ats),
        last_error: String(row?.last_error || "")
      }))
    });
  });

  app.get("/admin/ingestion/errors", async (req, res) => {
    const limit = Math.max(1, Math.min(250, Number(req.query.limit || 50)));
    if (DB_BACKEND === "postgres") {
      return res.json(sanitizeFrontendValue({
        ok: true,
        items: await listPostgresIngestionErrors(postgresPool, limit)
      }));
    }

    const rows = await db.all(
      `
        SELECT
          id,
          run_id,
          ats_key,
          company_url,
          company_name,
          error_type,
          error_message,
          http_status,
          created_at
        FROM ingestion_run_errors
        ORDER BY id DESC
        LIMIT ?;
      `,
      [limit]
    );
    return res.json(sanitizeFrontendValue({
      ok: true,
      items: rows.map((row) => ({
        id: Number(row?.id || 0),
        run_id: Number(row?.run_id || 0),
        ats_key: String(row?.ats_key || ""),
        company_url: String(row?.company_url || ""),
        company_name: String(row?.company_name || ""),
        error_type: String(row?.error_type || "unknown"),
        error_message: String(row?.error_message || ""),
        http_status: row?.http_status == null ? null : Number(row.http_status),
        created_at: String(row?.created_at || "")
      }))
    }));
  });

  app.get("/admin/ingestion/sources", async (req, res) => {
    const limit = Math.max(1, Math.min(250, Number(req.query.limit || 100)));
    if (DB_BACKEND === "postgres") {
      return res.json(sanitizeFrontendValue({
        ok: true,
        items: await listPostgresIngestionSources(postgresPool, limit)
      }));
    }

    const rows = await db.all(
      `
        SELECT
          s.ats_key,
          s.display_name,
          s.enabled,
          s.default_ttl_seconds,
          s.rate_limit_ms,
          COUNT(DISTINCT c.id) AS company_count,
          COUNT(DISTINCT CASE WHEN COALESCE(st.next_sync_epoch, 0) <= ? THEN c.id END) AS due_company_count,
          MAX(st.last_success_epoch) AS last_success_epoch,
          MAX(st.last_failure_epoch) AS last_failure_epoch,
          SUM(COALESCE(st.consecutive_failures, 0)) AS consecutive_failure_total
        FROM ats_sources s
        LEFT JOIN companies c
          ON LOWER(TRIM(c.ATS_name)) = s.ats_key
        LEFT JOIN company_sync_state st
          ON st.ats_key = s.ats_key
          AND st.company_url = c.url_string
        GROUP BY s.ats_key, s.display_name, s.enabled, s.default_ttl_seconds, s.rate_limit_ms
        ORDER BY due_company_count DESC, company_count DESC, s.display_name ASC
        LIMIT ?;
      `,
      [nowEpochSeconds(), limit]
    );
    return res.json(sanitizeFrontendValue({
      ok: true,
      items: rows.map((row) => ({
        ats_key: String(row?.ats_key || ""),
        display_name: String(row?.display_name || ""),
        enabled: Number(row?.enabled || 0) === 1,
        default_ttl_seconds: Number(row?.default_ttl_seconds || 0),
        rate_limit_ms: Number(row?.rate_limit_ms || 0),
        company_count: Number(row?.company_count || 0),
        due_company_count: Number(row?.due_company_count || 0),
        last_success_epoch: Number(row?.last_success_epoch || 0),
        last_failure_epoch: Number(row?.last_failure_epoch || 0),
        consecutive_failure_total: Number(row?.consecutive_failure_total || 0)
      }))
    }));
  });

}

module.exports = {
  registerAdminRoutes
};
