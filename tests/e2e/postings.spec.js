const { test, expect } = require("@playwright/test");

const SEARCH_COMPATIBILITY_QUERIES = [
  "remote jobs",
  "turkish jobs",
  "turksih jobs",
  "turkiye",
  "t\u00fcrkiye",
  "QA Greenhouse"
];

const PROTECTED_PUBLIC_ROUTE_PREFIXES = ["/settings", "/mcp", "/applications"];
const PROTECTED_PUBLIC_ROUTE_EXACT = ["/sync/start", "/sync/stop", "/postings/ignore"];

function protectedPublicRouteLabel(rawUrl) {
  const url = new URL(rawUrl);
  const pathname = url.pathname.toLowerCase();
  if (PROTECTED_PUBLIC_ROUTE_EXACT.includes(pathname)) {
    return pathname;
  }
  return PROTECTED_PUBLIC_ROUTE_PREFIXES.find((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function installProtectedPublicRouteRecorder(page) {
  const calls = [];
  page.on("request", (request) => {
    const label = protectedPublicRouteLabel(request.url());
    if (label) {
      const url = new URL(request.url());
      calls.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  });
  return calls;
}

async function expectNoProtectedPublicRouteCalls(calls, phase) {
  expect(calls, `public search ${phase} must not call protected admin/API routes`).toEqual([]);
}

async function openPostings(page) {
  const failedResponses = [];
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("pageerror", (error) => {
    failedResponses.push(error.message);
  });

  await page.goto("/");
  await expect(page.getByTestId("brand-wordmark")).toContainText("openjobslots");
  await expect(page.getByTestId("search-shell")).toBeVisible();
  await expect(page.getByTestId("postings-search-input")).toBeVisible();
  await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
  await expect(page.getByTestId("posting-card")).toHaveCount(0);
  await expect(page.getByTestId("app-error-message")).toHaveCount(0);
  await expect(page.getByText(/API:|ATS postings|Sync-enabled companies:|Stored today:/i)).toHaveCount(0);
  await expect(page.getByText(/Request failed \(401\)|Admin token required/i)).toHaveCount(0);
  await expect(page.getByText(/SQLITE_ERROR|SQLITE_BUSY|<!DOCTYPE html/i)).toHaveCount(0);
  await expect(page.getByText(/postgres:\/\/|MEILI_|MASTER_KEY|OPENJOBSLOTS_DB_|OPENJOBSLOTS_SEARCH_|stack trace/i)).toHaveCount(0);

  return failedResponses;
}

async function submitSearchAndExpectResults(page, query = "remote jobs") {
  await page.getByTestId("postings-search-input").fill(query);
  await page.getByTestId("postings-search-input").press("Enter");
  await expect(page.getByTestId("sync-status-panel")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
}

async function expectSearchEngineVisualContract(page) {
  const searchBox = await page.getByTestId("postings-search-input").boundingBox();
  const shell = await page.getByTestId("search-shell").boundingBox();
  const viewport = page.viewportSize() || { width: 1440, height: 900 };
  const searchCenterY = searchBox.y + searchBox.height / 2;

  expect(searchBox.width).toBeGreaterThan(viewport.width < 600 ? 250 : 520);
  expect(shell.height).toBeGreaterThan(viewport.height * (viewport.width < 600 ? 0.82 : 0.86));
  expect(searchCenterY).toBeGreaterThan(viewport.height * 0.43);
  expect(searchCenterY).toBeLessThan(viewport.height * 0.55);
  expect(Math.abs((searchBox.x + searchBox.width / 2) - viewport.width / 2)).toBeLessThan(viewport.width * 0.08);
  expect(Math.abs((searchBox.x + searchBox.width / 2) - (shell.x + shell.width / 2))).toBeLessThan(8);
  await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
  await expect(page.getByText("Enter to search · Esc to clear")).toBeVisible();

  const wordmarkColors = await page.getByTestId("brand-wordmark").evaluate((node) => {
    const colors = [];
    node.querySelectorAll("*").forEach((child) => {
      const text = (child.textContent || "").trim();
      if (text) {
        colors.push(window.getComputedStyle(child).color);
      }
    });
    return Array.from(new Set(colors));
  });

  for (const googleColor of [
    "rgb(66, 133, 244)",
    "rgb(234, 67, 53)",
    "rgb(251, 188, 5)",
    "rgb(52, 168, 83)"
  ]) {
    expect(wordmarkColors, `wordmark should not include Google color ${googleColor}`).not.toContain(googleColor);
  }
  expect(wordmarkColors).toContain("rgb(38, 51, 45)");
  expect(wordmarkColors).toContain("rgb(104, 117, 110)");
}

async function expectSuggestionPanelDoesNotOverlap(page) {
  const suggestions = await page.getByTestId("search-suggestions-panel").boundingBox();
  expect(suggestions).toBeTruthy();
  if ((await page.getByTestId("sync-status-panel").count()) > 0) {
    const coverage = await page.getByTestId("sync-status-panel").boundingBox();
    expect(coverage).toBeTruthy();
    expect(suggestions.y + suggestions.height).toBeLessThan(coverage.y);
  }
}

async function expectSearchMovesUpAfterSubmit(page) {
  const homeSearchBox = await page.getByTestId("postings-search-input").boundingBox();
  await page.getByTestId("postings-search-input").fill("remote jobs");
  await page.getByTestId("postings-search-input").press("Enter");
  await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(380);
  const compactSearchBox = await page.getByTestId("postings-search-input").boundingBox();
  expect(compactSearchBox.y).toBeLessThan(homeSearchBox.y - 70);
  await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);
  await expect(page.getByTestId("sync-status-panel")).toBeVisible();
  await expect(page.getByTestId("results-surface")).toBeVisible();
}

async function expectNoNestedPublicScroll(page) {
  const nestedState = await page.evaluate(() => {
    const read = (testId) => {
      const node = document.querySelector(`[data-testid="${testId}"]`);
      if (!node) return null;
      const style = window.getComputedStyle(node);
      return {
        scrollable: node.scrollHeight > node.clientHeight + 2,
        overflowY: style.overflowY
      };
    };
    return {
      filters: read("filters-panel"),
      list: read("postings-list")
    };
  });

  if (nestedState.filters) {
    expect(nestedState.filters.scrollable, "filters panel should expand in-page instead of scrolling internally").toBe(false);
  }
  if (nestedState.list) {
    expect(nestedState.list.scrollable, "posting cards should use the main page scroll, not their own list scrollbar").toBe(false);
  }
}

async function expectPublicPaletteIsSoft(page) {
  const colors = await page.evaluate(() => {
    const nodes = [
      document.querySelector('[data-testid="search-shell"]'),
      document.querySelector('[data-testid="postings-page-scroll"]'),
      document.querySelector('[data-testid="coverage-strip"]'),
      document.querySelector('[data-testid="posting-card"]'),
      document.querySelector('[data-testid="postings-filter-toggle"]')
    ].filter(Boolean);
    return nodes.flatMap((node) => {
      const style = window.getComputedStyle(node);
      return [style.color, style.backgroundColor, style.borderColor];
    });
  });

  expect(colors).toContain("rgb(246, 244, 232)");
  for (const oldDashboardColor of [
    "rgb(23, 59, 109)",
    "rgb(20, 184, 166)",
    "rgb(16, 42, 67)",
    "rgb(11, 110, 79)",
    "rgb(51, 78, 104)"
  ]) {
    expect(colors, `public search surface should not use old dashboard color ${oldDashboardColor}`).not.toContain(oldDashboardColor);
  }
}

async function expectNoRawErrors(page) {
  await expect(page.getByTestId("app-error-message")).toHaveCount(0);
  await expect(page.getByText(/Request failed \(401\)|Admin token required/i)).toHaveCount(0);
  await expect(page.getByText(/SQLITE_ERROR|SQLITE_BUSY|<!DOCTYPE html/i)).toHaveCount(0);
  await expect(page.getByText(/postgres:\/\/|MEILI_|MASTER_KEY|OPENJOBSLOTS_DB_|OPENJOBSLOTS_SEARCH_|stack trace/i)).toHaveCount(0);
}

async function expectPublicSearchChrome(page) {
  await expect(page.getByLabel("Open navigation menu")).toHaveCount(0);
  await expect(page.getByText("Navigation", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Admin$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Applications$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^MCP$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Profile$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Settings$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Sync$/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Applications$/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^MCP$/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Profile$/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Settings$/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Sync$/i })).toHaveCount(0);
  await expect(page.getByText("MCP Settings", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("sync-postings-button")).toHaveCount(0);
  await expect(page.getByTestId("posting-card-menu")).toHaveCount(0);
}

async function clickSimplifiedDestination(page, label) {
  let target = page
    .getByRole("button", { name: new RegExp(`^${label}$`, "i") })
    .or(page.getByRole("link", { name: new RegExp(`^${label}$`, "i") }))
    .or(page.getByText(label, { exact: true }))
    .first();
  if ((await target.count()) === 0 || !(await target.isVisible())) {
    const settings = page
      .getByRole("button", { name: /^Settings$/i })
      .or(page.getByRole("link", { name: /^Settings$/i }))
      .or(page.getByText("Settings", { exact: true }))
      .first();
    await expect(settings, `${label} should be reachable through simplified Settings navigation`).toBeVisible();
    await settings.click();
    target = page
      .getByRole("button", { name: new RegExp(`^${label}$`, "i") })
      .or(page.getByRole("link", { name: new RegExp(`^${label}$`, "i") }))
      .or(page.getByText(label, { exact: true }))
      .first();
  }
  await expect(target, `${label} should be reachable without a hamburger drawer`).toBeVisible();
  await target.click();
}

async function expectGeoFilterUsable(page, label, searchTerm, expectedMatch, emptyPattern) {
  const key = label.toLowerCase();
  const trigger = page.getByTestId(`${key}-filter-trigger`);
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(/Any|All|Worldwide|selected/i);
  await trigger.click();

  const searchInput = page.getByTestId(`${key}-filter-search`);
  await expect(searchInput).toBeVisible();
  await searchInput.fill(searchTerm);

  const expectedOption = page.getByText(expectedMatch).first();
  const emptyState = page.getByText(emptyPattern).first();
  await expect(expectedOption.or(emptyState)).toBeVisible();

  await searchInput.fill("__openjobslots_no_geo_match__");
  await expect(page.getByText(emptyPattern).first()).toBeVisible();
  await page.getByTestId(`${key}-filter-clear`).click();
  await expect(trigger).toContainText(/Any|All|Worldwide/i);
  await trigger.click();
}

async function installSyncControlMock(page) {
  const state = {
    phase: "idle",
    hasRun: false,
    startStatusRequests: 0
  };

  const buildStatus = () => ({
    ok: true,
    status: state.phase,
    queued: state.phase === "queued",
    running: state.phase === "running",
    stopping: state.phase === "stopping",
    cancel_requested: state.phase === "stopping",
    db_backend: "postgres",
    search_backend: "meili",
    queue_backend: "pg-boss",
    legacy_api_sync: false,
    posting_count: 3,
    postings_seen_24h_count: 3,
    sync_enabled_company_count: 3,
    failed_companies: 0,
    queue_depth: state.running ? 2 : 0,
    last_sync_at: state.hasRun ? "2026-05-06T10:00:00Z" : null,
    last_sync_summary: {
      sync_enabled_company_count: 3,
      failed_companies: 0
    },
    ingestion_worker: {
      latest_status: state.phase === "running" ? "running" : state.phase === "queued" ? "queued" : "idle",
      latest_run_id: state.hasRun ? 42 : null,
      started_at_epoch: state.hasRun ? 1778050800 : null,
      queue_due_count: state.phase === "idle" ? 0 : 2,
      active_ats: state.phase === "running" ? ["greenhouse"] : [],
      failure_count: 0,
      parser_error_count_24h: 0
    }
  });

  await page.route("**/sync/status**", async (route) => {
    if (state.phase === "queued") {
      state.startStatusRequests += 1;
      if (state.startStatusRequests >= 1) {
        state.phase = "running";
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildStatus())
    });
  });

  await page.route("**/sync/start**", async (route) => {
    state.phase = "queued";
    state.hasRun = true;
    state.startStatusRequests = 0;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, status: "queued", queued: true, started: true, running: false, ...buildStatus() })
    });
  });

  await page.route("**/sync/ats**", async (route) => {
    state.phase = "queued";
    state.hasRun = true;
    state.startStatusRequests = 0;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, status: "queued", queued: true, started: true, running: false, ...buildStatus() })
    });
  });

  await page.route("**/sync/stop**", async (route) => {
    state.phase = "stopping";
    await new Promise((resolve) => setTimeout(resolve, 250));
    state.phase = "idle";
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, stopped: true, running: false, stopping: false, ...buildStatus() })
    });
  });

  return state;
}

async function installPostingActionMocks(page) {
  const calls = {
    applications: 0,
    ignored: 0,
    blocked: 0
  };

  await page.route("**/applications", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    calls.applications += 1;
    const payload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        item: {
          id: 9000 + calls.applications,
          company_name: payload.company_name || "QA Company",
          position_name: payload.position_name || "QA Posting",
          job_posting_url: payload.job_posting_url || "https://example.test/job",
          application_date: payload.application_date || Math.floor(Date.now() / 1000),
          status: payload.status || "applied",
          applied_by_label: payload.applied_by_label || "Manually applied by user"
        }
      })
    });
  });

  await page.route("**/postings/ignore", async (route) => {
    calls.ignored += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    });
  });

  await page.route("**/settings/sync/blocked-companies", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    calls.blocked += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    });
  });

  return calls;
}

async function installSettingsWriteMocks(page) {
  await page.route("**/settings/personal-information", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, item: {} })
      });
      return;
    }
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, item: JSON.parse(route.request().postData() || "{}") })
    });
  });

  await page.route("**/settings/sync", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          item: {
            sync_enabled_ats: ["greenhouse"],
            ats_request_queue_concurrency: 1,
            min_ats_request_queue_concurrency: 1,
            max_ats_request_queue_concurrency: 20,
            active_ats_request_queue_concurrency: 1
          }
        })
      });
      return;
    }
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    const payload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        item: {
          sync_enabled_ats: payload.sync_enabled_ats || ["greenhouse"],
          ats_request_queue_concurrency: Number(payload.ats_request_queue_concurrency || 1),
          min_ats_request_queue_concurrency: 1,
          max_ats_request_queue_concurrency: 20,
          active_ats_request_queue_concurrency: Number(payload.ats_request_queue_concurrency || 1)
        }
      })
    });
  });

  await page.route("**/settings/mcp", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          item: {
            auto_apply_enabled: false,
            preferred_remote: "all",
            preferred_industries: [],
            preferred_regions: [],
            preferred_countries: [],
            preferred_states: [],
            preferred_counties: []
          }
        })
      });
      return;
    }
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, item: JSON.parse(route.request().postData() || "{}") })
    });
  });

  await page.route("**/mcp/candidates**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, count: 0, items: [] })
    });
  });

  await page.route("**/settings/sync/blocked-companies", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, items: [] })
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/applications**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, items: [] })
      });
      return;
    }
    await route.continue();
  });
}

test.describe("postings page QA", () => {
  test("public first load and reload do not call protected routes or show raw auth errors", async ({ page }) => {
    const protectedRouteCalls = installProtectedPublicRouteRecorder(page);

    await openPostings(page);
    await expectNoRawErrors(page);
    await expectPublicSearchChrome(page);
    await expectNoProtectedPublicRouteCalls(protectedRouteCalls, "first load");

    protectedRouteCalls.length = 0;
    await page.reload();
    await expect(page.getByTestId("brand-wordmark")).toContainText("openjobslots");
    await expect(page.getByTestId("search-shell")).toBeVisible();
    await expect(page.getByTestId("postings-search-input")).toBeVisible();
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
    await expect(page.getByTestId("posting-card")).toHaveCount(0);
    await expectNoRawErrors(page);
    await expectPublicSearchChrome(page);
    await expectNoProtectedPublicRouteCalls(protectedRouteCalls, "reload");
  });

  test("loads branded search-first page without raw backend errors", async ({ page }) => {
    const failedResponses = await openPostings(page);

    await expectSearchEngineVisualContract(page);
    await expectPublicSearchChrome(page);
    await expectPublicPaletteIsSoft(page);

    for (const query of SEARCH_COMPATIBILITY_QUERIES) {
      await page.getByTestId("postings-search-input").fill(query);
      await page.getByTestId("postings-search-input").press("Enter");
      await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
      await expectNoRawErrors(page);
    }

    expect(failedResponses).toEqual([]);
  });

  test("search motion, suggestions, coverage, and scrolling stay calm", async ({ page }) => {
    await openPostings(page);

    await expect(page.getByTestId("coverage-details")).toHaveCount(0);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
    const homeSearchBox = await page.getByTestId("postings-search-input").boundingBox();

    await page.getByTestId("postings-search-input").fill("tur");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await expect(page.getByTestId("postings-filter-toggle")).toHaveCount(0);
    await expect(page.getByText(/Ctrl\+K focuses search/i)).toHaveCount(0);
    await expectSuggestionPanelDoesNotOverlap(page);
    const suggestSearchBox = await page.getByTestId("postings-search-input").boundingBox();
    expect(Math.abs(suggestSearchBox.y - homeSearchBox.y)).toBeLessThan(24);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);

    await page.getByTestId("postings-search-input").press("Escape");
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);
    await expect(page.getByTestId("postings-filter-toggle")).toBeVisible();
    await page.getByTestId("postings-filter-toggle").click();
    await expect(page.getByTestId("filters-panel")).toBeVisible();
    await expectNoNestedPublicScroll(page);

    await page.getByTestId("brand-wordmark").click();
    await expectSearchMovesUpAfterSubmit(page);
    await page.getByTestId("coverage-toggle").click();
    await expect(page.getByTestId("coverage-details")).toBeVisible();
    await page.getByTestId("coverage-toggle").click();
    await expect(page.getByTestId("coverage-details")).toHaveCount(0);
    await expectNoRawErrors(page);
  });

  test("keyboard shortcuts and brand home keep search fast", async ({ page }) => {
    await openPostings(page);

    await page.keyboard.press("/");
    await expect(page.getByTestId("postings-search-input")).toBeFocused();
    await page.getByTestId("postings-search-input").fill("tur");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await page.getByTestId("search-suggestion-0").click();
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("postings-search-input")).toBeFocused();
    await page.getByTestId("postings-search-input").fill("turksih jobs");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);

    await page.getByTestId("postings-search-input").fill("remote jobs");
    await page.getByTestId("postings-search-input").press("Escape");
    await expect(page.getByTestId("postings-search-input")).toHaveValue("");

    await page.getByTestId("postings-search-input").fill("QA Greenhouse");
    await page.getByTestId("postings-search-input").press("Enter");
    await expect(page.getByTestId("posting-card").first()).toContainText(/QA Greenhouse|Turkish/i, {
      timeout: 15_000
    });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("postings-search-input")).toBeFocused();
    await expect(page.getByTestId("postings-search-input")).toHaveValue(/QA Greenhouse/i);
    await page.getByTestId("postings-search-input").fill("remote jobs");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("postings-filter-toggle").click();
    await page.getByTestId("ats-filter-trigger").click();
    await page.getByTestId("ats-filter-option-greenhouse").click();
    await page.getByTestId("brand-wordmark").click();
    await expect(page.getByTestId("postings-search-input")).toHaveValue("");
    await page.getByTestId("postings-filter-toggle").click();
    await expect(page.getByTestId("ats-filter-trigger")).toContainText(/All ATS/i);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("postings-search-input")).toBeFocused();
  });

  test("public search buttons are clickable without exposing admin controls", async ({ page }) => {
    await openPostings(page);
    await expectPublicSearchChrome(page);

    const visiblePublicButtons = [
      page.getByTestId("brand-wordmark"),
      page.getByTestId("postings-filter-toggle"),
      page.getByTestId("postings-filter-clear")
    ];

    for (const button of visiblePublicButtons) {
      await expect(button).toBeVisible();
    }

    await page.getByTestId("postings-filter-toggle").click();
    await expect(page.getByTestId("ats-filter-trigger")).toBeVisible();
    await page.getByTestId("postings-filter-toggle").click();
    await expect(page.getByTestId("ats-filter-trigger")).toHaveCount(0);

    await page.getByTestId("postings-search-input").fill("tur");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await page.getByTestId("search-suggestion-0").click();
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("brand-wordmark").click();
    await expect(page.getByTestId("postings-search-input")).toHaveValue("");
    await expectNoRawErrors(page);
  });

  test("search keeps stale results visible during transient database busy errors", async ({ page }) => {
    await openPostings(page);
    await submitSearchAndExpectResults(page, "remote jobs");
    const firstCardText = await page.getByTestId("posting-card").first().innerText();

    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/postings") && url.searchParams.get("search") === "busy-probe") {
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "SQLITE_BUSY: database is locked"
        });
        return;
      }
      await route.continue();
    });

    await page.getByTestId("postings-search-input").fill("busy-probe");
    await page.getByTestId("postings-search-input").press("Enter");
    await expect(page.getByTestId("search-notice")).toContainText(/latest results while indexing catches up/i, {
      timeout: 10_000
    });
    await expect(page.getByTestId("posting-card").first()).toContainText(firstCardText.split("\n")[0]);
    await expect(page.getByTestId("app-error-message")).toHaveCount(0);
  });

  test("filters can open, select, combine, and clear", async ({ page }) => {
    await openPostings(page);

    await page.getByTestId("postings-filter-toggle").click();
    await expect(page.getByTestId("ats-filter-trigger")).toBeVisible();

    await page.getByTestId("ats-filter-trigger").click();
    await page.getByTestId("ats-filter-option-greenhouse").click();
    await expect(page.getByTestId("posting-card").first()).toContainText(/Greenhouse|Turkish/i);

    await page.getByTestId("countries-filter-trigger").click();
    await page.getByTestId("countries-filter-search").fill("tur");
    await page.getByText(/Turkey|T\u00fcrkiye/i).first().click();
    await expect(page.getByTestId("countries-filter-trigger")).toContainText(/selected|Turkey|T\u00fcrkiye/i);

    await page.getByTestId("remote-filter-remote").click();
    await expect(page.getByText("No postings found.").or(page.getByTestId("posting-card").first())).toBeVisible();

    await page.getByTestId("countries-filter-clear").click();
    await expect(page.getByTestId("countries-filter-trigger")).toContainText(/Any|All countries|Worldwide/i);

    await page.getByTestId("hide-no-date-filter").click();
    await expect(page.getByText("No postings found.").or(page.getByTestId("posting-card").first())).toBeVisible();

    await page.getByTestId("postings-filter-clear").click();
    await expect(page.getByTestId("posting-card")).toHaveCount(0);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
  });

  test("worldwide geo filters are usable or show graceful empty states", async ({ page }) => {
    await openPostings(page);
    await page.getByTestId("postings-filter-toggle").click();

    await expectGeoFilterUsable(
      page,
      "Regions",
      "emea",
      /EMEA|Europe|Middle East|Africa/i,
      /No regions available|No regions match|No matches/i
    );

    await expectGeoFilterUsable(
      page,
      "Countries",
      "tur",
      /Turkey|T\u00fcrkiye/i,
      /No countries match selected regions|No countries match|No matches/i
    );

    for (const label of ["States", "Counties"]) {
      const key = label.toLowerCase();
      const trigger = page.getByTestId(`${key}-filter-trigger`);
      if ((await trigger.count()) === 0 || !(await trigger.first().isVisible())) {
        continue;
      }

      await expect(trigger).toContainText(/Any|All|Worldwide|selected/i);
      await trigger.click();
      await expect(page.getByTestId(`${key}-filter-search`)).toBeVisible();
      await page.getByTestId(`${key}-filter-search`).fill("__openjobslots_no_geo_match__");
      await expect(
        page.getByText(label === "States" ? /No states available|No states match|No matches/i : /No counties match selected states|No counties match|No matches/i).first()
      ).toBeVisible();
      await page.getByTestId(`${key}-filter-clear`).click();
      await expect(trigger).toContainText(/Any|All|Worldwide/i);
      await trigger.click();
    }

    await page.getByTestId("postings-filter-clear").click();
    await expectNoRawErrors(page);
  });

  test("posting cards do not expose protected mutation actions on the public page", async ({ page }) => {
    await openPostings(page);
    await submitSearchAndExpectResults(page, "remote jobs");

    await expect(page.getByTestId("posting-card").first()).toBeVisible();
    await expect(page.getByTestId("posting-card-menu")).toHaveCount(0);
    await expect(page.getByTestId("posting-card-save")).toHaveCount(0);
    await expect(page.getByTestId("posting-card-ignore")).toHaveCount(0);
    await expect(page.getByTestId("posting-card-block-company")).toHaveCount(0);
  });

  test("public page does not expose admin destinations", async ({ page }) => {
    await openPostings(page);
    await expectPublicSearchChrome(page);

    await expect(page.getByText("Track jobs you applied to.")).toHaveCount(0);
    await expect(page.getByText(/Applicantee information/i)).toHaveCount(0);
    await expect(page.getByText("Sync Settings", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Migrate Settings And Applications")).toHaveCount(0);
    await expect(page.getByText("Save Sync Settings")).toHaveCount(0);
    await expect(page.getByText("Save MCP Settings")).toHaveCount(0);
    await expect(page.getByTestId("brand-wordmark")).toContainText("openjobslots");
  });
});
