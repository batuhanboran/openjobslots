const { test, expect } = require("@playwright/test");
const { version: APP_VERSION } = require("../../package.json");

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

function installPostingsRequestRecorder(page) {
  const calls = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith("/postings")) return;
    calls.push({
      search: url.searchParams.get("search") || "",
      remote: url.searchParams.get("remote") || "",
      ats: url.searchParams.get("ats") || "",
      freshnessDays: url.searchParams.get("freshness_days") || ""
    });
  });
  return calls;
}

async function expectNoProtectedPublicRouteCalls(calls, phase) {
  expect(calls, `public search ${phase} must not call protected admin/API routes`).toEqual([]);
}

async function openJobSlots(page) {
  const failedResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      failedResponses.push(`console error: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    failedResponses.push(`request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`.trim());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("pageerror", (error) => {
    failedResponses.push(error.message);
  });

  await page.goto("/");
  await expect(page.getByTestId("app-logo")).toContainText("openjobslots");
  await expect(page.getByTestId("search-shell")).toBeVisible();
  await expect(page.getByTestId("search-panel")).toBeVisible();
  await expect(page.getByTestId("search-input")).toBeVisible();
  await expect(page.getByTestId("result-count")).toBeVisible();
  await expect(page.getByTestId("sort-control")).toBeVisible();
  const viewport = page.viewportSize() || { width: 1440, height: 900 };
  if (viewport.width >= 768) {
    await expect(page.getByTestId("ats-intelligence-panel")).toBeVisible();
  } else {
    await expect(page.getByTestId("ats-intelligence-panel")).toHaveCount(0);
  }
  await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
  await expect(page.getByTestId("posting-card")).toHaveCount(0);
  await expect(page.getByText("Dense Search Cockpit")).toHaveCount(0);
  await expect(page.getByText("Mobile Card Stack")).toHaveCount(0);
  await expect(page.getByText("ATS Intelligence Overlay")).toHaveCount(0);
  await expect(page.getByText(/demo,\s*local only/i)).toHaveCount(0);
  await expect(page.getByTestId("app-error-message")).toHaveCount(0);
  await expect(page.getByText(/API:|ATS postings|Sync-enabled companies:|Stored today:/i)).toHaveCount(0);
  await expect(page.getByText(/Request failed \(401\)|Admin token required/i)).toHaveCount(0);
  await expect(page.getByText(/SQLITE_ERROR|SQLITE_BUSY|<!DOCTYPE html/i)).toHaveCount(0);
  await expect(page.getByText(/postgres:\/\/|MEILI_|MASTER_KEY|OPENJOBSLOTS_DB_|OPENJOBSLOTS_SEARCH_|stack trace/i)).toHaveCount(0);

  return failedResponses;
}

async function submitSearchAndExpectResults(page, query = "remote jobs") {
  await page.getByTestId("search-input").fill(query);
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("result-count")).toContainText(/slot|slots/i);
  await expect(page.getByTestId("postings-pagination-status")).toBeVisible();
  await expect(page.getByText("Refreshing results...")).toHaveCount(0);
}

async function expectSearchEngineVisualContract(page) {
  const searchBox = await page.getByTestId("search-input").boundingBox();
  const shell = await page.getByTestId("search-shell").boundingBox();
  const panel = await page.getByTestId("search-panel").boundingBox();
  const viewport = page.viewportSize() || { width: 1440, height: 900 };

  expect(searchBox.width).toBeGreaterThan(viewport.width < 600 ? 250 : 240);
  expect(shell.height).toBeLessThan(viewport.height * 1.8);
  if (viewport.width >= 768) {
    expect(panel.x).toBeLessThan(viewport.width * 0.36);
    expect(searchBox.x).toBeLessThan(viewport.width * 0.36);
  } else {
    expect(panel.width).toBeLessThanOrEqual(viewport.width);
    expect(searchBox.y).toBeLessThan(viewport.height * 0.42);
  }
  await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
  await expect(page.getByText(/Enter to search/i)).toBeVisible();

  const wordmarkColors = await page.getByTestId("app-logo").evaluate((node) => {
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
  expect(wordmarkColors).toContain("rgb(82, 125, 104)");
  expect(wordmarkColors).toContain("rgb(127, 191, 166)");
  expect(wordmarkColors).toContain("rgb(104, 117, 110)");
  if (viewport.width >= 768) {
    await expect(page.getByTestId("public-version-button")).toBeVisible();
    await expect(page.getByText(`Public v${APP_VERSION}`)).toBeVisible();
    await expect(page.getByText("Deployed and developed by")).toBeVisible();
    const attributionLink = page.getByRole("link", { name: "Batuhan Boran website" });
    await expect(attributionLink).toBeVisible();
    await expect(attributionLink).toHaveAttribute("href", "https://batuhanboran.com");
    await page.getByTestId("public-version-button").click();
    await expect(page.getByTestId("release-notes-modal")).toBeVisible();
    await expect(page.getByText("Version 1.6.1")).toBeVisible();
    await expect(page.getByText("Data quality tooling release")).toBeVisible();
    await expect(page.getByText("Version 1.6.0")).toBeVisible();
    await expect(page.getByText("Version 1.5.21")).toBeVisible();
    await expect(page.getByText("Parser contract and diagnostics")).toBeVisible();
    await expect(page.getByText("Version 1.5.7")).toBeVisible();
    await expect(page.getByText("Postgres search stability")).toBeVisible();
    await expect(page.getByText("Version 1.5.6")).toBeVisible();
    await expect(page.getByText("Search filter diagnostics")).toBeVisible();
    await expect(page.getByText("Search reliability and sync budgeting")).toBeVisible();
    await expect(page.getByText("OpenJobSlots live baseline")).toBeVisible();
    await expect(page.getByText("Public product history. Internal deployment and security details are intentionally omitted.")).toHaveCount(0);
    await page.getByTestId("release-notes-close").click();
    await expect(page.getByTestId("release-notes-modal")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("public-version-button")).toHaveCount(0);
    await expect(page.getByText("Public v1.6.1")).toHaveCount(0);
    await expect(page.getByText("Deployed and developed by")).toHaveCount(0);
  }

  await expect(page.getByText("Worldwide filters")).toHaveCount(0);
  if (viewport.width >= 768) {
    await expect(page.getByTestId("global-filter-status")).toBeVisible();
  }
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
  const homeSearchBox = await page.getByTestId("search-input").boundingBox();
  await page.getByTestId("search-input").fill("remote jobs");
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(380);
  const compactSearchBox = await page.getByTestId("search-input").boundingBox();
  expect(Math.abs(compactSearchBox.y - homeSearchBox.y)).toBeLessThan(24);
  await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);
  await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
  await expect(page.getByTestId("results-surface")).toBeVisible();
  await expect(page.getByTestId("result-count")).toContainText(/slot|slots/i);
  await expect(page.getByText("Public v1.6.1")).toHaveCount(0);
}

async function expectNoNestedPublicScroll(page) {
  const viewport = page.viewportSize() || { width: 1440, height: 900 };
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

  if (nestedState.filters && viewport.width < 768) {
    expect(nestedState.filters.scrollable, "filters panel should expand in-page instead of scrolling internally").toBe(false);
  }
  if (nestedState.list) {
    expect(nestedState.list.scrollable, "posting cards should use the main page scroll, not their own list scrollbar").toBe(false);
  }
}

async function expectDesktopFilterRailCanScroll(page) {
  const viewport = page.viewportSize() || { width: 1440, height: 900 };
  if (viewport.width < 768) return;

  await ensureFiltersVisible(page);
  const before = await page.getByTestId("search-panel").boundingBox();
  const scrollState = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="filters-panel"]');
    if (!panel) return null;
    const style = window.getComputedStyle(panel);
    panel.scrollTop = 0;
    const beforeTop = panel.scrollTop;
    panel.scrollTop = 1000;
    return {
      beforeTop,
      afterTop: panel.scrollTop,
      clientHeight: panel.clientHeight,
      scrollHeight: panel.scrollHeight,
      overflowY: style.overflowY
    };
  });

  expect(scrollState).toBeTruthy();
  expect(["auto", "scroll"]).toContain(scrollState.overflowY);
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight + 2);
  expect(scrollState.afterTop).toBeGreaterThan(scrollState.beforeTop);

  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(160);
  const after = await page.getByTestId("search-panel").boundingBox();
  expect(Math.abs(after.y - before.y), "sticky rail should stay pinned while its filter body can scroll").toBeLessThan(24);
}

async function expectRemoteFiltersStayInOneRow(page) {
  await ensureFiltersVisible(page);
  const rowState = await page.evaluate(() => {
    const ids = ["remote-filter-all", "remote-filter-remote", "remote-filter-hybrid", "remote-filter-non_remote"];
    const boxes = ids.map((id) => {
      const node = document.querySelector(`[data-testid="${id}"]`);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { id, left: rect.left, right: rect.right, y: rect.y, width: rect.width, height: rect.height };
    });
    const parent = document.querySelector('[data-testid="remote-filter-row"]');
    const parentRect = parent?.getBoundingClientRect();
    return { boxes, parent: parentRect ? { left: parentRect.left, right: parentRect.right } : null };
  });

  expect(rowState.boxes.every(Boolean)).toBeTruthy();
  const yValues = rowState.boxes.map((box) => box.y);
  expect(Math.max(...yValues) - Math.min(...yValues), "remote filter chips should stay on one visual row").toBeLessThan(8);
  expect(rowState.parent).toBeTruthy();
  for (const box of rowState.boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.left).toBeGreaterThanOrEqual(rowState.parent.left - 1);
    expect(box.right).toBeLessThanOrEqual(rowState.parent.right + 1);
  }
}

async function expectDirectSortControl(page) {
  const sort = page.getByTestId("sort-control");
  await expect(sort).toBeVisible();
  await expect(sort).toContainText(/Relevance/i);
  await expect(page.getByTestId("sort-option-relevance")).toBeVisible();
  await expect(page.getByTestId("sort-option-last-seen")).toBeVisible();
  await expect(page.getByTestId("sort-option-posted-date")).toBeVisible();
  await expect(page.getByTestId("sort-option-ats-source")).toBeVisible();
  await expect(page.getByTestId("sort-option-confidence")).toBeVisible();
  await expect(sort.locator('[data-testid$="-filter-options"]')).toHaveCount(0);
}

async function expectResultCountPill(page) {
  const state = await page.getByTestId("result-count").evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      minHeight: style.minHeight,
      display: style.display,
      fontVariantNumeric: style.fontVariantNumeric
    };
  });
  expect(state.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(state.borderRadius)).toBeGreaterThanOrEqual(10);
  expect(Number.parseFloat(state.minHeight || "0")).toBeGreaterThanOrEqual(40);
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const rootWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
      document.querySelector('[data-testid="postings-page-scroll"]')?.scrollWidth || 0
    );
    const offenders = Array.from(document.querySelectorAll("body *"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          testId: node.getAttribute("data-testid") || "",
          tag: node.tagName,
          left: rect.left,
          right: rect.right,
          width: rect.width
        };
      })
      .filter((item) => item.width > 1 && (item.left < -1 || item.right > viewportWidth + 1))
      .slice(0, 5);
    return { viewportWidth, rootWidth, offenders };
  });

  expect(overflow.rootWidth, `page should not horizontally overflow: ${JSON.stringify(overflow.offenders)}`).toBeLessThanOrEqual(
    overflow.viewportWidth + 1
  );
  expect(overflow.offenders).toEqual([]);
}

async function expectMobileTapTarget(page, testId) {
  const viewport = page.viewportSize() || { width: 1440, height: 900 };
  if (viewport.width >= 600) return;
  const target = page.getByTestId(testId).first();
  await expect(target).toBeVisible();
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      return box?.height || 0;
    }, `${testId} should be at least 44px tall on mobile`)
    .toBeGreaterThanOrEqual(44);
}

async function expectScrollTopButtonWorks(page) {
  await expect(page.getByTestId("postings-scroll-top-button")).toHaveCount(0);
  await page.getByTestId("postings-page-scroll").hover();
  await page.mouse.wheel(0, 1300);
  await expect(page.getByTestId("postings-scroll-top-button")).toBeVisible({ timeout: 3000 });
  await expectMobileTapTarget(page, "postings-scroll-top-button");
  await page.getByTestId("postings-scroll-top-button").click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const scrollNode = document.querySelector('[data-testid="postings-page-scroll"]');
        return Math.max(window.scrollY || 0, scrollNode?.scrollTop || 0);
      })
    )
    .toBeLessThan(80);
  await expect(page.getByTestId("postings-scroll-top-button")).toHaveCount(0);
}

async function expectMobileFiltersNearControls(page) {
  const viewport = page.viewportSize() || { width: 1440, height: 900 };
  if (viewport.width >= 600) return;
  await page.waitForTimeout(360);
  const toggleBox = await page.getByTestId("postings-filter-toggle").boundingBox();
  const panelBox = await page.getByTestId("filters-panel").boundingBox();
  const gap = panelBox.y - (toggleBox.y + toggleBox.height);
  expect(gap, "mobile filters panel should open close to the filter controls").toBeLessThan(90);
}

async function ensureFiltersVisible(page) {
  if ((await page.getByTestId("filters-panel").count()) === 0) {
    await page.getByTestId("postings-filter-toggle").click();
  }
  await expect(page.getByTestId("filters-panel")).toBeVisible();
  await expect(page.getByTestId("ats-filter-trigger")).toBeVisible();
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

async function installNoResultsRoute(page, searchValue = "__openjobslots_empty_probe__") {
  await page.route("**/postings**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/postings") && url.searchParams.get("search") === searchValue) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          count: 0,
          limit: Number(url.searchParams.get("limit") || 80),
          offset: Number(url.searchParams.get("offset") || 0),
          has_more: false,
          next_offset: null,
          items: []
        })
      });
      return;
    }
    await route.continue();
  });
}

test.describe("postings page QA", () => {
  test("public first load and reload do not call protected routes or show raw auth errors", async ({ page }) => {
    const protectedRouteCalls = installProtectedPublicRouteRecorder(page);

    await openJobSlots(page);
    await expectNoRawErrors(page);
    await expectPublicSearchChrome(page);
    await expectNoProtectedPublicRouteCalls(protectedRouteCalls, "first load");

    protectedRouteCalls.length = 0;
    await page.reload();
    await expect(page.getByTestId("app-logo")).toContainText("openjobslots");
    await expect(page.getByTestId("search-shell")).toBeVisible();
    await expect(page.getByTestId("search-input")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
    await expect(page.getByTestId("posting-card")).toHaveCount(0);
    await expectNoRawErrors(page);
    await expectPublicSearchChrome(page);
    await expectNoProtectedPublicRouteCalls(protectedRouteCalls, "reload");
  });

  test("loads branded search-first page without raw backend errors", async ({ page }) => {
    const failedResponses = await openJobSlots(page);

    await expectSearchEngineVisualContract(page);
    await expectPublicSearchChrome(page);
    await expectPublicPaletteIsSoft(page);
    await expectDirectSortControl(page);
    await expectResultCountPill(page);

    for (const query of SEARCH_COMPATIBILITY_QUERIES) {
      await page.getByTestId("search-input").fill(query);
      await page.getByTestId("search-input").press("Enter");
      await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
      await expectNoRawErrors(page);
    }

    expect(failedResponses).toEqual([]);
  });

  test("desktop shell keeps the search panel sticky while results scroll", async ({ page }) => {
    const viewport = page.viewportSize() || { width: 1440, height: 900 };
    test.skip(viewport.width < 768, "desktop sticky behavior is covered by the desktop project");

    await openJobSlots(page);
    await submitSearchAndExpectResults(page, "remote jobs");
    const before = await page.getByTestId("search-panel").boundingBox();
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(250);
    const after = await page.getByTestId("search-panel").boundingBox();

    expect(after.y).toBeGreaterThanOrEqual(0);
    expect(Math.abs(after.y - before.y), "sticky panel should stay pinned during document scroll").toBeLessThan(24);
    await expectDesktopFilterRailCanScroll(page);
    await expectRemoteFiltersStayInOneRow(page);
    await expectNoHorizontalOverflow(page);
  });

  test("mobile shell keeps filters collapsible without horizontal overflow", async ({ page }) => {
    const viewport = page.viewportSize() || { width: 1440, height: 900 };
    test.skip(viewport.width >= 768, "mobile shell behavior is covered by the mobile project");

    await openJobSlots(page);
    await expect(page.getByTestId("filters-panel")).toHaveCount(0);
    const searchBox = await page.getByTestId("search-input").boundingBox();
    expect(searchBox.y).toBeLessThan(viewport.height * 0.42);
    await page.getByTestId("postings-filter-toggle").click();
    await expect(page.getByTestId("filters-panel")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("result count, freshness, and sort controls reflect current API results", async ({ page }) => {
    const postingItem = {
      id: 7001,
      company_name: "QA Dynamic Count",
      position_name: "Remote Product Engineer",
      job_posting_url: "https://jobs.lever.co/openjobslotsqa/dynamic-count",
      location: "Remote - EMEA",
      posting_date: "2026-05-15",
      last_seen_epoch: 1778889600,
      ats: "lever"
    };
    const requestedPostings = [];
    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/postings")) {
        await route.continue();
        return;
      }
      requestedPostings.push({
        search: url.searchParams.get("search") || "",
        freshnessDays: url.searchParams.get("freshness_days") || "",
        sortBy: url.searchParams.get("sort_by") || ""
      });
      const freshnessDays = url.searchParams.get("freshness_days");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [postingItem],
          count: freshnessDays === "3" ? 7 : 42,
          count_exact: true,
          limit: Number(url.searchParams.get("limit") || 80),
          offset: Number(url.searchParams.get("offset") || 0),
          has_more: false,
          next_offset: null,
          filters: {
            search: url.searchParams.get("search") || "",
            freshness_days: freshnessDays ? Number(freshnessDays) : null,
            sort_by: url.searchParams.get("sort_by") || "relevance"
          }
        })
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("dynamic");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("result-count")).toContainText("42 slots");

    await ensureFiltersVisible(page);
    await page.getByTestId("freshness-filter-3d").click();
    await expect(page.getByTestId("result-count")).toContainText("7 slots");
    await expect
      .poll(() => requestedPostings.some((request) => request.search === "dynamic" && request.freshnessDays === "3"))
      .toBeTruthy();

    await expectDirectSortControl(page);
    await page.getByTestId("sort-option-posted-date").click();
    await expect(page.getByTestId("sort-control")).toContainText(/Posted date/i);
    await expect
      .poll(() => requestedPostings.some((request) => request.search === "dynamic" && request.sortBy === "posted_date"))
      .toBeTruthy();
    await expectNoRawErrors(page);
  });

  test("sources in results panel reflects facets and filters by source", async ({ page }) => {
    const requestedPostings = [];
    const basePosting = {
      id: 8101,
      company_name: "QA Source Facet",
      position_name: "Source Intelligence Engineer",
      job_posting_url: "https://boards.greenhouse.io/openjobslotsqa/jobs/source-facet",
      location: "Remote",
      posting_date: "2026-05-16",
      last_seen_epoch: 1778889600,
      ats: "greenhouse"
    };

    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/postings")) {
        await route.continue();
        return;
      }
      const search = url.searchParams.get("search") || "";
      if (search !== "source mix") {
        await route.continue();
        return;
      }

      const ats = url.searchParams.get("ats") || "";
      requestedPostings.push({ search, ats });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [basePosting],
          count: ats === "greenhouse" ? 3 : 7,
          count_exact: true,
          limit: Number(url.searchParams.get("limit") || 80),
          offset: Number(url.searchParams.get("offset") || 0),
          has_more: false,
          next_offset: null,
          filters: {
            search,
            ats: ats ? [ats] : [],
            sort_by: url.searchParams.get("sort_by") || "relevance"
          },
          source_facets: ats === "greenhouse"
            ? [
                {
                  value: "greenhouse",
                  label: "Greenhouse",
                  count: 3,
                  avg_confidence: 0.91,
                  avg_quality: 88,
                  latest_seen_epoch: 1778889600,
                  fresh_percentage: 100
                }
              ]
            : [
                {
                  value: "greenhouse",
                  label: "Greenhouse",
                  count: 5,
                  avg_confidence: 0.82,
                  avg_quality: 77,
                  latest_seen_epoch: 1778889600,
                  fresh_percentage: 80
                },
                {
                  value: "lever",
                  label: "Lever",
                  count: 2,
                  avg_confidence: 0.73,
                  avg_quality: 68,
                  latest_seen_epoch: 1778803200,
                  fresh_percentage: 50
                }
              ]
        })
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("source mix");
    await page.getByTestId("search-input").press("Enter");
    await ensureFiltersVisible(page);

    const sourcePanel = page.getByTestId("ats-intelligence-panel");
    await expect(sourcePanel).toBeVisible();
    await expect(sourcePanel.getByText("Sources in results")).toBeVisible();
    await expect(page.getByTestId("source-intelligence-row-greenhouse")).toContainText("Greenhouse");
    await expect(page.getByTestId("source-intelligence-count-greenhouse")).toContainText("5 results");
    await expect(page.getByTestId("source-intelligence-quality-greenhouse")).toContainText(/Conf 82%|Quality 77/i);
    await expect(page.getByTestId("source-intelligence-freshness-greenhouse")).toContainText(/80% fresh|seen/i);
    await expect(sourcePanel).not.toContainText(/risk|recommendation/i);

    await page.getByTestId("source-intelligence-row-greenhouse").click();
    await expect
      .poll(() => requestedPostings.some((request) => request.search === "source mix" && request.ats === "greenhouse"))
      .toBeTruthy();
    await expect(page.getByTestId("ats-filter-trigger")).toContainText(/Greenhouse/i);
    await expect(page.getByTestId("source-intelligence-count-greenhouse")).toContainText("3 results");
    await expectNoRawErrors(page);
  });

  test("search still works when source facets are absent", async ({ page }) => {
    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/postings") || url.searchParams.get("search") !== "facetless-source") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: 8201,
              company_name: "QA Facetless",
              position_name: "Fallback Source Analyst",
              job_posting_url: "https://boards.greenhouse.io/openjobslotsqa/jobs/facetless",
              location: "Remote",
              posting_date: "2026-05-16",
              last_seen_epoch: 1778889600,
              ats: "greenhouse"
            }
          ],
          count: 1,
          count_exact: true,
          limit: Number(url.searchParams.get("limit") || 80),
          offset: Number(url.searchParams.get("offset") || 0),
          has_more: false,
          next_offset: null,
          filters: {
            search: "facetless-source",
            sort_by: "relevance"
          }
        })
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("facetless-source");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("posting-card").first()).toContainText("QA Facetless");
    await ensureFiltersVisible(page);
    await expect(page.getByTestId("ats-intelligence-panel")).toBeVisible();
    await expect(page.getByTestId("source-intelligence-row-greenhouse")).toContainText("Greenhouse");
    await expectNoRawErrors(page);
  });

  test("search motion, suggestions, coverage, and scrolling stay calm", async ({ page }) => {
    await openJobSlots(page);

    await expect(page.getByTestId("coverage-details")).toHaveCount(0);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
    const homeSearchBox = await page.getByTestId("search-input").boundingBox();

    await page.getByTestId("search-input").fill("tur");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await expectMobileTapTarget(page, "search-suggestion-0");
    await expect(page.getByText(/Ctrl\+K focuses search/i)).toHaveCount(0);
    await expectSuggestionPanelDoesNotOverlap(page);
    const suggestSearchBox = await page.getByTestId("search-input").boundingBox();
    expect(Math.abs(suggestSearchBox.y - homeSearchBox.y)).toBeLessThan(24);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);

    await page.getByTestId("search-input").press("Escape");
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);
    await expectMobileTapTarget(page, "postings-filter-clear");
    await ensureFiltersVisible(page);
    await expectMobileFiltersNearControls(page);
    await expectNoNestedPublicScroll(page);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId("app-logo").click();
    await expectSearchMovesUpAfterSubmit(page);
    await expectScrollTopButtonWorks(page);
    await expect(page.getByTestId("coverage-toggle")).toHaveCount(0);
    await expectNoRawErrors(page);
  });

  test("autocomplete exposes visible intent chips and applies explicit filters", async ({ page }) => {
    const protectedCalls = installProtectedPublicRouteRecorder(page);
    const postingsRequests = installPostingsRequestRecorder(page);
    await openJobSlots(page);

    await page.getByTestId("search-input").fill("remote frontend engineer");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await expect(page.getByTestId("intent-chip-remote")).toBeVisible();
    await expectMobileTapTarget(page, "intent-chip-remote");
    await page.getByTestId("intent-chip-remote").click();
    await expect
      .poll(() => postingsRequests.some((request) => request.search === "remote frontend engineer" && request.remote === "remote"))
      .toBeTruthy();

    await page.getByTestId("search-input").fill("hybrid designer");
    await expect(page.getByTestId("intent-chip-hybrid")).toBeVisible();

    await page.getByTestId("search-input").fill("greenhouse engineer");
    await expect(page.getByTestId("intent-chip-source-greenhouse")).toBeVisible();

    await page.getByTestId("search-input").fill("last 3 days");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await expect(page.getByTestId("intent-chip-freshness-3d")).toBeVisible();
    await page.getByTestId("intent-chip-freshness-3d").click();
    await expect
      .poll(() => postingsRequests.some((request) => request.search === "last 3 days" && request.freshnessDays === "3"))
      .toBeTruthy();

    await page.getByTestId("search-input").fill("remote frontend engineer");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await page.getByTestId("search-input").press("Escape");
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
    await expectNoRawErrors(page);
    await expectNoProtectedPublicRouteCalls(protectedCalls, "autocomplete intent");
  });

  test("keyboard shortcuts and brand home keep search fast", async ({ page }) => {
    await openJobSlots(page);

    await page.keyboard.press("/");
    await expect(page.getByTestId("search-input")).toBeFocused();
    await page.getByTestId("search-input").fill("tur");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await page.getByTestId("search-suggestion-0").click();
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("search-input")).toBeFocused();
    await page.getByTestId("search-input").fill("turksih jobs");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);

    await page.getByTestId("search-input").fill("remote jobs");
    await page.getByTestId("search-input").press("Escape");
    await expect(page.getByTestId("search-input")).toHaveValue("");

    await page.getByTestId("search-input").fill("QA Greenhouse");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("posting-card").first()).toContainText(/QA Greenhouse|Turkish/i, {
      timeout: 15_000
    });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("search-input")).toBeFocused();
    await expect(page.getByTestId("search-input")).toHaveValue(/QA Greenhouse/i);
    await page.getByTestId("search-input").fill("remote jobs");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });

    await ensureFiltersVisible(page);
    await page.getByTestId("ats-filter-trigger").click();
    await page.getByTestId("ats-filter-option-greenhouse").click();
    await page.getByTestId("app-logo").click();
    await expect(page.getByTestId("search-input")).toHaveValue("");
    await ensureFiltersVisible(page);
    await expect(page.getByTestId("ats-filter-trigger")).toContainText(/All ATS/i);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("search-input")).toBeFocused();
  });

  test("public search buttons are clickable without exposing admin controls", async ({ page }) => {
    await openJobSlots(page);
    await expectPublicSearchChrome(page);

    const visiblePublicButtons = [
      page.getByTestId("app-logo"),
      page.getByTestId("postings-filter-clear")
    ];

    for (const button of visiblePublicButtons) {
      await expect(button).toBeVisible();
    }

    await ensureFiltersVisible(page);
    await expect(page.getByTestId("ats-filter-trigger")).toBeVisible();

    await page.getByTestId("search-input").fill("tur");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await page.getByTestId("search-suggestion-0").click();
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("app-logo").click();
    await expect(page.getByTestId("search-input")).toHaveValue("");
    await expectNoRawErrors(page);
  });

  test("search keeps stale results visible during transient database busy errors", async ({ page }) => {
    await openJobSlots(page);
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

    await page.getByTestId("search-input").fill("busy-probe");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("search-notice")).toContainText(/latest results while indexing catches up/i, {
      timeout: 10_000
    });
    await expect(page.getByTestId("posting-card").first()).toContainText(firstCardText.split("\n")[0]);
    await expect(page.getByTestId("app-error-message")).toHaveCount(0);
  });

  test("no-results and clear states stay predictable", async ({ page }) => {
    const emptySearch = "__openjobslots_empty_probe__";
    await installNoResultsRoute(page, emptySearch);
    await openJobSlots(page);

    await page.getByTestId("search-input").fill(emptySearch);
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("postings-empty-state")).toBeVisible();
    await expect(page.getByText(/No slots match this exact search/i)).toBeVisible();
    await expect(page.getByTestId("posting-card")).toHaveCount(0);
    await expectNoRawErrors(page);

    await page.getByTestId("postings-filter-clear").click();
    await expect(page.getByTestId("search-input")).toHaveValue("");
    await expect(page.getByTestId("postings-empty-state")).toHaveCount(0);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
    await expectNoRawErrors(page);
  });

  test("optional status failures do not break the public search shell", async ({ page }) => {
    await page.route("**/sync/status**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "text/html",
        body: "<!DOCTYPE html><pre>SQLITE_BUSY: database is locked</pre>"
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("remote jobs");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
    await expect(page.getByTestId("coverage-toggle")).toHaveCount(0);
    await expect(page.getByTestId("app-error-message")).toHaveCount(0);
    await expectNoRawErrors(page);
  });

  test("release notes modal is closable by keyboard and backdrop", async ({ page }) => {
    await openJobSlots(page);
    const viewport = page.viewportSize() || { width: 1440, height: 900 };
    test.skip(viewport.width < 768, "release notes entry point is desktop-only");

    await page.getByTestId("public-version-button").click();
    await expect(page.getByTestId("release-notes-modal")).toBeVisible();
    await expect(page.getByTestId("release-notes-scroll")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("release-notes-modal")).toHaveCount(0);

    await page.getByTestId("public-version-button").click();
    await expect(page.getByTestId("release-notes-modal")).toBeVisible();
    await page.getByTestId("release-notes-backdrop").click({ position: { x: 5, y: 5 }, force: true });
    await expect(page.getByTestId("release-notes-modal")).toHaveCount(0);
    await expect(page.getByTestId("search-input")).toBeVisible();
  });

  test("filters can open, select, combine, and clear", async ({ page }) => {
    await openJobSlots(page);

    await ensureFiltersVisible(page);
    await expectMobileFiltersNearControls(page);
    await expectMobileTapTarget(page, "ats-filter-trigger");
    await expectMobileTapTarget(page, "postings-filter-clear");
    await expectNoHorizontalOverflow(page);

    await page.getByTestId("ats-filter-trigger").click();
    await expectMobileTapTarget(page, "ats-filter-option-greenhouse");
    await page.getByTestId("ats-filter-option-greenhouse").click();
    await expect(page.getByTestId("posting-card").first()).toContainText(/Greenhouse|Turkish/i);

    await page.getByTestId("countries-filter-trigger").click();
    await page.getByTestId("countries-filter-search").fill("tur");
    await page.getByText(/Turkey|T\u00fcrkiye/i).first().click();
    await expect(page.getByTestId("countries-filter-trigger")).toContainText(/selected|Turkey|T\u00fcrkiye/i);

    await page.getByTestId("remote-filter-remote").click();
    await expectMobileTapTarget(page, "remote-filter-remote");
    await expect(page.getByTestId("postings-empty-state").or(page.getByTestId("posting-card").first())).toBeVisible();
    if (await page.getByTestId("postings-empty-state").isVisible()) {
      await expect(page.getByTestId("empty-clear-location-filters")).toBeVisible();
      await expect(page.getByTestId("empty-clear-remote-filter")).toBeVisible();
    }

    await page.getByTestId("countries-filter-clear").click();
    await expect(page.getByTestId("countries-filter-trigger")).toContainText(/Any|All countries|Worldwide/i);

    await page.getByTestId("hide-no-date-filter").click();
    await expect(page.getByTestId("postings-empty-state").or(page.getByTestId("posting-card").first())).toBeVisible();

    await page.getByTestId("postings-filter-clear").click();
    await expect(page.getByTestId("posting-card")).toHaveCount(0);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
  });

  test("worldwide geo filters are usable or show graceful empty states", async ({ page }) => {
    await openJobSlots(page);
    await ensureFiltersVisible(page);

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
    await openJobSlots(page);
    await submitSearchAndExpectResults(page, "remote jobs");

    await expect(page.getByTestId("posting-card").first()).toBeVisible();
    await expect(page.getByTestId("posting-card-menu")).toHaveCount(0);
    await expect(page.getByTestId("posting-card-save")).toHaveCount(0);
    await expect(page.getByTestId("posting-card-ignore")).toHaveCount(0);
    await expect(page.getByTestId("posting-card-block-company")).toHaveCount(0);
  });

  test("posting cards do not expose source diagnostics on the public page", async ({ page }) => {
    await openJobSlots(page);
    await submitSearchAndExpectResults(page, "remote jobs");

    const firstCard = page.getByTestId("posting-card").first();
    await expect(firstCard.getByTestId("posting-card-source-toggle")).toHaveCount(0);
    await expect(firstCard.getByTestId("posting-card-source-panel")).toHaveCount(0);
    await expect(firstCard.getByText(/Quality:|Parser:|Flags:|raw_payload|postgres:\/\/|MEILI_|MASTER_KEY|stack trace/i)).toHaveCount(0);
  });

  test("public page does not expose admin destinations", async ({ page }) => {
    await openJobSlots(page);
    await expectPublicSearchChrome(page);

    await expect(page.getByText("Track jobs you applied to.")).toHaveCount(0);
    await expect(page.getByText(/Applicantee information/i)).toHaveCount(0);
    await expect(page.getByText("Sync Settings", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Migrate Settings And Applications")).toHaveCount(0);
    await expect(page.getByText("Save Sync Settings")).toHaveCount(0);
    await expect(page.getByText("Save MCP Settings")).toHaveCount(0);
    await expect(page.getByTestId("app-logo")).toContainText("openjobslots");
  });
});
