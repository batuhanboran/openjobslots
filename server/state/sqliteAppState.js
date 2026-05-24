const fs = require("fs");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

function missingDependency(name) {
  return () => {
    throw new Error(`createSqliteAppStateRuntime requires dependency: ${name}`);
  };
}

function optionalFunction(dependencies, name) {
  return typeof dependencies[name] === "function" ? dependencies[name] : missingDependency(name);
}

function createDbProxy(getDb) {
  return new Proxy({}, {
    get(_target, property) {
      const handle = getDb();
      if (!handle) {
        throw new Error("SQLite database handle is not initialized");
      }
      const value = handle[property];
      return typeof value === "function" ? value.bind(handle) : value;
    }
  });
}

function createSqliteAppStateRuntime(dependencies = {}) {
  const getDb = typeof dependencies.getDb === "function" ? dependencies.getDb : () => null;
  const db = createDbProxy(getDb);
  const DB_PATH = String(dependencies.dbPath || "").trim();
  const PERSONAL_INFORMATION_FIELDS = Array.isArray(dependencies.personalInformationFields)
    ? dependencies.personalInformationFields
    : [];
  const MCP_SETTINGS_DEFAULTS = dependencies.mcpSettingsDefaults && typeof dependencies.mcpSettingsDefaults === "object"
    ? dependencies.mcpSettingsDefaults
    : {};
  const SYNC_SERVICE_SETTINGS_DEFAULTS =
    dependencies.syncServiceSettingsDefaults && typeof dependencies.syncServiceSettingsDefaults === "object"
      ? dependencies.syncServiceSettingsDefaults
      : { ats_request_queue_concurrency: 1, sync_enabled_ats: [] };
  const MIN_ATS_REQUEST_QUEUE_CONCURRENCY = Number(dependencies.minAtsRequestQueueConcurrency || 1);
  const MAX_ATS_REQUEST_QUEUE_CONCURRENCY = Number(dependencies.maxAtsRequestQueueConcurrency || 20);
  const getAtsRequestQueueConcurrency = typeof dependencies.getAtsRequestQueueConcurrency === "function"
    ? dependencies.getAtsRequestQueueConcurrency
    : () => SYNC_SERVICE_SETTINGS_DEFAULTS.ats_request_queue_concurrency;
  const setAtsRequestQueueConcurrency = typeof dependencies.setAtsRequestQueueConcurrency === "function"
    ? dependencies.setAtsRequestQueueConcurrency
    : () => {};
  const setSyncEnabledAts = typeof dependencies.setSyncEnabledAts === "function"
    ? dependencies.setSyncEnabledAts
    : () => {};

  const buildIndustryMatchersByKey = optionalFunction(dependencies, "buildIndustryMatchersByKey");
  const buildPublicSourceFacets = optionalFunction(dependencies, "buildPublicSourceFacets");
  const createDefaultPersonalInformation = optionalFunction(dependencies, "createDefaultPersonalInformation");
  const getPostingsOrderByClause = optionalFunction(dependencies, "getPostingsOrderByClause");
  const inferAtsFromJobPostingUrl = optionalFunction(dependencies, "inferAtsFromJobPostingUrl");
  const inferPostingLocationFromJobUrl = optionalFunction(dependencies, "inferPostingLocationFromJobUrl");
  const normalizeApplicationStatus = optionalFunction(dependencies, "normalizeApplicationStatus");
  const normalizeAppliedByLabel = optionalFunction(dependencies, "normalizeAppliedByLabel");
  const normalizeAppliedByType = optionalFunction(dependencies, "normalizeAppliedByType");
  const normalizeAtsFilters = optionalFunction(dependencies, "normalizeAtsFilters");
  const normalizeAtsRequestQueueConcurrency = optionalFunction(dependencies, "normalizeAtsRequestQueueConcurrency");
  const normalizeBoolean = optionalFunction(dependencies, "normalizeBoolean");
  const normalizeFreshnessDays = optionalFunction(dependencies, "normalizeFreshnessDays");
  const normalizeIgnoredByLabel = optionalFunction(dependencies, "normalizeIgnoredByLabel");
  const normalizeLikeText = optionalFunction(dependencies, "normalizeLikeText");
  const normalizeMcpSettingsInput = optionalFunction(dependencies, "normalizeMcpSettingsInput");
  const normalizePersonalInformationInput = optionalFunction(dependencies, "normalizePersonalInformationInput");
  const normalizePostingSort = optionalFunction(dependencies, "normalizePostingSort");
  const normalizeRemoteFilter = optionalFunction(dependencies, "normalizeRemoteFilter");
  const normalizeStringArray = optionalFunction(dependencies, "normalizeStringArray");
  const normalizeSyncEnabledAts = optionalFunction(dependencies, "normalizeSyncEnabledAts");
  const normalizeSyncServiceSettingsInput = optionalFunction(dependencies, "normalizeSyncServiceSettingsInput");
  const nowEpochSeconds = optionalFunction(dependencies, "nowEpochSeconds");
  const parseCountryFilters = optionalFunction(dependencies, "parseCountryFilters");
  const parseCountyFilters = optionalFunction(dependencies, "parseCountyFilters");
  const parseJsonArray = optionalFunction(dependencies, "parseJsonArray");
  const parseNonNegativeInteger = optionalFunction(dependencies, "parseNonNegativeInteger");
  const parseRegionFilters = optionalFunction(dependencies, "parseRegionFilters");
  const rowMatchesIndustryLikeParts = optionalFunction(dependencies, "rowMatchesIndustryLikeParts");
  const rowMatchesLocationFilters = optionalFunction(dependencies, "rowMatchesLocationFilters");
  const rowMatchesRemoteFilter = optionalFunction(dependencies, "rowMatchesRemoteFilter");
  const searchTokenMatchesPosting = optionalFunction(dependencies, "searchTokenMatchesPosting");
  const sortSqlitePostingItems = optionalFunction(dependencies, "sortSqlitePostingItems");
  const tokenizeSearchText = optionalFunction(dependencies, "tokenizeSearchText");

  async function ensurePersonalInformationTable() {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS PersonalInformation (
        first_name TEXT NOT NULL,
        middle_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        address TEXT NOT NULL,
        linkedin_url TEXT NOT NULL,
        github_url TEXT NOT NULL,
        portfolio_url TEXT NOT NULL,
        resume_file_path TEXT NOT NULL,
        projects_portfolio_file_path TEXT NOT NULL,
        certifications_folder_path TEXT NOT NULL,
        ethnicity TEXT NOT NULL,
        gender TEXT NOT NULL,
        age INTEGER NOT NULL,
        veteran_status TEXT NOT NULL,
        disability_status TEXT NOT NULL,
        education_level TEXT NOT NULL,
        years_of_experience INTEGER NOT NULL
      );
    `);
  
    const tableInfo = await db.all(`PRAGMA table_info('PersonalInformation');`);
    const existingColumns = new Set(tableInfo.map((column) => String(column?.name || "")));
  
    if (!existingColumns.has("years_of_experience")) {
      await db.exec(`
        ALTER TABLE PersonalInformation
        ADD COLUMN years_of_experience INTEGER NOT NULL DEFAULT 0;
      `);
    }
  }
  
  async function ensureApplicationsTable() {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        position_name TEXT NOT NULL,
        application_date INTEGER NOT NULL,
        status TEXT
      );
  
      CREATE INDEX IF NOT EXISTS idx_applications_company_id
        ON applications(company_id);
  
      CREATE INDEX IF NOT EXISTS idx_applications_application_date
        ON applications(application_date);
  
      CREATE INDEX IF NOT EXISTS idx_applications_status
        ON applications(status);
  
      CREATE TABLE IF NOT EXISTS application_attribution (
        application_id INTEGER NOT NULL PRIMARY KEY,
        applied_by_type TEXT NOT NULL,
        applied_by_label TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
  
      CREATE TABLE IF NOT EXISTS posting_application_state (
        job_posting_url TEXT NOT NULL PRIMARY KEY,
        applied INTEGER NOT NULL DEFAULT 0,
        applied_by_type TEXT NOT NULL,
        applied_by_label TEXT NOT NULL,
        applied_at_epoch INTEGER,
        last_application_id INTEGER,
        ignored INTEGER NOT NULL DEFAULT 0,
        ignored_at_epoch INTEGER,
        ignored_by_label TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
  
      CREATE INDEX IF NOT EXISTS idx_posting_application_state_applied
        ON posting_application_state(applied);
  
      CREATE INDEX IF NOT EXISTS idx_posting_application_state_ignored
        ON posting_application_state(ignored);
  
      CREATE TABLE IF NOT EXISTS McpSettings (
        id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        preferred_agent_name TEXT NOT NULL DEFAULT 'openjobslots Agent',
        agent_login_email TEXT NOT NULL DEFAULT '',
        agent_login_password TEXT NOT NULL DEFAULT '',
        mfa_login_email TEXT NOT NULL DEFAULT '',
        mfa_login_notes TEXT NOT NULL DEFAULT '',
        dry_run_only INTEGER NOT NULL DEFAULT 1,
        require_final_approval INTEGER NOT NULL DEFAULT 1,
        max_applications_per_run INTEGER NOT NULL DEFAULT 10,
        preferred_search TEXT NOT NULL DEFAULT '',
        preferred_remote TEXT NOT NULL DEFAULT 'all',
        preferred_industries TEXT NOT NULL DEFAULT '[]',
        preferred_regions TEXT NOT NULL DEFAULT '[]',
        preferred_countries TEXT NOT NULL DEFAULT '[]',
        preferred_states TEXT NOT NULL DEFAULT '[]',
        preferred_counties TEXT NOT NULL DEFAULT '[]',
        instructions_for_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  
    await db.run(
      `
        INSERT INTO McpSettings (
          id,
          enabled,
          preferred_agent_name,
          agent_login_email,
          mfa_login_email,
          mfa_login_notes,
          dry_run_only,
          require_final_approval,
          max_applications_per_run,
          preferred_search,
          preferred_remote,
          preferred_industries,
          preferred_regions,
          preferred_countries,
          preferred_states,
          preferred_counties,
          instructions_for_agent
        ) VALUES (1, 0, ?, '', '', '', 1, 1, 10, '', 'all', '[]', '[]', '[]', '[]', '[]', '')
        ON CONFLICT(id) DO NOTHING;
      `,
      [MCP_SETTINGS_DEFAULTS.preferred_agent_name]
    );
  
    const postingStateColumns = await db.all(`PRAGMA table_info('posting_application_state');`);
    const postingStateColumnNames = new Set(postingStateColumns.map((column) => String(column?.name || "")));
    const mcpSettingsColumns = await db.all(`PRAGMA table_info('McpSettings');`);
    const mcpSettingsColumnNames = new Set(mcpSettingsColumns.map((column) => String(column?.name || "")));
  
    if (!postingStateColumnNames.has("ignored")) {
      await db.exec(`
        ALTER TABLE posting_application_state
        ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;
      `);
    }
    if (!postingStateColumnNames.has("ignored_at_epoch")) {
      await db.exec(`
        ALTER TABLE posting_application_state
        ADD COLUMN ignored_at_epoch INTEGER;
      `);
    }
    if (!postingStateColumnNames.has("ignored_by_label")) {
      await db.exec(`
        ALTER TABLE posting_application_state
        ADD COLUMN ignored_by_label TEXT NOT NULL DEFAULT '';
      `);
    }
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_posting_application_state_ignored
        ON posting_application_state(ignored);
    `);
  
    if (!mcpSettingsColumnNames.has("agent_login_password")) {
      await db.exec(`
        ALTER TABLE McpSettings
        ADD COLUMN agent_login_password TEXT NOT NULL DEFAULT '';
      `);
    }
    if (!mcpSettingsColumnNames.has("preferred_regions")) {
      await db.exec(`
        ALTER TABLE McpSettings
        ADD COLUMN preferred_regions TEXT NOT NULL DEFAULT '[]';
      `);
    }
    if (!mcpSettingsColumnNames.has("preferred_countries")) {
      await db.exec(`
        ALTER TABLE McpSettings
        ADD COLUMN preferred_countries TEXT NOT NULL DEFAULT '[]';
      `);
    }
  }
  
  async function ensureSyncServiceSettingsTable() {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS SyncServiceSettings (
        id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
        ats_request_queue_concurrency INTEGER NOT NULL DEFAULT 1,
        sync_enabled_ats TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  
    const syncSettingsColumns = await db.all(`PRAGMA table_info(SyncServiceSettings);`);
    const syncSettingsColumnNames = new Set(
      (Array.isArray(syncSettingsColumns) ? syncSettingsColumns : []).map((column) => String(column?.name || ""))
    );
    if (!syncSettingsColumnNames.has("sync_enabled_ats")) {
      await db.exec(`
        ALTER TABLE SyncServiceSettings
        ADD COLUMN sync_enabled_ats TEXT NOT NULL DEFAULT '[]';
      `);
    }
  
    await db.run(
      `
        INSERT INTO SyncServiceSettings (
          id,
          ats_request_queue_concurrency,
          sync_enabled_ats,
          updated_at
        ) VALUES (1, ?, ?, datetime('now'))
        ON CONFLICT(id) DO NOTHING;
      `,
      [
        SYNC_SERVICE_SETTINGS_DEFAULTS.ats_request_queue_concurrency,
        JSON.stringify(SYNC_SERVICE_SETTINGS_DEFAULTS.sync_enabled_ats)
      ]
    );
  }
  
  function normalizeCompanyNameForBlockList(value) {
    return normalizeLikeText(value);
  }
  
  async function ensureBlockedCompaniesTable() {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_companies (
        normalized_company_name TEXT NOT NULL PRIMARY KEY,
        company_name TEXT NOT NULL,
        blocked_at_epoch INTEGER NOT NULL
      );
  
      CREATE INDEX IF NOT EXISTS idx_blocked_companies_company_name
        ON blocked_companies(company_name);
    `);
  }
  
  async function listBlockedCompanies() {
    const rows = await db.all(`
      SELECT normalized_company_name, company_name, blocked_at_epoch
      FROM blocked_companies
      ORDER BY company_name ASC;
    `);
  
    return rows.map((row) => ({
      normalized_company_name: String(row?.normalized_company_name || ""),
      company_name: String(row?.company_name || ""),
      blocked_at_epoch: Number(row?.blocked_at_epoch || 0)
    }));
  }
  
  async function blockCompanyByName(rawCompanyName) {
    const companyName = String(rawCompanyName || "").trim();
    const normalizedCompanyName = normalizeCompanyNameForBlockList(companyName);
    if (!companyName || !normalizedCompanyName) {
      throw new Error("company_name is required");
    }
  
    await db.run(
      `
        INSERT INTO blocked_companies (
          normalized_company_name,
          company_name,
          blocked_at_epoch
        ) VALUES (?, ?, ?)
        ON CONFLICT(normalized_company_name) DO UPDATE SET
          company_name = excluded.company_name,
          blocked_at_epoch = excluded.blocked_at_epoch;
      `,
      [normalizedCompanyName, companyName, nowEpochSeconds()]
    );
  
    return db.get(
      `
        SELECT normalized_company_name, company_name, blocked_at_epoch
        FROM blocked_companies
        WHERE normalized_company_name = ?
        LIMIT 1;
      `,
      [normalizedCompanyName]
    );
  }
  
  async function unblockCompanyByName(rawCompanyName) {
    const normalizedCompanyName = normalizeCompanyNameForBlockList(rawCompanyName);
    if (!normalizedCompanyName) {
      throw new Error("company_name is required");
    }
  
    const result = await db.run(
      `
        DELETE FROM blocked_companies
        WHERE normalized_company_name = ?;
      `,
      [normalizedCompanyName]
    );
  
    return Number(result?.changes || 0) > 0;
  }
  
  async function getStoredSyncServiceSettings() {
    const row = await db.get(
      `
        SELECT
          ats_request_queue_concurrency,
          sync_enabled_ats
        FROM SyncServiceSettings
        WHERE id = 1
        LIMIT 1;
      `
    );
  
    return normalizeSyncServiceSettingsInput(
      {
        ...SYNC_SERVICE_SETTINGS_DEFAULTS,
        ats_request_queue_concurrency: row?.ats_request_queue_concurrency,
        sync_enabled_ats: row?.sync_enabled_ats
      },
      SYNC_SERVICE_SETTINGS_DEFAULTS
    );
  }
  
  async function loadSyncServiceSettingsIntoRuntime() {
    const stored = await getStoredSyncServiceSettings();
    setAtsRequestQueueConcurrency(normalizeAtsRequestQueueConcurrency(stored?.ats_request_queue_concurrency));
    setSyncEnabledAts(normalizeSyncEnabledAts(stored?.sync_enabled_ats));
    return stored;
  }
  
  async function getSyncServiceSettings() {
    const stored = await getStoredSyncServiceSettings();
    return {
      ...stored,
      active_ats_request_queue_concurrency: getAtsRequestQueueConcurrency(),
      min_ats_request_queue_concurrency: MIN_ATS_REQUEST_QUEUE_CONCURRENCY,
      max_ats_request_queue_concurrency: MAX_ATS_REQUEST_QUEUE_CONCURRENCY,
      applies_after_service_restart: true
    };
  }
  
  async function upsertSyncServiceSettings(input = {}) {
    const existing = await getStoredSyncServiceSettings();
    const normalized = normalizeSyncServiceSettingsInput(input, existing);
  
    await db.run(
      `
        INSERT INTO SyncServiceSettings (
          id,
          ats_request_queue_concurrency,
          sync_enabled_ats,
          updated_at
        ) VALUES (1, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          ats_request_queue_concurrency = excluded.ats_request_queue_concurrency,
          sync_enabled_ats = excluded.sync_enabled_ats,
          updated_at = datetime('now');
      `,
      [normalized.ats_request_queue_concurrency, JSON.stringify(normalized.sync_enabled_ats)]
    );
  
    setSyncEnabledAts(normalized.sync_enabled_ats);
    return getSyncServiceSettings();
  }
  
  async function getMcpSettings() {
    const row = await db.get(
      `
        SELECT
          id,
          enabled,
          preferred_agent_name,
          agent_login_email,
          agent_login_password,
          mfa_login_email,
          mfa_login_notes,
          dry_run_only,
          require_final_approval,
          max_applications_per_run,
          preferred_search,
          preferred_remote,
          preferred_industries,
          preferred_states,
          preferred_counties,
          instructions_for_agent
        FROM McpSettings
        WHERE id = 1
        LIMIT 1;
      `
    );
  
    const settings = normalizeMcpSettingsInput({
      ...MCP_SETTINGS_DEFAULTS,
      enabled: Boolean(Number(row?.enabled || 0)),
      preferred_agent_name: row?.preferred_agent_name,
      agent_login_email: row?.agent_login_email,
      agent_login_password: row?.agent_login_password,
      mfa_login_email: row?.mfa_login_email,
      mfa_login_notes: row?.mfa_login_notes,
      dry_run_only: Boolean(Number(row?.dry_run_only ?? 1)),
      require_final_approval: Boolean(Number(row?.require_final_approval ?? 1)),
      max_applications_per_run: row?.max_applications_per_run,
      preferred_search: row?.preferred_search,
      preferred_remote: row?.preferred_remote,
      preferred_industries: parseJsonArray(row?.preferred_industries),
      preferred_regions: parseJsonArray(row?.preferred_regions),
      preferred_countries: parseJsonArray(row?.preferred_countries),
      preferred_states: parseJsonArray(row?.preferred_states),
      preferred_counties: parseJsonArray(row?.preferred_counties),
      instructions_for_agent: row?.instructions_for_agent
    });
  
    return settings;
  }
  
  async function upsertMcpSettings(input) {
    const normalized = normalizeMcpSettingsInput(input);
    await db.run(
      `
        INSERT INTO McpSettings (
          id,
          enabled,
          preferred_agent_name,
          agent_login_email,
          agent_login_password,
          mfa_login_email,
          mfa_login_notes,
          dry_run_only,
          require_final_approval,
          max_applications_per_run,
          preferred_search,
          preferred_remote,
          preferred_industries,
          preferred_regions,
          preferred_countries,
          preferred_states,
          preferred_counties,
          instructions_for_agent,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          preferred_agent_name = excluded.preferred_agent_name,
          agent_login_email = excluded.agent_login_email,
          agent_login_password = excluded.agent_login_password,
          mfa_login_email = excluded.mfa_login_email,
          mfa_login_notes = excluded.mfa_login_notes,
          dry_run_only = excluded.dry_run_only,
          require_final_approval = excluded.require_final_approval,
          max_applications_per_run = excluded.max_applications_per_run,
          preferred_search = excluded.preferred_search,
          preferred_remote = excluded.preferred_remote,
          preferred_industries = excluded.preferred_industries,
          preferred_regions = excluded.preferred_regions,
          preferred_countries = excluded.preferred_countries,
          preferred_states = excluded.preferred_states,
          preferred_counties = excluded.preferred_counties,
          instructions_for_agent = excluded.instructions_for_agent,
          updated_at = datetime('now');
      `,
      [
        1,
        normalized.enabled ? 1 : 0,
        normalized.preferred_agent_name,
        normalized.agent_login_email,
        normalized.agent_login_password,
        normalized.mfa_login_email,
        normalized.mfa_login_notes,
        normalized.dry_run_only ? 1 : 0,
        normalized.require_final_approval ? 1 : 0,
        normalized.max_applications_per_run,
        normalized.preferred_search,
        normalized.preferred_remote,
        JSON.stringify(normalized.preferred_industries || []),
        JSON.stringify(normalized.preferred_regions || []),
        JSON.stringify(normalized.preferred_countries || []),
        JSON.stringify(normalized.preferred_states || []),
        JSON.stringify(normalized.preferred_counties || []),
        normalized.instructions_for_agent
      ]
    );
  
    return getMcpSettings();
  }
  
  async function markPostingAppliedState(payload) {
    const jobPostingUrl = String(payload?.job_posting_url || "").trim();
    if (!jobPostingUrl) return;
  
    const applied = normalizeBoolean(payload?.applied, true);
    const appliedByType = normalizeAppliedByType(payload?.applied_by_type);
    const appliedByLabel = normalizeAppliedByLabel(payload?.applied_by_label, appliedByType);
    const appliedAtEpoch = parseNonNegativeInteger(payload?.applied_at_epoch) || nowEpochSeconds();
    const lastApplicationId = parseNonNegativeInteger(payload?.last_application_id) || null;
  
    await db.run(
      `
        INSERT INTO posting_application_state (
          job_posting_url,
          applied,
          applied_by_type,
          applied_by_label,
          applied_at_epoch,
          last_application_id,
          ignored,
          ignored_at_epoch,
          ignored_by_label,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, '', datetime('now'))
        ON CONFLICT(job_posting_url) DO UPDATE SET
          applied = excluded.applied,
          applied_by_type = excluded.applied_by_type,
          applied_by_label = excluded.applied_by_label,
          applied_at_epoch = excluded.applied_at_epoch,
          last_application_id = excluded.last_application_id,
          ignored = 0,
          ignored_at_epoch = NULL,
          ignored_by_label = '',
          updated_at = datetime('now');
      `,
      [jobPostingUrl, applied ? 1 : 0, appliedByType, appliedByLabel, appliedAtEpoch, lastApplicationId]
    );
  }
  
  async function setPostingIgnoredState(payload) {
    const jobPostingUrl = String(payload?.job_posting_url || "").trim();
    if (!jobPostingUrl) {
      throw new Error("job_posting_url is required");
    }
  
    const ignored = normalizeBoolean(payload?.ignored, true);
    const ignoredAtEpoch = parseNonNegativeInteger(payload?.ignored_at_epoch) || nowEpochSeconds();
    const ignoredByLabel = normalizeIgnoredByLabel(payload?.ignored_by_label);
  
    await db.run(
      `
        INSERT INTO posting_application_state (
          job_posting_url,
          applied,
          applied_by_type,
          applied_by_label,
          applied_at_epoch,
          last_application_id,
          ignored,
          ignored_at_epoch,
          ignored_by_label,
          updated_at
        ) VALUES (?, 0, 'manual', '', NULL, NULL, ?, ?, ?, datetime('now'))
        ON CONFLICT(job_posting_url) DO UPDATE SET
          ignored = excluded.ignored,
          ignored_at_epoch = CASE
            WHEN excluded.ignored = 1 THEN excluded.ignored_at_epoch
            ELSE NULL
          END,
          ignored_by_label = CASE
            WHEN excluded.ignored = 1 THEN excluded.ignored_by_label
            ELSE ''
          END,
          updated_at = datetime('now');
      `,
      [jobPostingUrl, ignored ? 1 : 0, ignoredAtEpoch, ignoredByLabel]
    );
  
    const row = await db.get(
      `
        SELECT
          job_posting_url,
          applied,
          ignored,
          ignored_at_epoch,
          ignored_by_label
        FROM posting_application_state
        WHERE job_posting_url = ?
        LIMIT 1;
      `,
      [jobPostingUrl]
    );
  
    return {
      job_posting_url: jobPostingUrl,
      applied: Boolean(Number(row?.applied || 0)),
      ignored: Boolean(Number(row?.ignored || 0)),
      ignored_at_epoch: Number(row?.ignored_at_epoch || 0),
      ignored_by_label: String(row?.ignored_by_label || "")
    };
  }
  
  async function enrichPostingsWithApplicationState(items) {
    const rows = Array.isArray(items) ? items : [];
    const urls = rows
      .map((row) => String(row?.job_posting_url || "").trim())
      .filter(Boolean);
    if (urls.length === 0) return rows;
  
    const uniqueUrls = Array.from(new Set(urls));
    const placeholders = uniqueUrls.map(() => "?").join(", ");
    const stateRows = await db.all(
      `
        SELECT
          job_posting_url,
          applied,
          applied_by_type,
          applied_by_label,
          applied_at_epoch,
          last_application_id,
          ignored,
          ignored_at_epoch,
          ignored_by_label
        FROM posting_application_state
        WHERE job_posting_url IN (${placeholders});
      `,
      uniqueUrls
    );
  
    const byUrl = new Map();
    for (const row of stateRows) {
      byUrl.set(String(row?.job_posting_url || "").trim(), row);
    }
  
    return rows.map((item) => {
      const key = String(item?.job_posting_url || "").trim();
      const state = byUrl.get(key);
      const applied = Boolean(Number(state?.applied || 0));
      const ignored = Boolean(Number(state?.ignored || 0));
      const appliedByType = applied ? normalizeAppliedByType(state?.applied_by_type) : "";
      return {
        ...item,
        applied,
        ignored,
        applied_by_type: appliedByType,
        applied_by_label: applied ? normalizeAppliedByLabel(state?.applied_by_label, appliedByType) : "",
        applied_at_epoch: Number(state?.applied_at_epoch || 0),
        last_application_id: Number(state?.last_application_id || 0),
        ignored_at_epoch: Number(state?.ignored_at_epoch || 0),
        ignored_by_label: ignored ? normalizeIgnoredByLabel(state?.ignored_by_label) : ""
      };
    });
  }
  
  async function listPostingsWithFilters(options = {}) {
    const search = String(options?.search || "").trim();
    const limit = Math.max(1, Math.min(2000, Number(options?.limit || 500)));
    const offset = Math.max(0, Number(options?.offset || 0));
    const sortBy = normalizePostingSort(options?.sort_by);
    const orderByClause = getPostingsOrderByClause(sortBy);
    const atsFilters = normalizeAtsFilters(options?.ats || []);
    const industryKeys = normalizeStringArray(options?.industries).map((key) => normalizeLikeText(key));
    const stateCodes = normalizeStringArray(options?.states).map((state) => state.toUpperCase());
    const countyFilters = parseCountyFilters(normalizeStringArray(options?.counties));
    const countryFilters = parseCountryFilters(normalizeStringArray(options?.countries));
    const regionFilters = parseRegionFilters(normalizeStringArray(options?.regions));
    const remoteFilter = normalizeRemoteFilter(options?.remote);
    const hideNoDate = normalizeBoolean(options?.hide_no_date, false);
    const freshnessDays = normalizeFreshnessDays(options?.freshness_days);
    const freshnessCutoffEpoch = freshnessDays ? nowEpochSeconds() - freshnessDays * 24 * 60 * 60 : 0;
    const includeApplied = normalizeBoolean(options?.include_applied, true);
    const includeIgnored = normalizeBoolean(options?.include_ignored, false);
    const requiresInMemorySort = sortBy === "relevance" || sortBy === "posted_date" || sortBy === "ats_source";
    const hasStructuredFilters =
      atsFilters.length > 0 ||
      industryKeys.length > 0 ||
      stateCodes.length > 0 ||
      countyFilters.length > 0 ||
      countryFilters.length > 0 ||
      regionFilters.length > 0 ||
      remoteFilter !== "all" ||
      Boolean(freshnessDays) ||
      requiresInMemorySort;
  
    let rows = [];
    let totalCount = 0;
    let sourceFacets = [];
    if (!search && !hasStructuredFilters) {
      if (includeApplied && includeIgnored) {
        const [countRow, pageRows] = await Promise.all([
          db.get(
            `
              SELECT COUNT(*) AS count
              FROM Postings
              WHERE COALESCE(hidden, 0) = 0
                AND (? = 0 OR (posting_date IS NOT NULL AND TRIM(posting_date) <> ''))
                AND NOT EXISTS (
                  SELECT 1
                  FROM blocked_companies b
                  WHERE b.normalized_company_name = LOWER(TRIM(Postings.company_name))
                );
            `,
            [hideNoDate ? 1 : 0]
          ),
          db.all(
            `
            SELECT id, company_name, position_name, job_posting_url, location, posting_date, first_seen_epoch, last_seen_epoch, confidence, quality_score
            FROM Postings
            WHERE COALESCE(hidden, 0) = 0
              AND (? = 0 OR (posting_date IS NOT NULL AND TRIM(posting_date) <> ''))
              AND NOT EXISTS (
                SELECT 1
                FROM blocked_companies b
                WHERE b.normalized_company_name = LOWER(TRIM(Postings.company_name))
              )
            ORDER BY ${orderByClause}
            LIMIT ? OFFSET ?;
          `,
            [hideNoDate ? 1 : 0, limit, offset]
          )
        ]);
        rows = pageRows;
        totalCount = Number(countRow?.count || 0);
      } else {
        const [countRow, pageRows] = await Promise.all([
          db.get(
            `
              SELECT COUNT(*) AS count
              FROM Postings p
              LEFT JOIN posting_application_state s
                ON s.job_posting_url = p.job_posting_url
                AND (
                  (${includeApplied ? 0 : 1} = 1 AND COALESCE(s.applied, 0) = 1)
                  OR
                  (${includeIgnored ? 0 : 1} = 1 AND COALESCE(s.ignored, 0) = 1)
                )
              WHERE COALESCE(p.hidden, 0) = 0
                AND (? = 0 OR (p.posting_date IS NOT NULL AND TRIM(p.posting_date) <> ''))
                AND NOT EXISTS (
                  SELECT 1
                  FROM blocked_companies b
                  WHERE b.normalized_company_name = LOWER(TRIM(p.company_name))
                )
                AND s.job_posting_url IS NULL;
            `,
            [hideNoDate ? 1 : 0]
          ),
          db.all(
            `
            SELECT p.id, p.company_name, p.position_name, p.job_posting_url, p.location, p.posting_date, p.first_seen_epoch, p.last_seen_epoch, p.confidence, p.quality_score
            FROM Postings p
            LEFT JOIN posting_application_state s
              ON s.job_posting_url = p.job_posting_url
              AND (
                (${includeApplied ? 0 : 1} = 1 AND COALESCE(s.applied, 0) = 1)
                OR
                (${includeIgnored ? 0 : 1} = 1 AND COALESCE(s.ignored, 0) = 1)
              )
            WHERE COALESCE(p.hidden, 0) = 0
              AND (? = 0 OR (p.posting_date IS NOT NULL AND TRIM(p.posting_date) <> ''))
              AND NOT EXISTS (
                SELECT 1
                FROM blocked_companies b
                WHERE b.normalized_company_name = LOWER(TRIM(p.company_name))
              )
              AND s.job_posting_url IS NULL
            ORDER BY ${orderByClause}
            LIMIT ? OFFSET ?;
          `,
            [hideNoDate ? 1 : 0, limit, offset]
          )
        ]);
        rows = pageRows;
        totalCount = Number(countRow?.count || 0);
      }
    } else {
      rows = await db.all(
        `
          SELECT id, company_name, position_name, job_posting_url, location, posting_date, first_seen_epoch, last_seen_epoch, confidence, quality_score
          FROM Postings
          WHERE COALESCE(hidden, 0) = 0
            AND NOT EXISTS (
            SELECT 1
            FROM blocked_companies b
            WHERE b.normalized_company_name = LOWER(TRIM(Postings.company_name))
          )
          ORDER BY ${orderByClause};
        `
      );
    }
  
    const enrichedRows = rows.map((row) => ({
      ...row,
      location: String(row?.location || "").trim() || inferPostingLocationFromJobUrl(row?.job_posting_url),
      ats: inferAtsFromJobPostingUrl(row?.job_posting_url)
    }));
  
    const searchTermGroups = tokenizeSearchText(search);
    const industryMatchersByKey = await buildIndustryMatchersByKey(industryKeys);
  
    let items = enrichedRows;
    if (search || hasStructuredFilters) {
      items = enrichedRows.filter((row) => {
        const ats = String(row?.ats || "").toLowerCase();
  
        const matchesSearch = searchTermGroups.every((aliases) =>
          aliases.some((term) => searchTokenMatchesPosting(term, row))
        );
        if (!matchesSearch) return false;
  
        if (atsFilters.length > 0 && !atsFilters.includes(ats)) return false;
  
        const matchesIndustry = rowMatchesIndustryLikeParts(
          row?.position_name,
          industryKeys,
          industryMatchersByKey
        );
        if (!matchesIndustry) return false;
  
        const matchesLocation = rowMatchesLocationFilters(
          row?.location,
          stateCodes,
          countyFilters,
          countryFilters,
          regionFilters
        );
        if (!matchesLocation) return false;
  
        const matchesRemote = rowMatchesRemoteFilter(row?.location, remoteFilter);
        if (!matchesRemote) return false;
  
        if (hideNoDate && !String(row?.posting_date || "").trim()) return false;
        if (freshnessCutoffEpoch && Number(row?.last_seen_epoch || 0) < freshnessCutoffEpoch) return false;
  
        return true;
      });
      items = sortSqlitePostingItems(items, sortBy, search);
      totalCount = items.length;
      sourceFacets = buildPublicSourceFacets(items);
      items = items.slice(offset, offset + limit);
    } else {
      sourceFacets = buildPublicSourceFacets(enrichedRows);
    }
  
    items = await enrichPostingsWithApplicationState(items);
  
    if (!includeApplied) {
      items = items.filter((item) => !item.applied);
    }
    if (!includeIgnored) {
      items = items.filter((item) => !item.ignored);
    }
  
    return {
      items,
      count: totalCount || items.length,
      count_exact: true,
      source_facets: sourceFacets,
      limit,
      offset,
      filters: {
        search,
        ats: atsFilters,
        sort_by: sortBy,
        freshness_days: freshnessDays,
        industries: industryKeys,
        states: stateCodes,
        counties: countyFilters.map((filter) =>
          filter?.stateCode ? `${filter.stateCode}|${filter.countyLikePart}` : filter.countyLikePart
        ),
        countries: countryFilters.map((filter) => filter.value),
        regions: regionFilters,
        remote: remoteFilter,
        hide_no_date: hideNoDate,
        include_ignored: includeIgnored
      }
    };
  }
  
  function buildMcpRunbook(settings, personalInformation, candidates) {
    const preferredAgent = String(settings?.preferred_agent_name || "openjobslots Agent").trim();
    const applicantFullName = [
      String(personalInformation?.first_name || "").trim(),
      String(personalInformation?.middle_name || "").trim(),
      String(personalInformation?.last_name || "").trim()
    ]
      .filter(Boolean)
      .join(" ");
  
    return {
      preferred_agent_name: preferredAgent,
      summary:
        "Use your existing browser/web automation tools to open each job URL, complete the application form, and submit only when allowed by settings and credentials.",
      steps: [
        "Read applicantee information and MCP settings from this payload.",
        "For each candidate posting, open job_posting_url and validate role relevance before applying.",
        "Fill application fields using applicantee information. Keep applicant email separate from agent login email.",
        "If an account or MFA is required, use agent_login_email + agent_login_password for account creation and sign-in flows.",
        "Use the same agent_login_email for MFA/approval flows when required.",
        "Draft a job-specific cover letter aligned to the posting requirements and applicant background.",
        "If dry_run_only is true, stop before final submit and return a dry-run result.",
        "When application is submitted, call record_application_result with commit=true to write outcomes."
      ],
      guardrails: {
        dry_run_only: Boolean(settings?.dry_run_only),
        require_final_approval: Boolean(settings?.require_final_approval)
      },
      applicant_display_name: applicantFullName || "Applicant",
      applicant_email: String(personalInformation?.email || "").trim(),
      agent_login_email: String(settings?.agent_login_email || "").trim(),
      agent_login_password: String(settings?.agent_login_password || ""),
      mfa_login_email: String(settings?.agent_login_email || "").trim(),
      mfa_login_notes: String(settings?.mfa_login_notes || "").trim(),
      custom_instructions: String(settings?.instructions_for_agent || "").trim(),
      candidate_count: Array.isArray(candidates) ? candidates.length : 0
    };
  }
  
  function buildCoverLetterDraft(personalInformation, posting, instructions = "") {
    const firstName = String(personalInformation?.first_name || "").trim() || "Applicant";
    const lastName = String(personalInformation?.last_name || "").trim();
    const fullName = `${firstName}${lastName ? ` ${lastName}` : ""}`.trim();
    const yearsOfExperience = parseNonNegativeInteger(personalInformation?.years_of_experience);
    const positionName = String(posting?.position_name || "the role").trim();
    const companyName = String(posting?.company_name || "your company").trim();
    const linkedinUrl = String(personalInformation?.linkedin_url || "").trim();
    const githubUrl = String(personalInformation?.github_url || "").trim();
    const portfolioUrl = String(personalInformation?.portfolio_url || "").trim();
    const educationLevel = String(personalInformation?.education_level || "").trim();
    const extraInstructions = String(instructions || "").trim();
  
    const profileDetails = [];
    if (yearsOfExperience > 0) profileDetails.push(`${yearsOfExperience}+ years of relevant experience`);
    if (educationLevel) profileDetails.push(`education in ${educationLevel}`);
    if (linkedinUrl) profileDetails.push(`LinkedIn: ${linkedinUrl}`);
    if (githubUrl) profileDetails.push(`GitHub: ${githubUrl}`);
    if (portfolioUrl) profileDetails.push(`Portfolio: ${portfolioUrl}`);
  
    const profileSentence =
      profileDetails.length > 0
        ? `My background includes ${profileDetails.join(", ")}.`
        : "I bring hands-on experience delivering high-quality work in fast-moving environments.";
  
    const instructionSentence = extraInstructions
      ? `I am especially aligned with these priorities: ${extraInstructions}.`
      : "";
  
    return `Dear Hiring Team,
  
  I am excited to apply for the ${positionName} role at ${companyName}. ${profileSentence}
  
  I am motivated by opportunities where I can contribute quickly, collaborate with a strong team, and improve outcomes for customers and the business. ${instructionSentence}
  
  Thank you for your consideration. I would value the chance to discuss how I can support ${companyName}.
  
  Sincerely,
  ${fullName}`.trim();
  }
  
  async function resolveCompanyIdForApplication(companyName) {
    const normalized = normalizeLikeText(companyName);
    if (!normalized) return null;
  
    return db.get(
      `
        SELECT id, company_name
        FROM companies
        WHERE LOWER(company_name) = ?
        ORDER BY id ASC
        LIMIT 1;
      `,
      [normalized]
    );
  }
  
  async function resolveCompanyIdFromPostingUrl(jobPostingUrl) {
    const normalizedUrl = String(jobPostingUrl || "").trim();
    if (!normalizedUrl) return null;
  
    const posting = await db.get(
      `
        SELECT company_name
        FROM Postings
        WHERE job_posting_url = ?
        LIMIT 1;
      `,
      [normalizedUrl]
    );
  
    const normalizedCompanyName = normalizeLikeText(posting?.company_name);
    if (!normalizedCompanyName) return null;
  
    return db.get(
      `
        SELECT id, company_name
        FROM companies
        WHERE LOWER(company_name) = ?
        ORDER BY id ASC
        LIMIT 1;
      `,
      [normalizedCompanyName]
    );
  }
  
  async function getExistingAppliedApplicationByPostingUrl(jobPostingUrl) {
    const normalizedUrl = String(jobPostingUrl || "").trim();
    if (!normalizedUrl) return null;
  
    const state = await db.get(
      `
        SELECT last_application_id
        FROM posting_application_state
        WHERE job_posting_url = ?
          AND COALESCE(applied, 0) = 1
        LIMIT 1;
      `,
      [normalizedUrl]
    );
    const lastApplicationId = parseNonNegativeInteger(state?.last_application_id);
    if (!lastApplicationId) return null;
  
    return getApplicationById(lastApplicationId);
  }
  
  function mapApplicationRow(row) {
    if (!row) return null;
    const status = normalizeApplicationStatus(row?.status);
    const appliedByType = normalizeAppliedByType(row?.applied_by_type);
    return {
      id: Number(row?.id || 0),
      company_id: Number(row?.company_id || 0),
      company_name: String(row?.company_name || "").trim(),
      position_name: String(row?.position_name || "").trim(),
      application_date: Number(row?.application_date || 0),
      status,
      applied_by_type: appliedByType,
      applied_by_label: normalizeAppliedByLabel(row?.applied_by_label, appliedByType)
    };
  }
  
  async function getApplicationById(applicationId) {
    const row = await db.get(
      `
        SELECT
          a.id,
          a.company_id,
          c.company_name,
          a.position_name,
          a.application_date,
          a.status,
          attr.applied_by_type,
          attr.applied_by_label
        FROM applications a
        LEFT JOIN companies c
          ON c.id = a.company_id
        LEFT JOIN application_attribution attr
          ON attr.application_id = a.id
        WHERE a.id = ?;
      `,
      [applicationId]
    );
  
    return mapApplicationRow(row);
  }
  
  async function listApplications(options = {}) {
    const limit = Math.max(1, Math.min(2000, Number(options?.limit || 500)));
    const offset = Math.max(0, Number(options?.offset || 0));
    const status = normalizeLikeText(options?.status);
  
    let rows = [];
    if (status && status !== "all") {
      rows = await db.all(
        `
          SELECT
            a.id,
            a.company_id,
            c.company_name,
            a.position_name,
            a.application_date,
            a.status,
            attr.applied_by_type,
            attr.applied_by_label
          FROM applications a
          LEFT JOIN companies c
            ON c.id = a.company_id
          LEFT JOIN application_attribution attr
            ON attr.application_id = a.id
          WHERE LOWER(COALESCE(a.status, '')) = ?
          ORDER BY a.application_date DESC, a.id DESC
          LIMIT ? OFFSET ?;
        `,
        [status, limit, offset]
      );
    } else {
      rows = await db.all(
        `
          SELECT
            a.id,
            a.company_id,
            c.company_name,
            a.position_name,
            a.application_date,
            a.status,
            attr.applied_by_type,
            attr.applied_by_label
          FROM applications a
          LEFT JOIN companies c
            ON c.id = a.company_id
          LEFT JOIN application_attribution attr
            ON attr.application_id = a.id
          ORDER BY a.application_date DESC, a.id DESC
          LIMIT ? OFFSET ?;
        `,
        [limit, offset]
      );
    }
  
    const items = rows.map(mapApplicationRow).filter(Boolean);
    return {
      items,
      count: items.length,
      limit,
      offset
    };
  }
  
  async function createApplication(input) {
    const companyName = String(input?.company_name || "").trim();
    const positionName = String(input?.position_name || "").trim();
    const jobPostingUrl = String(input?.job_posting_url || "").trim();
    if (!companyName && !jobPostingUrl) {
      throw new Error("company_name or job_posting_url is required");
    }
    if (!positionName) {
      throw new Error("position_name is required");
    }
  
    if (jobPostingUrl) {
      const existing = await getExistingAppliedApplicationByPostingUrl(jobPostingUrl);
      if (existing) return existing;
    }
  
    const companyFromPosting = await resolveCompanyIdFromPostingUrl(jobPostingUrl);
    const company = companyFromPosting || (companyName ? await resolveCompanyIdForApplication(companyName) : null);
    if (!company?.id) {
      throw new Error(
        jobPostingUrl
          ? `Unable to resolve company_id for job_posting_url='${jobPostingUrl}'`
          : `Unable to resolve company_id for company_name='${companyName}'`
      );
    }
  
    const status = normalizeApplicationStatus(input?.status);
    const applicationDate = parseNonNegativeInteger(input?.application_date) || nowEpochSeconds();
    const appliedByType = normalizeAppliedByType(input?.applied_by_type);
    const appliedByLabel = normalizeAppliedByLabel(input?.applied_by_label, appliedByType);
  
    await db.exec("BEGIN TRANSACTION;");
    try {
      const result = await db.run(
        `
          INSERT INTO applications (
            company_id,
            position_name,
            application_date,
            status
          ) VALUES (?, ?, ?, ?);
        `,
        [company.id, positionName, applicationDate, status]
      );
  
      await db.run(
        `
          INSERT INTO application_attribution (
            application_id,
            applied_by_type,
            applied_by_label,
            updated_at
          ) VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(application_id) DO UPDATE SET
            applied_by_type = excluded.applied_by_type,
            applied_by_label = excluded.applied_by_label,
            updated_at = datetime('now');
        `,
        [result.lastID, appliedByType, appliedByLabel]
      );
  
      if (jobPostingUrl) {
        await markPostingAppliedState({
          job_posting_url: jobPostingUrl,
          applied: true,
          applied_by_type: appliedByType,
          applied_by_label: appliedByLabel,
          applied_at_epoch: applicationDate,
          last_application_id: result.lastID
        });
      }
  
      await db.exec("COMMIT;");
      return getApplicationById(result.lastID);
    } catch (error) {
      try {
        await db.exec("ROLLBACK;");
      } catch {
        // A failed BEGIN leaves no open transaction to roll back.
      }
      throw error;
    }
  }
  
  async function updateApplicationStatus(applicationId, statusValue) {
    const status = normalizeApplicationStatus(statusValue);
    const result = await db.run(
      `
        UPDATE applications
        SET status = ?
        WHERE id = ?;
      `,
      [status, applicationId]
    );
  
    if (Number(result?.changes || 0) === 0) {
      return null;
    }
  
    return getApplicationById(applicationId);
  }
  
  async function deleteApplicationById(applicationId) {
    await db.exec("BEGIN TRANSACTION;");
    try {
      const trackedPostingRows = await db.all(
        `
          SELECT job_posting_url
          FROM posting_application_state
          WHERE last_application_id = ?;
        `,
        [applicationId]
      );
      const trackedPostingUrls = trackedPostingRows
        .map((row) => String(row?.job_posting_url || "").trim())
        .filter(Boolean);
  
      await db.run(`DELETE FROM application_attribution WHERE application_id = ?;`, [applicationId]);
      const result = await db.run(`DELETE FROM applications WHERE id = ?;`, [applicationId]);
  
      for (const jobPostingUrl of trackedPostingUrls) {
        const posting = await db.get(
          `
            SELECT company_name, position_name
            FROM Postings
            WHERE job_posting_url = ?
            LIMIT 1;
          `,
          [jobPostingUrl]
        );
  
        const companyName = normalizeLikeText(posting?.company_name);
        const positionName = normalizeLikeText(posting?.position_name);
  
        let replacement = null;
        if (companyName && positionName) {
          replacement = await db.get(
            `
              SELECT
                a.id,
                a.application_date,
                attr.applied_by_type,
                attr.applied_by_label
              FROM applications a
              INNER JOIN companies c
                ON c.id = a.company_id
              LEFT JOIN application_attribution attr
                ON attr.application_id = a.id
              WHERE LOWER(c.company_name) = ?
                AND LOWER(a.position_name) = ?
              ORDER BY a.application_date DESC, a.id DESC
              LIMIT 1;
            `,
            [companyName, positionName]
          );
        }
  
        if (replacement?.id) {
          const appliedByType = normalizeAppliedByType(replacement?.applied_by_type);
          const appliedByLabel = normalizeAppliedByLabel(replacement?.applied_by_label, appliedByType);
          await db.run(
            `
              UPDATE posting_application_state
              SET
                applied = 1,
                applied_by_type = ?,
                applied_by_label = ?,
                applied_at_epoch = ?,
                last_application_id = ?,
                updated_at = datetime('now')
              WHERE job_posting_url = ?;
            `,
            [
              appliedByType,
              appliedByLabel,
              parseNonNegativeInteger(replacement?.application_date) || nowEpochSeconds(),
              Number(replacement?.id),
              jobPostingUrl
            ]
          );
        } else {
          await db.run(
            `
              UPDATE posting_application_state
              SET
                applied = 0,
                applied_by_type = 'manual',
                applied_by_label = '',
                applied_at_epoch = NULL,
                last_application_id = NULL,
                updated_at = datetime('now')
              WHERE job_posting_url = ?;
            `,
            [jobPostingUrl]
          );
        }
      }
  
      await db.exec("COMMIT;");
      return Number(result?.changes || 0) > 0;
    } catch (error) {
      await db.exec("ROLLBACK;");
      throw error;
    }
  }
  
  async function getPersonalInformation() {
    const row = await db.get(
      `
        SELECT
          first_name,
          middle_name,
          last_name,
          email,
          phone_number,
          address,
          linkedin_url,
          github_url,
          portfolio_url,
          resume_file_path,
          projects_portfolio_file_path,
          certifications_folder_path,
          ethnicity,
          gender,
          age,
          veteran_status,
          disability_status,
          education_level,
          years_of_experience
        FROM PersonalInformation
        ORDER BY rowid ASC
        LIMIT 1;
      `
    );
  
    if (!row) {
      return createDefaultPersonalInformation();
    }
  
    return normalizePersonalInformationInput(row);
  }
  
  async function tableExists(databaseHandle, tableName) {
    const row = await databaseHandle.get(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND LOWER(name) = LOWER(?)
        LIMIT 1;
      `,
      [String(tableName || "").trim()]
    );
    return Boolean(row?.name);
  }
  
  async function resolveCompanyIdByName(companyName) {
    const normalized = normalizeLikeText(companyName);
    if (!normalized) return null;
    const row = await db.get(
      `
        SELECT id
        FROM companies
        WHERE LOWER(company_name) = ?
        ORDER BY id ASC
        LIMIT 1;
      `,
      [normalized]
    );
    return Number(row?.id || 0) || null;
  }
  
  function normalizeMigrationSelection(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    return {
      personal_information:
        source.personal_information === undefined ? true : normalizeBoolean(source.personal_information, true),
      mcp_settings: source.mcp_settings === undefined ? true : normalizeBoolean(source.mcp_settings, true),
      blocked_companies:
        source.blocked_companies === undefined ? true : normalizeBoolean(source.blocked_companies, true),
      applications: source.applications === undefined ? true : normalizeBoolean(source.applications, true)
    };
  }
  
  async function migrateSettingsAndApplicationsFromDatabase(rawSourceDbPath, selectionInput = {}) {
    const sourceDbPath = String(rawSourceDbPath || "").trim();
    if (!sourceDbPath) {
      throw new Error("source_db_path is required");
    }
    const selection = normalizeMigrationSelection(selectionInput);
    if (!selection.personal_information && !selection.mcp_settings && !selection.blocked_companies && !selection.applications) {
      throw new Error("At least one migration option must be selected");
    }
  
    const resolvedSourcePath = path.resolve(sourceDbPath);
    const resolvedTargetPath = path.resolve(DB_PATH);
    if (!fs.existsSync(resolvedSourcePath)) {
      throw new Error(`Source database not found at path: ${resolvedSourcePath}`);
    }
    if (resolvedSourcePath === resolvedTargetPath) {
      throw new Error("Source database path is the same as the active database");
    }
  
    const summary = {
      source_db_path: resolvedSourcePath,
      target_db_path: resolvedTargetPath,
      selected: selection,
      personal_information_copied: false,
      mcp_settings_copied: false,
      blocked_companies_copied: 0,
      applications_inserted: 0,
      applications_reused: 0,
      applications_skipped_missing_company: 0,
      application_attribution_upserts: 0,
      posting_application_state_upserts: 0
    };
  
    let sourceDb;
    try {
      sourceDb = await open({
        filename: resolvedSourcePath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY
      });
  
      if (selection.personal_information && (await tableExists(sourceDb, "PersonalInformation"))) {
        const sourcePersonalInformation = await sourceDb.get(
          `
            SELECT *
            FROM PersonalInformation
            ORDER BY rowid DESC
            LIMIT 1;
          `
        );
        if (sourcePersonalInformation) {
          await upsertPersonalInformation(sourcePersonalInformation);
          summary.personal_information_copied = true;
        }
      }
  
      if (selection.mcp_settings && (await tableExists(sourceDb, "McpSettings"))) {
        const sourceMcpSettings = await sourceDb.get(
          `
            SELECT *
            FROM McpSettings
            WHERE id = 1
            LIMIT 1;
          `
        );
        if (sourceMcpSettings) {
          await upsertMcpSettings(sourceMcpSettings);
          summary.mcp_settings_copied = true;
        }
      }
  
      if (selection.blocked_companies && (await tableExists(sourceDb, "blocked_companies"))) {
        const sourceBlockedCompanies = await sourceDb.all(
          `
            SELECT normalized_company_name, company_name, blocked_at_epoch
            FROM blocked_companies;
          `
        );
        for (const item of sourceBlockedCompanies) {
          const companyName = String(item?.company_name || "").trim();
          const normalizedCompanyName =
            String(item?.normalized_company_name || "").trim() || normalizeCompanyNameForBlockList(companyName);
          if (!companyName || !normalizedCompanyName) continue;
  
          await db.run(
            `
              INSERT INTO blocked_companies (
                normalized_company_name,
                company_name,
                blocked_at_epoch
              ) VALUES (?, ?, ?)
              ON CONFLICT(normalized_company_name) DO UPDATE SET
                company_name = excluded.company_name,
                blocked_at_epoch = excluded.blocked_at_epoch;
            `,
            [normalizedCompanyName, companyName, parseNonNegativeInteger(item?.blocked_at_epoch) || nowEpochSeconds()]
          );
          summary.blocked_companies_copied += 1;
        }
      }
  
      const hasApplications = selection.applications && (await tableExists(sourceDb, "applications"));
      if (hasApplications) {
        const hasSourceCompanies = await tableExists(sourceDb, "companies");
        const hasSourceAttribution = await tableExists(sourceDb, "application_attribution");
        const sourceApplications = await sourceDb.all(
          `
            SELECT
              a.id AS source_application_id,
              a.company_id AS source_company_id,
              ${
                hasSourceCompanies
                  ? "COALESCE(c.company_name, '')"
                  : "''"
              } AS source_company_name,
              a.position_name,
              a.application_date,
              a.status,
              ${
                hasSourceAttribution
                  ? "attr.applied_by_type"
                  : "NULL"
              } AS applied_by_type,
              ${
                hasSourceAttribution
                  ? "attr.applied_by_label"
                  : "NULL"
              } AS applied_by_label
            FROM applications a
            ${
              hasSourceCompanies
                ? "LEFT JOIN companies c ON c.id = a.company_id"
                : ""
            }
            ${
              hasSourceAttribution
                ? "LEFT JOIN application_attribution attr ON attr.application_id = a.id"
                : ""
            }
            ORDER BY a.application_date ASC, a.id ASC;
          `
        );
  
        const sourceToTargetApplicationId = new Map();
  
        await db.exec("BEGIN TRANSACTION;");
        try {
          for (const item of sourceApplications) {
            const sourceCompanyName = String(item?.source_company_name || "").trim();
            const targetCompanyId = await resolveCompanyIdByName(sourceCompanyName);
            if (!targetCompanyId) {
              summary.applications_skipped_missing_company += 1;
              continue;
            }
  
            const positionName = String(item?.position_name || "").trim() || "Untitled Position";
            const applicationDate = parseNonNegativeInteger(item?.application_date) || nowEpochSeconds();
            const status = normalizeApplicationStatus(item?.status);
  
            const existing = await db.get(
              `
                SELECT id
                FROM applications
                WHERE company_id = ?
                  AND LOWER(position_name) = LOWER(?)
                  AND application_date = ?
                  AND LOWER(COALESCE(status, '')) = LOWER(?)
                LIMIT 1;
              `,
              [targetCompanyId, positionName, applicationDate, status]
            );
  
            let targetApplicationId = Number(existing?.id || 0);
            if (!targetApplicationId) {
              const inserted = await db.run(
                `
                  INSERT INTO applications (
                    company_id,
                    position_name,
                    application_date,
                    status
                  ) VALUES (?, ?, ?, ?);
                `,
                [targetCompanyId, positionName, applicationDate, status]
              );
              targetApplicationId = Number(inserted?.lastID || 0);
              summary.applications_inserted += 1;
            } else {
              summary.applications_reused += 1;
            }
  
            if (targetApplicationId) {
              sourceToTargetApplicationId.set(Number(item?.source_application_id || 0), targetApplicationId);
              const appliedByType = normalizeAppliedByType(item?.applied_by_type);
              const appliedByLabel = normalizeAppliedByLabel(item?.applied_by_label, appliedByType);
              await db.run(
                `
                  INSERT INTO application_attribution (
                    application_id,
                    applied_by_type,
                    applied_by_label,
                    updated_at
                  ) VALUES (?, ?, ?, datetime('now'))
                  ON CONFLICT(application_id) DO UPDATE SET
                    applied_by_type = excluded.applied_by_type,
                    applied_by_label = excluded.applied_by_label,
                    updated_at = datetime('now');
                `,
                [targetApplicationId, appliedByType, appliedByLabel]
              );
              summary.application_attribution_upserts += 1;
            }
          }
  
          if (await tableExists(sourceDb, "posting_application_state")) {
            const sourcePostingStateRows = await sourceDb.all(
              `
                SELECT
                  job_posting_url,
                  applied,
                  applied_by_type,
                  applied_by_label,
                  applied_at_epoch,
                  last_application_id,
                  ignored,
                  ignored_at_epoch,
                  ignored_by_label
                FROM posting_application_state;
              `
            );
            for (const row of sourcePostingStateRows) {
              const jobPostingUrl = String(row?.job_posting_url || "").trim();
              if (!jobPostingUrl) continue;
  
              const appliedByType = normalizeAppliedByType(row?.applied_by_type);
              const appliedByLabel = normalizeAppliedByLabel(row?.applied_by_label, appliedByType);
              const ignoredByLabel = normalizeIgnoredByLabel(row?.ignored_by_label);
              const sourceLastApplicationId = parseNonNegativeInteger(row?.last_application_id);
              const mappedLastApplicationId = sourceToTargetApplicationId.get(sourceLastApplicationId) || null;
  
              await db.run(
                `
                  INSERT INTO posting_application_state (
                    job_posting_url,
                    applied,
                    applied_by_type,
                    applied_by_label,
                    applied_at_epoch,
                    last_application_id,
                    ignored,
                    ignored_at_epoch,
                    ignored_by_label,
                    updated_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                  ON CONFLICT(job_posting_url) DO UPDATE SET
                    applied = excluded.applied,
                    applied_by_type = excluded.applied_by_type,
                    applied_by_label = excluded.applied_by_label,
                    applied_at_epoch = excluded.applied_at_epoch,
                    last_application_id = excluded.last_application_id,
                    ignored = excluded.ignored,
                    ignored_at_epoch = excluded.ignored_at_epoch,
                    ignored_by_label = excluded.ignored_by_label,
                    updated_at = datetime('now');
                `,
                [
                  jobPostingUrl,
                  normalizeBoolean(row?.applied, false) ? 1 : 0,
                  appliedByType,
                  appliedByLabel,
                  parseNonNegativeInteger(row?.applied_at_epoch) || null,
                  mappedLastApplicationId,
                  normalizeBoolean(row?.ignored, false) ? 1 : 0,
                  parseNonNegativeInteger(row?.ignored_at_epoch) || null,
                  ignoredByLabel
                ]
              );
              summary.posting_application_state_upserts += 1;
            }
          }
  
          await db.exec("COMMIT;");
        } catch (error) {
          await db.exec("ROLLBACK;");
          throw error;
        }
      }
    } finally {
      if (sourceDb) {
        await sourceDb.close();
      }
    }
  
    return summary;
  }
  
  async function upsertPersonalInformation(value) {
    const normalized = normalizePersonalInformationInput(value);
    const values = PERSONAL_INFORMATION_FIELDS.map((field) => normalized[field]);
    const updateAssignments = PERSONAL_INFORMATION_FIELDS.map((field) => `${field} = ?`).join(", ");
    const existing = await db.get(
      `
        SELECT rowid
        FROM PersonalInformation
        ORDER BY rowid ASC
        LIMIT 1;
      `
    );
  
    await db.exec("BEGIN TRANSACTION;");
    try {
      if (existing?.rowid) {
        await db.run(
          `
            UPDATE PersonalInformation
            SET ${updateAssignments}
            WHERE rowid = ?;
          `,
          [...values, existing.rowid]
        );
  
        await db.run(`DELETE FROM PersonalInformation WHERE rowid <> ?;`, [existing.rowid]);
      } else {
        await db.run(
          `
            INSERT INTO PersonalInformation (${PERSONAL_INFORMATION_FIELDS.join(", ")})
            VALUES (${PERSONAL_INFORMATION_FIELDS.map(() => "?").join(", ")});
          `,
          values
        );
      }
  
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;");
      throw error;
    }
  
    return normalized;
  }

  return {
    blockCompanyByName,
    buildCoverLetterDraft,
    buildMcpRunbook,
    createApplication,
    deleteApplicationById,
    ensureApplicationsTable,
    ensureBlockedCompaniesTable,
    ensurePersonalInformationTable,
    ensureSyncServiceSettingsTable,
    enrichPostingsWithApplicationState,
    getApplicationById,
    getExistingAppliedApplicationByPostingUrl,
    getMcpSettings,
    getPersonalInformation,
    getStoredSyncServiceSettings,
    getSyncServiceSettings,
    listApplications,
    listBlockedCompanies,
    listPostingsWithFilters,
    loadSyncServiceSettingsIntoRuntime,
    mapApplicationRow,
    markPostingAppliedState,
    migrateSettingsAndApplicationsFromDatabase,
    normalizeCompanyNameForBlockList,
    normalizeMigrationSelection,
    resolveCompanyIdByName,
    resolveCompanyIdForApplication,
    resolveCompanyIdFromPostingUrl,
    setPostingIgnoredState,
    tableExists,
    unblockCompanyByName,
    updateApplicationStatus,
    upsertMcpSettings,
    upsertPersonalInformation,
    upsertSyncServiceSettings
  };
}

module.exports = {
  createSqliteAppStateRuntime
};
