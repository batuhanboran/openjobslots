function registerUserRoutes(app, context) {
  const {
    APPLICATION_STATUS_OPTIONS,
    MCP_SETTINGS_DEFAULTS,
    blockCompanyByName,
    buildCoverLetterDraft,
    buildMcpRunbook,
    createApplication,
    db,
    deleteApplicationById,
    ensureMcpAgentEnabled,
    getMcpSettings,
    getPersonalInformation,
    getSyncServiceSettings,
    listApplications,
    listBlockedCompanies,
    listPostingsWithFilters,
    migrateSettingsAndApplicationsFromDatabase,
    normalizeBoolean,
    normalizeRemoteFilter,
    normalizeStringArray,
    nowEpochSeconds,
    parseCsvParam,
    parseNonNegativeInteger,
    setPostingIgnoredState,
    unblockCompanyByName,
    updateApplicationStatus,
    upsertMcpSettings,
    upsertPersonalInformation,
    upsertSyncServiceSettings
  } = context;

  app.get("/settings/personal-information", async (_req, res) => {
    const item = await getPersonalInformation();
    res.json({ item });
  });

  app.put("/settings/personal-information", async (req, res) => {
    const item = await upsertPersonalInformation(req.body);
    res.json({
      ok: true,
      item
    });
  });

  app.get("/settings/mcp", async (_req, res) => {
    const item = await getMcpSettings();
    res.json({ item });
  });

  app.put("/settings/mcp", async (req, res) => {
    const item = await upsertMcpSettings(req.body || {});
    res.json({
      ok: true,
      item
    });
  });

  app.get("/settings/sync", async (_req, res) => {
    const item = await getSyncServiceSettings();
    res.json({ item });
  });

  app.put("/settings/sync", async (req, res) => {
    const item = await upsertSyncServiceSettings(req.body || {});
    res.json({
      ok: true,
      item
    });
  });

  app.get("/settings/sync/blocked-companies", async (_req, res) => {
    const items = await listBlockedCompanies();
    res.json({
      ok: true,
      items,
      count: items.length
    });
  });

  app.post("/settings/sync/blocked-companies", async (req, res) => {
    try {
      const item = await blockCompanyByName(req.body?.company_name);
      const items = await listBlockedCompanies();
      res.json({
        ok: true,
        item: {
          normalized_company_name: String(item?.normalized_company_name || ""),
          company_name: String(item?.company_name || ""),
          blocked_at_epoch: Number(item?.blocked_at_epoch || 0)
        },
        items,
        count: items.length
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.post("/settings/sync/blocked-companies/unblock", async (req, res) => {
    try {
      const deleted = await unblockCompanyByName(req.body?.company_name);
      const items = await listBlockedCompanies();
      res.json({
        ok: true,
        deleted,
        items,
        count: items.length
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.post("/settings/migrate-db", async (req, res) => {
    try {
      const summary = await migrateSettingsAndApplicationsFromDatabase(req.body?.source_db_path, {
        personal_information: req.body?.personal_information,
        mcp_settings: req.body?.mcp_settings,
        blocked_companies: req.body?.blocked_companies,
        applications: req.body?.applications
      });
      const [personalInformation, mcpSettings, syncServiceSettings, blockedCompanies, applications] =
        await Promise.all([
          getPersonalInformation(),
          getMcpSettings(),
          getSyncServiceSettings(),
          listBlockedCompanies(),
          listApplications({ limit: 50, offset: 0 })
        ]);

      res.json({
        ok: true,
        summary,
        item: {
          personal_information: personalInformation,
          mcp_settings: mcpSettings,
          sync_settings: syncServiceSettings,
          blocked_companies_count: blockedCompanies.length,
          applications_count: Number(applications?.count || 0)
        }
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.get("/mcp/candidates", async (req, res) => {
    const settings = await getMcpSettings();
    try {
      ensureMcpAgentEnabled(settings);
    } catch (error) {
      return res.status(Number(error?.statusCode || 403)).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
    const personalInformation = await getPersonalInformation();

    const useSettings = normalizeBoolean(req.query.use_settings, true);
    const overrideSearch = String(req.query.search || "").trim();
    const overrideAts = parseCsvParam(req.query.ats);
    const overrideIndustries = parseCsvParam(req.query.industries);
    const overrideStates = parseCsvParam(req.query.states);
    const overrideCounties = parseCsvParam(req.query.counties);
    const overrideCountries = parseCsvParam(req.query.countries);
    const overrideRegions = parseCsvParam(req.query.regions);
    const overrideRemote = normalizeRemoteFilter(req.query.remote);
    const includeApplied = normalizeBoolean(req.query.include_applied, false);

    const preferredMax = Math.max(
      1,
      parseNonNegativeInteger(settings?.max_applications_per_run) || MCP_SETTINGS_DEFAULTS.max_applications_per_run
    );
    const requestedLimit = parseNonNegativeInteger(req.query.limit);
    const limit = Math.max(1, Math.min(2000, requestedLimit || preferredMax));

    const search = overrideSearch || (useSettings ? String(settings?.preferred_search || "").trim() : "");
    const ats = overrideAts.length > 0 ? overrideAts : [];
    const industries =
      overrideIndustries.length > 0
        ? overrideIndustries
        : useSettings
          ? normalizeStringArray(settings?.preferred_industries)
          : [];
    const states =
      overrideStates.length > 0
        ? overrideStates
        : useSettings
          ? normalizeStringArray(settings?.preferred_states)
          : [];
    const counties =
      overrideCounties.length > 0
        ? overrideCounties
        : useSettings
          ? normalizeStringArray(settings?.preferred_counties)
          : [];
    const countries =
      overrideCountries.length > 0
        ? overrideCountries
        : useSettings
          ? normalizeStringArray(settings?.preferred_countries)
          : [];
    const regions =
      overrideRegions.length > 0
        ? overrideRegions
        : useSettings
          ? normalizeStringArray(settings?.preferred_regions)
          : [];
    const remote = req.query.remote ? overrideRemote : useSettings ? settings?.preferred_remote : "all";

    const result = await listPostingsWithFilters({
      search,
      limit,
      offset: 0,
      ats,
      industries,
      states,
      counties,
      countries,
      regions,
      remote,
      include_applied: includeApplied
    });

    const candidates = (result?.items || []).slice(0, limit);
    const runbook = buildMcpRunbook(settings, personalInformation, candidates);

    res.json({
      ok: true,
      count: candidates.length,
      limit,
      filters: result.filters,
      settings,
      personal_information: personalInformation,
      runbook,
      candidates
    });
  });

  app.post("/mcp/cover-letter-draft", async (req, res) => {
    const settings = await getMcpSettings();
    try {
      ensureMcpAgentEnabled(settings);
    } catch (error) {
      return res.status(Number(error?.statusCode || 403)).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
    const personalInformation = await getPersonalInformation();
    const jobPostingUrl = String(req.body?.job_posting_url || "").trim();
    const requestCompanyName = String(req.body?.company_name || "").trim();
    const requestPositionName = String(req.body?.position_name || "").trim();

    let posting = {
      job_posting_url: jobPostingUrl,
      company_name: requestCompanyName,
      position_name: requestPositionName
    };

    if (jobPostingUrl && (!requestCompanyName || !requestPositionName)) {
      const row = await db.get(
        `
          SELECT company_name, position_name, job_posting_url
          FROM Postings
          WHERE job_posting_url = ?
          LIMIT 1;
        `,
        [jobPostingUrl]
      );
      posting = {
        job_posting_url: jobPostingUrl,
        company_name: requestCompanyName || String(row?.company_name || "").trim(),
        position_name: requestPositionName || String(row?.position_name || "").trim()
      };
    }

    const instructions = String(req.body?.instructions || settings?.instructions_for_agent || "").trim();
    const draft = buildCoverLetterDraft(personalInformation, posting, instructions);

    res.json({
      ok: true,
      posting,
      draft
    });
  });

  app.post("/mcp/applications/complete", async (req, res) => {
    try {
      const settings = await getMcpSettings();
      ensureMcpAgentEnabled(settings);
      const commit = normalizeBoolean(req.body?.commit, false);
      const approvedByUser = normalizeBoolean(req.body?.approved_by_user, false);
      const jobPostingUrl = String(req.body?.job_posting_url || "").trim();
      const agentName =
        String(req.body?.agent_name || settings?.preferred_agent_name || MCP_SETTINGS_DEFAULTS.preferred_agent_name)
          .trim() || MCP_SETTINGS_DEFAULTS.preferred_agent_name;

      let companyName = String(req.body?.company_name || "").trim();
      let positionName = String(req.body?.position_name || "").trim();

      if (jobPostingUrl && (!companyName || !positionName)) {
        const posting = await db.get(
          `
            SELECT company_name, position_name
            FROM Postings
            WHERE job_posting_url = ?
            LIMIT 1;
          `,
          [jobPostingUrl]
        );
        companyName = companyName || String(posting?.company_name || "").trim();
        positionName = positionName || String(posting?.position_name || "").trim();
      }

      if (!companyName || !positionName) {
        return res.status(400).json({
          ok: false,
          error: "company_name and position_name are required (or provide a valid job_posting_url)."
        });
      }

      if (commit && settings?.require_final_approval && !approvedByUser) {
        return res.status(400).json({
          ok: false,
          error: "Final approval is required by MCP settings. Set approved_by_user=true to commit."
        });
      }

      const payload = {
        company_name: companyName,
        position_name: positionName,
        job_posting_url: jobPostingUrl,
        application_date: parseNonNegativeInteger(req.body?.application_date) || nowEpochSeconds(),
        status: req.body?.status || "applied",
        applied_by_type: "agent",
        applied_by_label: `${agentName} applied on behalf of user`
      };

      const shouldDryRun = !commit || Boolean(settings?.dry_run_only);
      if (shouldDryRun) {
        return res.json({
          ok: true,
          committed: false,
          dry_run: true,
          payload
        });
      }

      const item = await createApplication(payload);
      return res.status(201).json({
        ok: true,
        committed: true,
        item
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 400)).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.get("/applications", async (req, res) => {
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const status = String(req.query.status || "").trim();

    const payload = await listApplications({
      limit,
      offset,
      status
    });

    res.json({
      ...payload,
      status_options: Array.from(APPLICATION_STATUS_OPTIONS)
    });
  });

  app.post("/applications", async (req, res) => {
    try {
      const item = await createApplication(req.body || {});
      res.status(201).json({
        ok: true,
        item
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.patch("/applications/:id", async (req, res) => {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId) || applicationId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "application id must be a positive number"
      });
    }

    const item = await updateApplicationStatus(applicationId, req.body?.status);
    if (!item) {
      return res.status(404).json({
        ok: false,
        error: "application not found"
      });
    }

    return res.json({
      ok: true,
      item
    });
  });

  app.delete("/applications/:id", async (req, res) => {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId) || applicationId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "application id must be a positive number"
      });
    }

    const deleted = await deleteApplicationById(applicationId);
    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: "application not found"
      });
    }

    return res.json({
      ok: true,
      deleted: true
    });
  });

  app.post("/postings/ignore", async (req, res) => {
    try {
      const item = await setPostingIgnoredState(req.body || {});
      res.json({
        ok: true,
        item
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

}

module.exports = {
  registerUserRoutes
};
