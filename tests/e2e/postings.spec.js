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
const VISITED_POSTING_URLS_STORAGE_KEY = "openjobslots.visitedPostingUrls.v1";
const VISITED_POSTING_COLOR_RGB = "rgb(104, 29, 168)";

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
      freshnessDays: url.searchParams.get("freshness_days") || "",
      sortBy: url.searchParams.get("sort_by") || ""
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
  await expect(page.getByTestId("result-count")).toHaveCount(0);
  await expect(page.getByTestId("public-stats-chips")).toHaveCount(0);
  await expect(page.getByTestId("sort-control")).toHaveCount(0);
  await expect(page.getByTestId("filters-panel")).toHaveCount(0);
  await expect(page.getByTestId("ats-intelligence-panel")).toHaveCount(0);
  await expect(page.getByTestId("postings-initial-state")).toHaveCount(0);
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

async function expectReleaseNotesAreVersionSpecific(page, languageCode) {
  const topVersions = ["2.1.0", "2.0.0", "1.9.3", "1.9.2", "1.9.1"];
  const summaries = [];
  for (const version of topVersions) {
    const title = page.getByTestId(`release-note-title-${version}`);
    const summary = page.getByTestId(`release-note-summary-${version}`);
    await expect(title, `${languageCode} release ${version} title should be visible`).toBeVisible();
    await expect(summary, `${languageCode} release ${version} summary should be visible`).toBeVisible();
    summaries.push(String(await summary.textContent()).replace(/\s+/g, " ").trim());
  }
  expect(new Set(summaries).size, `${languageCode} release summaries should not repeat one generic fallback`).toBe(summaries.length);
  expect(summaries.some((text) => /This release improved public search, data quality, coverage, and production reliability/i.test(text))).toBe(false);
}

async function expectRefreshIndicatorOrCompletedSearch(page, expectedUpdatingText, expectedResultText) {
  const indicator = page.getByTestId("postings-refresh-indicator");
  const resultCount = page.getByTestId("result-count");
  const indicatorVisible = await indicator.waitFor({ state: "visible", timeout: 1500 })
    .then(() => true)
    .catch(() => false);

  if (indicatorVisible) {
    await expect(indicator).toContainText(expectedUpdatingText);
    return;
  }

  await expect(resultCount).toContainText(expectedResultText, { timeout: 15_000 });
}

async function enableDarkMode(page) {
  const toggle = page.getByTestId("theme-toggle");
  if (!/Night|Dark|Gece|Nuit|Noche|Nacht/i.test(await toggle.textContent())) {
    await toggle.click();
  }
  await expect(toggle).toContainText(/Night|Dark|Gece|Nuit|Noche|Nacht/i);
}

async function expectSearchEngineVisualContract(page) {
  const searchBox = await page.getByTestId("search-input").boundingBox();
  const shell = await page.getByTestId("search-shell").boundingBox();
  const panel = await page.getByTestId("search-panel").boundingBox();
  const viewport = page.viewportSize() || { width: 1440, height: 900 };

  expect(searchBox.width).toBeGreaterThan(viewport.width < 600 ? 250 : 240);
  expect(shell.height).toBeLessThan(viewport.height * 1.8);
  if (viewport.width >= 768) {
    expect(panel.width).toBeGreaterThan(viewport.width * 0.96);
    expect(Math.abs(searchBox.x + searchBox.width / 2 - viewport.width / 2)).toBeLessThan(viewport.width * 0.08);
  } else {
    expect(panel.width).toBeLessThanOrEqual(viewport.width);
    expect(searchBox.y).toBeLessThan(viewport.height * 0.42);
  }
  await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
  if (viewport.width >= 768) {
    await expect(page.getByText(/Enter to search/i)).toBeVisible();
  } else {
    await expect(page.getByText(/Enter to search|Esc to clear/i)).toHaveCount(0);
  }

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
  expect(wordmarkColors).toContain("rgb(95, 54, 242)");
  expect(wordmarkColors).toContain("rgb(124, 58, 237)");
  expect(wordmarkColors).toContain("rgb(168, 85, 247)");
  expect(wordmarkColors.length).toBeGreaterThanOrEqual(3);
  if (viewport.width >= 768) {
    await expect(page.getByTestId("public-version-button")).toBeVisible();
    await expect(page.getByText(`Public v${APP_VERSION}`)).toBeVisible();
    await expect(page.getByText("Deployed and developed by")).toBeVisible();
    const footer = page.getByTestId("public-footer-meta");
    await expect(footer).toBeVisible();
    const footerBox = await footer.boundingBox();
    expect(footerBox.y).toBeGreaterThan(viewport.height * 0.82);
    const attributionLink = page.getByRole("link", { name: "Batuhan Boran website" });
    await expect(attributionLink).toBeVisible();
    await expect(attributionLink).toHaveAttribute("href", "https://batuhanboran.com");
    await page.getByTestId("public-version-button").click();
    await expect(page.getByTestId("release-notes-modal")).toBeVisible();
    await expect(page.getByText("Version 2.1.0")).toBeVisible();
    await expect(page.getByText("ATS pipeline and runtime safety")).toBeVisible();
    await expect(page.getByText(/Strengthens source-module dispatch and parser evidence lanes/i)).toBeVisible();
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
    await expect(page.getByTestId("public-footer-meta")).toBeVisible();
    await expect(page.getByTestId("public-version-button")).toBeVisible();
    await expect(page.getByText(`Public v${APP_VERSION}`)).toBeVisible();
    await expect(page.getByText("Deployed and developed by")).toBeVisible();
  }

  await expect(page.getByText("Worldwide filters")).toHaveCount(0);
  await expect(page.getByTestId("global-filter-status")).toHaveCount(0);
}

async function expectExampleSearchPlaceholderRotatesWithoutSuggestions(page) {
  const suggestionCalls = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/search/suggest")) {
      suggestionCalls.push(`${url.pathname}${url.search}`);
    }
  });

  const input = page.getByTestId("search-input");
  await expect
    .poll(() => input.getAttribute("placeholder"))
    .toMatch(/^[A-Za-z][A-Za-z ]{1,}$/);
  const firstPlaceholder = await input.getAttribute("placeholder");
  expect(firstPlaceholder).not.toMatch(/^(Try|Orn\.|Beispiel|Essayez|Prueba)\b/i);
  expect(firstPlaceholder).not.toContain('"');
  await expect
    .poll(() => input.getAttribute("placeholder"))
    .not.toEqual(firstPlaceholder);
  const secondPlaceholder = await input.getAttribute("placeholder");
  expect(secondPlaceholder).not.toMatch(/^(Try|Orn\.|Beispiel|Essayez|Prueba)\b/i);
  expect(secondPlaceholder).not.toContain('"');
  expect(suggestionCalls).toEqual([]);
}

async function expectSuggestionPanelDoesNotOverlap(page) {
  const suggestions = await page.getByTestId("search-suggestions-panel").boundingBox();
  const searchFrame = await page.getByTestId("search-box-frame").boundingBox();
  expect(suggestions).toBeTruthy();
  expect(searchFrame).toBeTruthy();
  expect(Math.abs(suggestions.x - searchFrame.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(suggestions.width - searchFrame.width)).toBeLessThanOrEqual(4);
  expect(suggestions.y - (searchFrame.y + searchFrame.height)).toBeGreaterThanOrEqual(-8);
  expect(suggestions.y - (searchFrame.y + searchFrame.height)).toBeLessThanOrEqual(6);
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
  expect(compactSearchBox.y).toBeLessThan(homeSearchBox.y);
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
  await expectNoFilterChrome(page);
}

async function expectRemoteFiltersStayInOneRow(page) {
  await expectNoFilterChrome(page);
}

async function expectDirectSortControl(page) {
  await expect(page.getByTestId("sort-control")).toHaveCount(0);
}

async function expectInitialIndexCountVisible(page) {
  const count = page.getByTestId("result-count");
  await expect(count).toHaveCount(0);
}

async function expectSortActiveFillFits(page) {
  await expect(page.getByTestId("sort-control")).toHaveCount(0);
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

async function expectStatsChipsAligned(page) {
  const metrics = await page.evaluate(() => {
    const readChip = (testId) => {
      const node = document.querySelector(`[data-testid="${testId}"]`);
      if (!node) return null;
      const children = Array.from(node.children);
      const value = children[0];
      const label = children[1];
      const rect = node.getBoundingClientRect();
      const valueRect = value?.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const valueStyle = value ? window.getComputedStyle(value) : null;
      const labelStyle = label ? window.getComputedStyle(label) : null;
      return {
        testId,
        height: rect.height,
        minHeight: style.minHeight,
        display: style.display,
        flexDirection: style.flexDirection,
        alignItems: style.alignItems,
        gap: style.columnGap || style.gap,
        fontVariantNumeric: style.fontVariantNumeric,
        valueFont: valueStyle?.fontFamily || "",
        labelFont: labelStyle?.fontFamily || "",
        valueTopInset: valueRect ? valueRect.top - rect.top : -1,
        labelTopInset: labelRect ? labelRect.top - rect.top : -1,
        textBottomDelta: valueRect && labelRect ? Math.abs(valueRect.bottom - labelRect.bottom) : 999,
        children: children.length
      };
    };
    return {
      viewportWidth: window.innerWidth,
      chips: ["result-count", "public-stat-ats", "public-stat-companies"].map(readChip)
    };
  });

  const isMobile = metrics.viewportWidth < 768;
  for (const chip of metrics.chips) {
    expect(chip, "stats chip should exist").toBeTruthy();
    expect(chip.children, `${chip.testId} should render value and label as separate text nodes`).toBe(2);
    expect(chip.display, `${chip.testId} should use flex layout`).toBe("flex");
    if (isMobile) {
      expect(chip.flexDirection, `${chip.testId} should stack value and label on mobile`).toBe("column");
      expect(chip.alignItems, `${chip.testId} should center mobile chip copy`).toBe("center");
    } else {
      expect(chip.alignItems, `${chip.testId} should baseline-align value and label`).toBe("baseline");
    }
    expect(Number.parseFloat(chip.minHeight), `${chip.testId} should keep stable height`).toBeGreaterThanOrEqual(42);
    expect(chip.height, `${chip.testId} visual height should be consistent`).toBeGreaterThanOrEqual(40);
    expect(chip.height, `${chip.testId} visual height should be compact`).toBeLessThanOrEqual(48);
    expect(chip.fontVariantNumeric, `${chip.testId} should use tabular numerals`).toContain("tabular-nums");
    expect(chip.valueFont, `${chip.testId} value and label should share a font family`).toBe(chip.labelFont);
    expect(chip.valueFont, `${chip.testId} should not fall back to the old Arial-first stack`).not.toMatch(/^Arial\b/i);
    expect(chip.valueTopInset, `${chip.testId} value should sit inside the chip`).toBeGreaterThanOrEqual(4);
    expect(chip.labelTopInset, `${chip.testId} label should sit inside the chip`).toBeGreaterThanOrEqual(6);
    if (!isMobile) {
      expect(chip.textBottomDelta, `${chip.testId} value and label baselines should visually align`).toBeLessThanOrEqual(4);
    }
  }
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

async function expectMobileResultsHeaderStacksCleanly(page) {
  const viewport = page.viewportSize() || { width: 1440, height: 900 };
  if (viewport.width >= 768) return;
  const metrics = await page.evaluate(() => {
    const box = (testId) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom
      };
    };
    const row = box("results-metrics-row");
    const stats = box("public-stats-chips");
    const theme = box("theme-toggle");
    const language = box("language-selector");
    return {
      row,
      stats,
      theme,
      language,
      utilitySameRow: Boolean(theme && language) && Math.abs(theme.y - language.y) <= 2,
      statsBelowUtilities: Boolean(stats && theme && language) && stats.y >= Math.max(theme.bottom, language.bottom) + 4,
      rowContainsStats:
        Boolean(row && stats && theme && language) &&
        stats.x >= row.x - 1 &&
        stats.right <= row.right + 1 &&
        theme.height >= 44 &&
        language.height >= 44,
      rootWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    };
  });

  expect(metrics.utilitySameRow, `theme and language controls should share the compact header row: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.statsBelowUtilities, `stats should sit below compact controls on mobile: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.rowContainsStats, `metrics row should contain the stats chips: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.rootWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function expectMobileResultSuggestionsPushHeaderDown(page) {
  const viewport = page.viewportSize() || { width: 1440, height: 900 };
  if (viewport.width >= 768) return;
  const metrics = await page.evaluate(() => {
    const box = (testId) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom
      };
    };
    return {
      frame: box("search-box-frame"),
      suggestions: box("search-suggestions-panel"),
      brand: box("app-logo"),
      theme: box("theme-toggle"),
      language: box("language-selector"),
      rootWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    };
  });

  expect(metrics.frame).toBeTruthy();
  expect(metrics.suggestions).toBeTruthy();
  expect(metrics.brand).toBeTruthy();
  expect(metrics.theme).toBeTruthy();
  expect(metrics.language).toBeTruthy();
  expect(metrics.suggestions.y, `suggestions should attach below the compact search box: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(
    metrics.frame.bottom - 8
  );
  expect(metrics.brand.y, `mobile brand should be pushed below suggestions: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(
    metrics.suggestions.bottom + 4
  );
  expect(metrics.theme.y, `theme toggle should be pushed below suggestions: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(
    metrics.suggestions.bottom + 4
  );
  expect(metrics.language.y, `language toggle should be pushed below suggestions: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(
    metrics.suggestions.bottom + 4
  );
  expect(metrics.rootWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function expectScrollTopButtonWorks(page) {
  await expect(page.getByTestId("postings-scroll-top-button")).toHaveCount(0);
  await page.getByTestId("postings-page-scroll").hover();
  await page.mouse.wheel(0, 1300);
  await expect(page.getByTestId("postings-scroll-top-button")).toBeVisible({ timeout: 3000 });
  await expectMobileTapTarget(page, "postings-scroll-top-button");
  await expect
    .poll(() =>
      page.getByTestId("postings-scroll-top-button").evaluate((node) => window.getComputedStyle(node).backgroundColor)
    )
    .toBe("rgb(124, 58, 237)");
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
  await expectNoFilterChrome(page);
}

async function ensureFiltersVisible(page) {
  await expectNoFilterChrome(page);
}

async function expectNoFilterChrome(page) {
  await expect(page.getByTestId("filters-panel")).toHaveCount(0);
  await expect(page.getByTestId("postings-filter-toggle")).toHaveCount(0);
  await expect(page.getByTestId("postings-filter-clear")).toHaveCount(0);
  await expect(page.getByTestId("sort-control")).toHaveCount(0);
  await expect(page.getByTestId("ats-intelligence-panel")).toHaveCount(0);
}

async function expectPublicPaletteIsSoft(page) {
  const colors = await page.evaluate(() => {
    const nodes = [
      document.querySelector('[data-testid="search-shell"]'),
      document.querySelector('[data-testid="app-logo"]'),
      document.querySelector('[data-testid="postings-page-scroll"]'),
      document.querySelector('[data-testid="coverage-strip"]'),
      document.querySelector('[data-testid="posting-card"]'),
      document.querySelector('[data-testid="postings-filter-toggle"]')
    ].filter(Boolean);
    return nodes.flatMap((node) => {
      const style = window.getComputedStyle(node);
      const childColors = Array.from(node.querySelectorAll("*")).map((child) => window.getComputedStyle(child).color);
      return [style.color, style.backgroundColor, style.borderColor, ...childColors];
    });
  });

  expect(colors).toContain("rgb(255, 255, 255)");
  expect(colors).toContain("rgb(95, 54, 242)");
  expect(colors).toContain("rgb(124, 58, 237)");
  expect(colors).toContain("rgb(168, 85, 247)");
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
    job_slot_count: 3,
    configured_ats_count: 2,
    configured_enabled_ats_count: 2,
    visible_ats_count: 1,
    visible_company_count: 3,
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

async function installSearchRequestThrottleRoutes(page) {
  const calls = {
    postings: [],
    filterOptions: [],
    suggestions: []
  };

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/search/suggest")) {
      const search = url.searchParams.get("search") || "";
      calls.suggestions.push(search);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          count: search ? 1 : 0,
          items: search ? [{ type: "search", value: search, label: search }] : []
        })
      });
      return;
    }
    if (url.pathname.endsWith("/postings/filter-options")) {
      calls.filterOptions.push(url.searchParams.get("search") || "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          ats: [],
          industries: [],
          regions: [],
          countries: [],
          states: [],
          counties: [],
          sort_options: []
        })
      });
      return;
    }
    if (url.pathname.endsWith("/postings")) {
      calls.postings.push(url.searchParams.get("search") || "");
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
          source_facets: [],
          items: []
        })
      });
      return;
    }
    if (url.pathname.endsWith("/sync/status")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: "idle",
          running: false,
          posting_count: 0,
          job_slot_count: 0,
          configured_ats_count: 0,
          visible_ats_count: 0,
          visible_company_count: 0,
          ingestion_worker: { latest_status: "idle" }
        })
      });
      return;
    }
    if (url.pathname.endsWith("/search/popular")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, count: 0, items: [] })
      });
      return;
    }
    await route.continue();
  });

  return calls;
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

  test("public stat chips stay hidden on home and load ATS and company counts after search", async ({ page }) => {
    let statusRequests = 0;
    await page.route("**/sync/status**", async (route) => {
      statusRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: "idle",
          running: false,
          posting_count: 157355,
          job_slot_count: 157355,
          configured_ats_count: 62,
          configured_enabled_ats_count: 57,
          visible_ats_count: 18,
          visible_company_count: 8076,
          company_count: 40860,
          ingestion_worker: {
            latest_status: "idle"
          }
        })
      });
    });
    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/postings")) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: 6401,
              company_name: "QA Coverage Company",
              position_name: "Coverage Search Engineer",
              job_posting_url: "https://jobs.example.test/coverage-search-engineer",
              location: "Remote",
              posting_date: "2026-05-20",
              last_seen_epoch: 1778889600,
              ats: "greenhouse"
            }
          ],
          count: 17,
          visible_ats_count: 6,
          visible_company_count: 12,
          count_exact: true,
          has_more: false,
          next_offset: null
        })
      });
    });

    await openJobSlots(page);

    await expect.poll(() => statusRequests).toBeGreaterThan(0);
    await page.getByTestId("search-input").fill("status counts");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("result-count")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("public-stats-chips")).toBeVisible();
    await expect(page.getByTestId("result-count")).toHaveText(/17\s+job slots/i);
    await expect(page.getByTestId("public-stat-ats")).toHaveText(/6\s+ATS/i);
    await expect(page.getByTestId("public-stat-companies")).toHaveText(/12\s+companies/i);
    await expectStatsChipsAligned(page);
  });

  test("approximate capped search stats do not present incomplete facet totals as exact", async ({ page }) => {
    await page.route("**/sync/status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: "idle",
          running: false,
          posting_count: 157355,
          job_slot_count: 157355,
          configured_ats_count: 62,
          configured_enabled_ats_count: 57,
          visible_ats_count: 18,
          visible_company_count: 8076,
          ingestion_worker: { latest_status: "idle" }
        })
      });
    });
    await page.route("**/search/suggest**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, count: 0, items: [] })
      });
    });
    await page.route("**/search/popular**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, count: 0, items: [] })
      });
    });
    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/postings")) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: 6501,
              company_name: "Capped Result One",
              position_name: "Technical Support Engineer",
              job_posting_url: "https://jobs.example.test/capped-one",
              location: "Remote",
              posting_date: "2026-05-20",
              last_seen_epoch: 1778889600,
              ats: "greenhouse"
            },
            {
              id: 6502,
              company_name: "Capped Result Two",
              position_name: "Technical Support Analyst",
              job_posting_url: "https://jobs.example.test/capped-two",
              location: "London",
              posting_date: "2026-05-21",
              last_seen_epoch: 1778976000,
              ats: "lever"
            }
          ],
          count: 1000,
          count_exact: false,
          has_more: true,
          next_offset: 2,
          source_facets: [
            { value: "greenhouse", count: 700 },
            { value: "lever", count: 300 }
          ]
        })
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("Technical");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-count")).toContainText(/1,000\+\s+job slots/i);
    await expect(page.getByTestId("public-stat-ats")).toHaveCount(0);
    await expect(page.getByTestId("public-stat-companies")).toHaveCount(0);
    await expect(page.getByTestId("postings-pagination-status")).toContainText(/1,000\+/);
  });

  test("marks opened posting results with a visited link color", async ({ page }) => {
    const postingUrl = "https://jobs.example.test/visited-posting";
    await page.addInitScript(() => {
      window.__openjobslotsOpenedUrls = [];
      window.open = (url) => {
        window.__openjobslotsOpenedUrls.push(String(url || ""));
        return { closed: false, close() {} };
      };
    });
    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/postings")) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: 6421,
              company_name: "QA Visited Company",
              position_name: "Visited Result Engineer",
              job_posting_url: postingUrl,
              location: "Remote",
              posting_date: "2026-05-28",
              last_seen_epoch: 1779974400,
              ats: "greenhouse"
            }
          ],
          count: 1,
          visible_ats_count: 1,
          visible_company_count: 1,
          count_exact: true,
          has_more: false,
          next_offset: null
        })
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("visited result");
    await page.getByTestId("search-input").press("Enter");
    const targetCard = page.getByTestId("posting-card").filter({ hasText: "QA Visited Company" }).first();
    await expect(targetCard).toBeVisible({ timeout: 15_000 });

    await targetCard.getByTestId("posting-card-open").click();

    await expect.poll(() => page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      const items = raw ? JSON.parse(raw) : [];
      return items.includes("https://jobs.example.test/visited-posting");
    }, VISITED_POSTING_URLS_STORAGE_KEY)).toBe(true);
    await expect.poll(() => targetCard.getByTestId("posting-card-title").evaluate((node) => {
      return window.getComputedStyle(node).color;
    })).toBe(VISITED_POSTING_COLOR_RGB);
  });

  test("loads branded search-first page without raw backend errors", async ({ page }) => {
    const failedResponses = await openJobSlots(page);

    await expectSearchEngineVisualContract(page);
    await expectExampleSearchPlaceholderRotatesWithoutSuggestions(page);
    await expectPublicSearchChrome(page);
    await expectPublicPaletteIsSoft(page);
    await expectInitialIndexCountVisible(page);
    await expect(page.getByTestId("sort-control")).toHaveCount(0);

    for (const query of SEARCH_COMPATIBILITY_QUERIES) {
      await page.getByTestId("search-input").fill(query);
      await page.getByTestId("search-input").press("Enter");
      await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("sort-control")).toHaveCount(0);
      await expect(page.getByTestId("filters-panel")).toHaveCount(0);
      await expectResultCountPill(page);
      await expectNoRawErrors(page);
    }

    await page.getByTestId("search-input").fill("Technical Support Engineer");
    await page.getByTestId("search-input").press("Enter");
    const targetCard = page.getByTestId("posting-card").filter({ hasText: "Technical Support Engineer" }).first();
    await expect(targetCard).toBeVisible({ timeout: 15_000 });
    const targetCardText = await targetCard.innerText();
    expect(targetCardText.split(/\r?\n/)[0]).toMatch(/QA Yahoo Results/i);
    expect(targetCardText).toMatch(/Technical Support Engineer/i);
    await expect(page.getByText(/^Public search$/i)).toHaveCount(0);
    await expect(page.getByText(/^Open roles$/i)).toHaveCount(0);

    expect(failedResponses).toEqual([]);
  });

  test("language selector and day night switch update the public search chrome", async ({ page }) => {
    await openJobSlots(page);

    await expect(page.getByTestId("language-selector")).toBeVisible();
    await expect(page.getByTestId("theme-toggle")).toBeVisible();
    await expect(page.getByTestId("language-countryball-en")).toBeVisible();

    await page.getByTestId("language-selector").click();
    await expect(page.getByTestId("language-options")).toBeVisible();
    await expect(page.getByTestId("language-countryball-tr")).toBeVisible();
    await page.getByTestId("language-option-tr").click();
    await expect(page.getByTestId("language-selector")).toContainText("TR");
    await expect(page.getByTestId("results-header-title")).toHaveCount(0);
    await expect(page.getByTestId("search-input")).toHaveAttribute("placeholder", /^[A-Za-z][A-Za-z ]{1,}$/);

    const beforeTheme = await page.getByTestId("postings-page-scroll").evaluate((node) => window.getComputedStyle(node).backgroundColor);
    await page.getByTestId("theme-toggle").click();
    await expect(page.getByTestId("theme-toggle")).toContainText(/Night|Dark|Gece/i);
    const afterTheme = await page.getByTestId("postings-page-scroll").evaluate((node) => window.getComputedStyle(node).backgroundColor);
    expect(afterTheme).not.toBe(beforeTheme);

    await page.reload();
    await expect(page.getByTestId("language-selector")).toContainText("TR");
    await expect(page.getByTestId("search-input")).toHaveAttribute("placeholder", /^[A-Za-z][A-Za-z ]{1,}$/);
    await expect(page.getByTestId("theme-toggle")).toContainText(/Night|Dark|Gece/i);
    await expectNoHorizontalOverflow(page);
  });

  test("native browser and Cloudflare language hints open the localized shell", async ({ browser }) => {
    const portugueseContext = await browser.newContext({ locale: "pt-BR" });
    const portuguesePage = await portugueseContext.newPage();
    await portuguesePage.route("**/public/preferences**", (route) => route.abort());
    await portuguesePage.goto("/");
    await expect(portuguesePage.getByTestId("search-shell")).toBeVisible();
    await expect(portuguesePage.getByTestId("language-selector")).toContainText("BR");
    await expect(portuguesePage.getByText("Buscar vagas abertas")).toBeVisible();
    await portugueseContext.close();

    const cloudflareContext = await browser.newContext();
    const cloudflarePage = await cloudflareContext.newPage();
    await cloudflarePage.route("**/public/preferences**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          default_language: "tr",
          country: "TR",
          supported_languages: []
        })
      })
    );
    await cloudflarePage.goto("/");
    await expect(cloudflarePage.getByTestId("search-shell")).toBeVisible();
    await expect(cloudflarePage.getByTestId("language-selector")).toContainText("TR");
    await expect(cloudflarePage.getByText("A\u00e7\u0131k i\u015f ilanlar\u0131n\u0131 ara")).toBeVisible();
    await cloudflareContext.close();
  });

  test("SEO landing routes bootstrap localized language and search intent", async ({ page }) => {
    const expectedQuery = "uzaktan \u00e7al\u0131\u015fma ilanlar\u0131";
    let requestedSearch = "";

    await page.route("**/postings?**", async (route) => {
      const requestUrl = new URL(route.request().url());
      requestedSearch = requestUrl.searchParams.get("search") || "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          count: 0,
          count_exact: true,
          source_facets: [],
          limit: 500,
          offset: 0,
          filters: {
            search: requestedSearch,
            sort_by: "posted_date",
            freshness_days: "all"
          },
          has_more: false,
          next_offset: null
        })
      });
    });

    await page.goto("/tr/uzaktan-calisma-ilanlari");

    await expect(page.getByTestId("language-selector")).toContainText("TR");
    await expect(page.getByTestId("search-input")).toHaveValue(expectedQuery);
    await expect.poll(() => requestedSearch).toBe(expectedQuery);
  });

  test("home exposes crawlable SEO landing links for search engines", async ({ page }) => {
    await openJobSlots(page);

    await expect(page.getByTestId("seo-landing-links")).toBeVisible();
    const englishPopularOrRouteLink = page.locator('a[href="/en/remote-job-openings"], a[href="/en?q=remote%20jobs%20US"]').first();
    await expect(englishPopularOrRouteLink).toBeVisible();
    await expect(englishPopularOrRouteLink).toHaveAttribute("href", /\/en(?:\/remote-job-openings|\?q=remote%20jobs%20US)/);

    await page.getByTestId("language-selector").click();
    await page.getByTestId("language-option-tr").click();

    const turkishPopularOrRouteLink = page.locator('a[href="/tr/uzaktan-calisma-ilanlari"], a[href="/tr?q=remote%20Turkiye"]').first();
    await expect(turkishPopularOrRouteLink).toBeVisible();
    await expect(turkishPopularOrRouteLink).toHaveAttribute("href", /\/tr(?:\/uzaktan-calisma-ilanlari|\?q=remote%20Turkiye)/);
  });

  test("popular search labels follow selected language while keeping result-safe query links", async ({ page }) => {
    await openJobSlots(page);

    await page.getByTestId("language-selector").click();
    await page.getByTestId("language-option-es").click();

    await expect(page.getByTestId("language-selector")).toContainText("ES");
    const spanishPopularLink = page.locator('a[href="/es?q=remote%20Spain"]').first();
    await expect(spanishPopularLink).toBeVisible({ timeout: 15_000 });
    await expect(spanishPopularLink).toContainText("Trabajos remotos en Espa\u00f1a");
    await expect(page.getByTestId("seo-landing-links")).toContainText("Empleo en Madrid");
    await expect(page.getByTestId("seo-landing-links")).toContainText("Ingeniero de software en Espa\u00f1a");
    await expect(page.getByTestId("seo-landing-links")).not.toContainText(/Empleos en Espa\u00f1a|Empleos de ingeniero en Espa\u00f1a|Software engineer en Espa\u00f1a|Data analyst en Espa\u00f1a|Product manager en Espa\u00f1a|France Jobs|Remote France/);
  });

  test("popular search links open results without autocomplete suggestions", async ({ page }) => {
    const suggestionCalls = [];
    page.on("request", (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith("/search/suggest")) {
        suggestionCalls.push(`${requestUrl.pathname}${requestUrl.search}`);
      }
    });

    await openJobSlots(page);
    const popularLink = page.locator('a[href="/en?q=remote%20jobs%20US"]').first();
    await expect(popularLink).toBeVisible();
    await expect(popularLink).toContainText(/Remote jobs US/i);
    await Promise.all([
      page.waitForURL(/\/en\?q=remote%20jobs%20US/),
      popularLink.click()
    ]);
    await expect(page.getByTestId("search-input")).toHaveValue("remote jobs US");
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);
    await page.waitForTimeout(700);
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);
    expect(suggestionCalls).toEqual([]);
  });

  test("public localization covers home, results, suggestions, footer, and release notes in every language", async ({ page }) => {
    test.setTimeout(120_000);
    const viewport = page.viewportSize() || { width: 1440, height: 900 };
    test.skip(viewport.width < 768, "desktop release notes localization is covered by the desktop project");

    const localizedExpectations = {
      en: {
        code: "EN",
        hero: "Search open job slots",
        lead: "Find fresh openings across public ATS job boards.",
        version: `Public v${APP_VERSION}`,
        credit: "Deployed and developed by",
        updating: "Updating visible results...",
        suggestionHint: "Title",
        slots: "job slots",
        companies: "companies",
        releaseTitle: "Release notes",
        releaseClose: "Close",
        releaseVersion: "Version 2.1.0",
        releaseHeading: "ATS pipeline and runtime safety",
        releaseSummary: /Strengthens source-module dispatch and parser evidence lanes/i
      },
      tr: {
        code: "TR",
        hero: "Açık iş ilanlarını ara",
        lead: "Herkese açık ATS iş panolarındaki güncel ilanları bul.",
        version: `Genel v${APP_VERSION}`,
        credit: "Yayına alan ve geliştiren",
        updating: "Görünen sonuçlar güncelleniyor...",
        suggestionHint: "Ünvan",
        slots: "iş ilanı",
        companies: "şirket",
        releaseTitle: "Sürüm notları",
        releaseClose: "Kapat",
        releaseVersion: "Sürüm 2.1.0",
        releaseHeading: "ATS pipeline ve runtime güvenliği",
        releaseSummary: /Kaynak modülü yönlendirmesini ve parser kanıt hatlarını/i
      },
      de: {
        code: "DE",
        hero: "Offene Jobslots suchen",
        lead: "Finde aktuelle Stellen auf öffentlichen ATS-Jobbörsen.",
        version: `Öffentlich v${APP_VERSION}`,
        credit: "Bereitgestellt und entwickelt von",
        updating: "Sichtbare Ergebnisse werden aktualisiert...",
        suggestionHint: "Titel",
        slots: "Jobslots",
        companies: "Unternehmen",
        releaseTitle: "Versionshinweise",
        releaseClose: "Schließen",
        releaseVersion: "Version 2.1.0",
        releaseHeading: "ATS-Pipeline und Laufzeitsicherheit",
        releaseSummary: /Stärkt Source-Modul-Dispatch und Parser-Evidenzspuren/i
      },
      fr: {
        code: "FR",
        hero: "Rechercher des postes ouverts",
        lead: "Trouvez des offres récentes sur les jobboards ATS publics.",
        version: `Recherche v${APP_VERSION}`,
        credit: "Déployé et développé par",
        updating: "Mise à jour des résultats visibles...",
        suggestionHint: "Titre",
        slots: "offres",
        companies: "entreprises",
        releaseTitle: "Notes de version",
        releaseClose: "Fermer",
        releaseVersion: "Version 2.1.0",
        releaseHeading: "Pipeline ATS et sécurité d'exécution",
        releaseSummary: /Renforce la répartition par modules source/i
      },
      es: {
        code: "ES",
        hero: "Buscar puestos abiertos",
        lead: "Encuentra ofertas recientes en bolsas ATS públicas.",
        version: `Público v${APP_VERSION}`,
        credit: "Desplegado y desarrollado por",
        updating: "Actualizando resultados visibles...",
        suggestionHint: "Título",
        slots: "puestos",
        companies: "empresas",
        releaseTitle: "Notas de la versión",
        releaseClose: "Cerrar",
        releaseVersion: "Versión 2.1.0",
        releaseHeading: "Pipeline ATS y seguridad en ejecución",
        releaseSummary: /Refuerza el despacho por módulos de fuente/i
      }
    };

    await page.route("**/search/suggest**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ type: "title", value: "Product Manager", label: "Product Manager", count: 5 }],
          count: 1
        })
      });
    });

    for (const [languageCode, expected] of Object.entries(localizedExpectations)) {
      await page.goto("/");
      await expect(page.getByTestId("app-logo")).toContainText("openjobslots");
      if (languageCode !== "en") {
        await page.getByTestId("language-selector").click();
        await page.getByTestId(`language-option-${languageCode}`).click();
      }
      await expect(page.getByTestId("language-selector")).toContainText(expected.code);
      await expect(page.getByText(expected.hero)).toBeVisible();
      await expect(page.getByText(expected.lead)).toBeVisible();
      await expect(page.getByTestId("public-version-label")).toHaveText(expected.version);
      await expect(page.getByTestId("search-credit-text")).toContainText(expected.credit);

      await page.getByTestId("public-version-button").click();
      await expect(page.getByTestId("release-notes-modal")).toBeVisible();
      await expect(page.getByTestId("release-notes-title")).toHaveText(expected.releaseTitle);
      await expect(page.getByTestId("release-notes-close")).toContainText(expected.releaseClose);
      await expect(page.getByText(expected.releaseVersion)).toBeVisible();
      await expect(page.getByText(expected.releaseHeading)).toBeVisible();
      await expect(page.getByText(expected.releaseSummary)).toBeVisible();
      await expectReleaseNotesAreVersionSpecific(page, languageCode);
      await page.getByTestId("release-notes-close").click();
      await expect(page.getByTestId("release-notes-modal")).toHaveCount(0);

      await page.getByTestId("search-input").fill("Product manager");
      await expect(page.getByTestId("search-suggestions-panel")).toBeVisible();
      await expect(page.getByTestId("search-suggestion-0")).toContainText(expected.suggestionHint);

      await page.route("**/postings?**", async (route) => {
        await page.waitForTimeout(500);
        await route.continue();
      }, { times: 1 });
      await page.getByTestId("search-input").press("Enter");
      await expectRefreshIndicatorOrCompletedSearch(page, expected.updating, expected.slots);
      await expect(page.getByTestId("result-count")).toContainText(expected.slots, { timeout: 15_000 });
      await expect(page.getByTestId("public-stat-companies")).toContainText(expected.companies);

      if (languageCode !== "en") {
        const visibleText = await page.getByTestId("search-shell").innerText();
        expect(visibleText, `${languageCode} should not show the English hero`).not.toContain("Search open job slots");
        expect(visibleText, `${languageCode} should not show the English footer credit`).not.toContain("Deployed and developed by");
        expect(visibleText, `${languageCode} should not show the English release title`).not.toContain("Release notes");
        expect(visibleText, `${languageCode} should not show the English updating indicator`).not.toContain("Updating visible results...");
      }
    }
  });

  test("expanded language packs localize the public shell and release notes", async ({ page }) => {
    test.setTimeout(120_000);
    const viewport = page.viewportSize() || { width: 1440, height: 900 };
    test.skip(viewport.width < 768, "desktop language menu coverage is covered by the desktop project");

    const expandedExpectations = {
      "pt-BR": {
        code: "BR",
        hero: "Buscar vagas abertas",
        lead: "Encontre vagas recentes em quadros ATS públicos.",
        placeholder: "Busque cargo, empresa, local ou país",
        popular: "Buscas populares",
        releaseTitle: "Notas da versão",
        releaseHeading: "Atualização da busca pública"
      },
      "pt-PT": {
        code: "PT",
        hero: "Pesquisar vagas abertas",
        lead: "Encontra vagas recentes em quadros ATS públicos.",
        placeholder: "Pesquisa cargo, empresa, local ou país",
        popular: "Pesquisas populares",
        releaseTitle: "Notas da versão",
        releaseHeading: "Atualização da pesquisa pública"
      },
      it: {
        code: "IT",
        hero: "Cerca posizioni aperte",
        lead: "Trova offerte recenti nei job board ATS pubblici.",
        placeholder: "Cerca ruolo, azienda, località o paese",
        popular: "Ricerche popolari",
        releaseTitle: "Note di rilascio",
        releaseHeading: "Aggiornamento della ricerca pubblica"
      },
      nl: {
        code: "NL",
        hero: "Zoek openstaande vacatures",
        lead: "Vind recente vacatures op publieke ATS-jobboards.",
        placeholder: "Zoek titel, bedrijf, plaats of land",
        popular: "Populaire zoekopdrachten",
        releaseTitle: "Release-opmerkingen",
        releaseHeading: "Publieke zoekupdate"
      },
      pl: {
        code: "PL",
        hero: "Szukaj otwartych ofert pracy",
        lead: "Znajdź świeże oferty z publicznych tablic ATS.",
        placeholder: "Szukaj stanowiska, firmy, lokalizacji lub kraju",
        popular: "Popularne wyszukiwania",
        releaseTitle: "Informacje o wersji",
        releaseHeading: "Aktualizacja wyszukiwania publicznego"
      },
      ja: {
        code: "JA",
        hero: "公開求人を検索",
        lead: "公開ATS求人ボードから新しい求人を見つけます。",
        placeholder: "職種、会社、地域、国で検索",
        popular: "人気の検索",
        releaseTitle: "リリースノート",
        releaseHeading: "公開検索の更新"
      },
      ko: {
        code: "KO",
        hero: "공개 채용 공고 검색",
        lead: "공개 ATS 채용 보드의 최신 공고를 찾습니다.",
        placeholder: "직무, 회사, 지역 또는 국가 검색",
        popular: "인기 검색어",
        releaseTitle: "릴리스 노트",
        releaseHeading: "공개 검색 업데이트"
      },
      "zh-CN": {
        code: "CN",
        hero: "搜索开放职位",
        lead: "从公开 ATS 招聘板查找最新职位。",
        placeholder: "搜索职位、公司、地点或国家",
        popular: "热门搜索",
        releaseTitle: "版本说明",
        releaseHeading: "公开搜索更新"
      },
      hi: {
        code: "HI",
        hero: "खुली नौकरियां खोजें",
        lead: "सार्वजनिक ATS job boards से ताज़ा openings खोजें।",
        placeholder: "पद, कंपनी, स्थान या देश खोजें",
        popular: "लोकप्रिय खोजें",
        releaseTitle: "रिलीज नोट्स",
        releaseHeading: "Public search update"
      },
      ar: {
        code: "AR",
        hero: "ابحث عن الوظائف المفتوحة",
        lead: "اعثر على وظائف حديثة من لوحات ATS العامة.",
        placeholder: "ابحث عن المسمى أو الشركة أو الموقع أو الدولة",
        popular: "عمليات بحث شائعة",
        releaseTitle: "ملاحظات الإصدار",
        releaseHeading: "تحديث البحث العام"
      },
      id: {
        code: "ID",
        hero: "Cari lowongan terbuka",
        lead: "Temukan lowongan terbaru dari papan ATS publik.",
        placeholder: "Cari jabatan, perusahaan, lokasi, atau negara",
        popular: "Pencarian populer",
        releaseTitle: "Catatan rilis",
        releaseHeading: "Pembaruan pencarian publik"
      },
      sv: {
        code: "SV",
        hero: "Sök öppna jobb",
        lead: "Hitta färska jobb från publika ATS-jobbtavlor.",
        placeholder: "Sök titel, företag, plats eller land",
        popular: "Populära sökningar",
        releaseTitle: "Versionsnotiser",
        releaseHeading: "Uppdatering av publik sökning"
      },
      da: {
        code: "DA",
        hero: "Søg ledige job",
        lead: "Find friske opslag fra offentlige ATS-jobboards.",
        placeholder: "Søg titel, virksomhed, sted eller land",
        popular: "Populære søgninger",
        releaseTitle: "Versionsnoter",
        releaseHeading: "Opdatering af offentlig søgning"
      },
      no: {
        code: "NO",
        hero: "Søk åpne jobber",
        lead: "Finn ferske stillinger fra offentlige ATS-jobbtavler.",
        placeholder: "Søk tittel, selskap, sted eller land",
        popular: "Populære søk",
        releaseTitle: "Versjonsnotater",
        releaseHeading: "Oppdatering av offentlig søk"
      },
      fi: {
        code: "FI",
        hero: "Etsi avoimia työpaikkoja",
        lead: "Löydä tuoreet ilmoitukset julkisilta ATS-työpaikkasivuilta.",
        placeholder: "Etsi nimike, yritys, sijainti tai maa",
        popular: "Suositut haut",
        releaseTitle: "Julkaisutiedot",
        releaseHeading: "Julkisen haun päivitys"
      }
    };

    for (const [languageCode, expected] of Object.entries(expandedExpectations)) {
      await page.goto("/");
      await page.getByTestId("language-selector").click();
      const option = page.getByTestId(`language-option-${languageCode}`);
      await option.scrollIntoViewIfNeeded();
      await option.click();

      await expect(page.getByTestId("language-selector")).toContainText(expected.code);
      await expect(page.getByText(expected.hero)).toBeVisible();
      await expect(page.getByText(expected.lead)).toBeVisible();
      expect(await page.getByTestId("search-input").getAttribute("aria-label")).not.toBe("Search openings");
      await expect(page.getByText(expected.popular)).toBeVisible();
      await expect(page.getByTestId("public-version-label")).toContainText(APP_VERSION);

      await page.getByTestId("public-version-button").click();
      await expect(page.getByTestId("release-notes-modal")).toBeVisible();
      await expect(page.getByTestId("release-notes-title")).toHaveText(expected.releaseTitle);
      await expectReleaseNotesAreVersionSpecific(page, languageCode);
      await page.getByTestId("release-notes-close").click();
      await expect(page.getByTestId("release-notes-modal")).toHaveCount(0);

      const visibleText = await page.getByTestId("search-shell").innerText();
      expect(visibleText, `${languageCode} should not show the English hero`).not.toContain("Search open job slots");
      expect(visibleText, `${languageCode} should not show the English footer credit`).not.toContain("Deployed and developed by");
      expect(visibleText, `${languageCode} should not show the English release title`).not.toContain("Release notes");
    }
  });

  test("mobile language selector supports every public language without viewport overflow", async ({ page }) => {
    test.setTimeout(120_000);
    const viewport = page.viewportSize() || { width: 1440, height: 900 };
    test.skip(viewport.width >= 768, "mobile language selector coverage is covered by the mobile project");

    const languages = [
      ["en", "EN"],
      ["tr", "TR"],
      ["de", "DE"],
      ["fr", "FR"],
      ["es", "ES"],
      ["pt-BR", "BR"],
      ["pt-PT", "PT"],
      ["it", "IT"],
      ["nl", "NL"],
      ["pl", "PL"],
      ["ja", "JA"],
      ["ko", "KO"],
      ["zh-CN", "CN"],
      ["hi", "HI"],
      ["ar", "AR"],
      ["id", "ID"],
      ["sv", "SV"],
      ["da", "DA"],
      ["no", "NO"],
      ["fi", "FI"]
    ];

    await installSearchRequestThrottleRoutes(page);
    await openJobSlots(page);

    for (const [languageCode, shortCode] of languages) {
      await page.getByTestId("language-selector").click();
      const languageMenu = page.getByTestId("language-options");
      await expect(languageMenu).toBeVisible();
      const menuBox = await languageMenu.boundingBox();
      expect(menuBox.x, `${languageCode} menu should not open off-screen: ${JSON.stringify(menuBox)}`).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width, `${languageCode} menu should fit viewport: ${JSON.stringify(menuBox)}`).toBeLessThanOrEqual(
        viewport.width + 1
      );

      const option = page.getByTestId(`language-option-${languageCode}`);
      await option.scrollIntoViewIfNeeded();
      await expectMobileTapTarget(page, `language-option-${languageCode}`);
      await option.click();

      await expect(page.getByTestId("language-selector")).toContainText(shortCode);
      await expect(page.getByTestId("language-options")).toHaveCount(0);
      await expect(page.getByTestId("search-input")).toBeVisible();
      await expect(page.getByTestId("seo-landing-links")).toBeVisible();
      await expect(page.getByTestId("public-version-label")).toContainText(APP_VERSION);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("dark mode paints the top viewport strip with the public dark background", async ({ page }) => {
    await openJobSlots(page);
    await enableDarkMode(page);

    const backgrounds = await page.evaluate(() => {
      const parseRgb = (value) => {
        const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/i);
        if (!match) return null;
        return {
          r: Number(match[1]),
          g: Number(match[2]),
          b: Number(match[3]),
          a: match[4] === undefined ? 1 : Number(match[4])
        };
      };
      const nearestSolidBackground = (node) => {
        let current = node;
        while (current) {
          const style = window.getComputedStyle(current);
          const background = parseRgb(style.backgroundColor);
          if (background && background.a > 0.01) return style.backgroundColor;
          current = current.parentElement;
        }
        return window.getComputedStyle(document.body).backgroundColor;
      };
      const topNode = document.elementFromPoint(Math.floor(window.innerWidth / 2), 2);
      const scroll = document.querySelector('[data-testid="postings-page-scroll"]');
      return {
        top: nearestSolidBackground(topNode),
        scroll: window.getComputedStyle(scroll).backgroundColor,
        body: window.getComputedStyle(document.body).backgroundColor
      };
    });

    expect(backgrounds.top).toBe(backgrounds.scroll);
    expect(backgrounds.body).toBe(backgrounds.scroll);
  });

  test("localized desktop header controls stay aligned in dark mode", async ({ page }) => {
    const viewport = page.viewportSize() || { width: 1440, height: 900 };
    test.skip(viewport.width < 768, "desktop language header alignment is covered by the desktop project");

    await openJobSlots(page);
    await page.getByTestId("theme-toggle").click();

    for (const languageCode of ["fr", "es", "de"]) {
      await page.getByTestId("language-selector").click();
      await page.getByTestId(`language-option-${languageCode}`).click();
      await page.waitForTimeout(250);

      const headerState = await page.evaluate(() => {
        const logo = document.querySelector('[data-testid="app-logo"]')?.getBoundingClientRect();
        const theme = document.querySelector('[data-testid="theme-toggle"]')?.getBoundingClientRect();
        const language = document.querySelector('[data-testid="language-selector"]')?.getBoundingClientRect();
        return {
          logoTop: logo?.top || 0,
          themeTop: theme?.top || 0,
          languageTop: language?.top || 0
        };
      });

      expect(
        Math.abs(headerState.themeTop - headerState.languageTop),
        `${languageCode} utility controls should stay aligned`
      ).toBeLessThan(32);
      expect(
        Math.abs(headerState.logoTop - headerState.themeTop),
        `${languageCode} logo and utility controls should stay in one header band`
      ).toBeLessThan(48);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("dark mode keeps public header text readable across languages", async ({ page }) => {
    await openJobSlots(page);
    await page.getByTestId("theme-toggle").click();

    for (const languageCode of ["en", "tr", "de", "fr", "es"]) {
      if (languageCode !== "en") {
        await page.getByTestId("language-selector").click();
        await page.getByTestId(`language-option-${languageCode}`).click();
      }
      await page.waitForTimeout(250);

      const colorState = await page.evaluate(() => {
        const parseRgba = (value) => {
          const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/i);
          if (!match) return null;
          return {
            r: Number(match[1]),
            g: Number(match[2]),
            b: Number(match[3]),
            a: match[4] === undefined ? 1 : Number(match[4])
          };
        };
        const perceivedLightness = (value) => {
          const { r, g, b } = parseRgba(value) || { r: 0, g: 0, b: 0 };
          return Math.round((r * 299 + g * 587 + b * 114) / 1000);
        };
        const relativeLuminance = ({ r, g, b }) => {
          const toLinear = (channel) => {
            const value = channel / 255;
            return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
        };
        const contrastRatio = (foreground, background) => {
          const fg = relativeLuminance(foreground);
          const bg = relativeLuminance(background);
          const lighter = Math.max(fg, bg);
          const darker = Math.min(fg, bg);
          return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
        };
        const nearestSolidBackground = (node) => {
          let current = node;
          while (current) {
            const background = parseRgba(window.getComputedStyle(current).backgroundColor);
            if (background && background.a > 0.01) return background;
            current = current.parentElement;
          }
          return parseRgba(window.getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
        };
        const read = (selector) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const style = window.getComputedStyle(node);
          const foreground = parseRgba(style.color) || { r: 0, g: 0, b: 0, a: 1 };
          const background = nearestSolidBackground(node);
          return {
            color: style.color,
            background: `rgb(${background.r}, ${background.g}, ${background.b})`,
            contrast: contrastRatio(foreground, background),
            lightness: perceivedLightness(style.color)
          };
        };
        const wordmark = Array.from(document.querySelectorAll('[data-testid="brand-wordmark"] *')).map((node) => {
          const style = window.getComputedStyle(node);
          const foreground = parseRgba(style.color) || { r: 0, g: 0, b: 0, a: 1 };
          const background = nearestSolidBackground(node);
          return {
            text: node.textContent || "",
            color: style.color,
            background: `rgb(${background.r}, ${background.g}, ${background.b})`,
            contrast: contrastRatio(foreground, background),
            lightness: perceivedLightness(style.color)
          };
        });
        return {
          wordmark,
          versionLabel: read('[data-testid="public-version-label"]'),
          creditText: read('[data-testid="search-credit-text"]'),
          creditLink: read('[data-testid="search-credit-link"]'),
          resultsTitle: read('[data-testid="results-header-title"]'),
          searchLead: read('[data-testid="app-logo"] + *'),
          initialTitle: read('[data-testid="postings-initial-state"] *')
        };
      });

      expect(
        colorState.wordmark.every((item) => item.lightness >= 145),
        `${languageCode} dark logo text should avoid low-contrast muted colors: ${JSON.stringify(colorState.wordmark)}`
      ).toBeTruthy();
      expect(
        colorState.wordmark.every((item) => item.contrast >= 4.5),
        `${languageCode} dark logo text should pass contrast: ${JSON.stringify(colorState.wordmark)}`
      ).toBeTruthy();
      for (const [label, state] of [
        ["version label", colorState.versionLabel],
        ["credit text", colorState.creditText],
        ["credit link", colorState.creditLink],
        ["results heading", colorState.resultsTitle],
        ["lead copy", colorState.searchLead],
        ["empty state heading", colorState.initialTitle]
      ]) {
        if (!state) continue;
        expect(
          state.contrast,
          `${languageCode} dark ${label} should pass contrast: ${JSON.stringify(state)}`
        ).toBeGreaterThanOrEqual(4.5);
      }
      if (colorState.resultsTitle) {
        expect(colorState.resultsTitle.lightness, `${languageCode} dark results heading should remain readable`).toBeGreaterThanOrEqual(210);
      }
      if (colorState.searchLead) {
        expect(colorState.searchLead.lightness, `${languageCode} dark lead copy should remain readable`).toBeGreaterThanOrEqual(165);
      }
      if (colorState.initialTitle) {
        expect(colorState.initialTitle.lightness, `${languageCode} dark empty heading should remain readable`).toBeGreaterThanOrEqual(210);
      }
      await expectNoHorizontalOverflow(page);
    }
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

  test("mobile shell keeps the search surface filter-free without horizontal overflow", async ({ page }) => {
    const viewport = page.viewportSize() || { width: 1440, height: 900 };
    test.skip(viewport.width >= 768, "mobile shell behavior is covered by the mobile project");
    await page.route("**/search/suggest**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            { label: "Product Manager", value: "Product Manager", type: "title" },
            { label: "Product Designer II", value: "Product Designer II", type: "title" },
            { label: "Production Supervisor", value: "Production Supervisor", type: "title" }
          ]
        })
      });
    });

    await openJobSlots(page);
    await expect(page.getByTestId("filters-panel")).toHaveCount(0);
    await expect(page.getByText(/Enter to search|Esc to clear/i)).toHaveCount(0);
    await expect(page.getByTestId("seo-landing-links")).toBeVisible();
    const popularLinks = await page.getByTestId("seo-landing-links").boundingBox();
    expect(popularLinks.x, `popular links should not open off-screen: ${JSON.stringify(popularLinks)}`).toBeGreaterThanOrEqual(0);
    expect(popularLinks.x + popularLinks.width, `popular links should fit viewport: ${JSON.stringify(popularLinks)}`).toBeLessThanOrEqual(
      viewport.width + 1
    );
    const searchBox = await page.getByTestId("search-input").boundingBox();
    expect(searchBox.y).toBeLessThan(viewport.height * 0.42);

    await page.getByTestId("language-selector").click();
    await expect(page.getByTestId("language-options")).toBeVisible();
    const languageMenu = await page.getByTestId("language-options").boundingBox();
    expect(languageMenu.x, `language menu should not open off-screen: ${JSON.stringify(languageMenu)}`).toBeGreaterThanOrEqual(0);
    expect(languageMenu.x + languageMenu.width, `language menu should fit viewport: ${JSON.stringify(languageMenu)}`).toBeLessThanOrEqual(
      viewport.width + 1
    );
    await page.getByTestId("language-option-en").click();
    await expect(page.getByTestId("language-options")).toHaveCount(0);

    await page.getByTestId("public-version-button").click();
    await expect(page.getByTestId("release-notes-modal")).toBeVisible();
    const releaseModal = await page.getByTestId("release-notes-modal").boundingBox();
    expect(releaseModal.y, `release notes should start inside the mobile viewport: ${JSON.stringify(releaseModal)}`).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId("release-notes-scroll")).toBeVisible();
    await page.getByTestId("release-notes-close").click();
    await expect(page.getByTestId("release-notes-modal")).toHaveCount(0);

    await page.getByTestId("search-input").fill("remote jobs");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("postings-filter-toggle")).toHaveCount(0);
    await expect(page.getByTestId("filters-panel")).toHaveCount(0);
    await expectMobileResultsHeaderStacksCleanly(page);
    await page.getByTestId("search-input").fill("Produ");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await expect(page.getByTestId("public-stats-chips")).toHaveCount(0);
    await expectMobileResultSuggestionsPushHeaderDown(page);
    await expectNoHorizontalOverflow(page);
  });

  test("job slot and ATS/company chips reflect the current result set without filters", async ({ page }) => {
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
    await page.route("**/sync/status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          running: false,
          status: "idle",
          job_slot_count: 255272,
          posting_count: 255272,
          configured_ats_count: 62,
          visible_company_count: 12186,
          company_count: 40860,
          ingestion_worker: {
            latest_status: "idle"
          }
        })
      });
    });
    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/postings")) {
        await route.continue();
        return;
      }
      requestedPostings.push({
        search: url.searchParams.get("search") || ""
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [postingItem],
          count: 42,
          count_exact: true,
          visible_ats_count: 4,
          visible_company_count: 11,
          limit: Number(url.searchParams.get("limit") || 80),
          offset: Number(url.searchParams.get("offset") || 0),
          has_more: false,
          next_offset: null,
          filters: {
            search: url.searchParams.get("search") || ""
          }
        })
      });
    });
    await page.route("**/search/suggest**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            { label: "Data Analyst", value: "Data Analyst", type: "title" },
            { label: "Data Analyst in Toronto", value: "Data Analyst in Toronto", type: "title" }
          ]
        })
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("dynamic");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("result-count")).toContainText("42 job slots");
    await expect(page.getByTestId("public-stat-ats")).toContainText("4 ATS");
    await expect(page.getByTestId("public-stat-companies")).toContainText("11 companies");
    await expectStatsChipsAligned(page);
    await page.getByTestId("search-input").fill("Data Analyst in Toro");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await expect(page.getByTestId("public-stats-chips")).toHaveCount(0);
    await expect(page.getByTestId("sort-control")).toHaveCount(0);
    await expect(page.getByTestId("filters-panel")).toHaveCount(0);
    await expect
      .poll(() => requestedPostings.some((request) => request.search === "dynamic"))
      .toBeTruthy();
    await expectNoRawErrors(page);
  });

  test("public query URLs open directly into result mode for SEO search actions", async ({ page }) => {
    const query = "Technical Support Engineer";
    const postingItem = {
      id: 7801,
      company_name: "QA Direct Query",
      position_name: "Technical Support Engineer",
      job_posting_url: "https://jobs.example.test/direct-query",
      location: "Remote - United States",
      posting_date: "2026-05-31",
      last_seen_epoch: 1780262400,
      ats: "ashby"
    };
    const requestedPostings = [];
    const requestedFilterOptions = [];

    await page.route("**/sync/status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          running: false,
          status: "idle",
          job_slot_count: 331463,
          posting_count: 331463,
          configured_ats_count: 62,
          visible_company_count: 16600,
          company_count: 40860,
          ingestion_worker: {
            latest_status: "idle"
          }
        })
      });
    });
    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/postings/filter-options")) {
        requestedFilterOptions.push(url.searchParams.get("search") || "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ats: [{ value: "ashby", label: "Ashby", enabled: true, count: 1 }],
            industries: [],
            regions: [],
            countries: [],
            states: [],
            counties: [],
            sort_options: []
          })
        });
        return;
      }
      if (!url.pathname.endsWith("/postings")) {
        await route.continue();
        return;
      }
      requestedPostings.push(url.searchParams.get("search") || "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [postingItem],
          count: 1,
          count_exact: true,
          limit: Number(url.searchParams.get("limit") || 80),
          offset: Number(url.searchParams.get("offset") || 0),
          source_facets: [{ value: "ashby", label: "Ashby", count: 1 }],
          filters: {
            search: url.searchParams.get("search") || "",
            sort_by: "posted_date",
            freshness_days: "all"
          },
          has_more: false,
          next_offset: null
        })
      });
    });

    await page.goto(`/en?q=${encodeURIComponent(query)}`);
    await expect(page.getByTestId("app-logo")).toContainText("openjobslots", { timeout: 15_000 });
    await expect(page.getByTestId("search-input")).toHaveValue(query, { timeout: 5000 });
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("posting-card").first()).toContainText("Technical Support Engineer");
    await expect.poll(() => requestedPostings).toEqual([query]);
    await expect.poll(() => requestedFilterOptions).toEqual([query]);
    await expect(page.getByTestId("public-footer-meta")).toHaveCount(0);
    await expectNoRawErrors(page);
  });

  test("submitted searches clear stale cards, hide result footer, and request newest-first ordering", async ({ page }) => {
    const requestedPostings = [];
    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/postings")) {
        await route.continue();
        return;
      }
      const search = url.searchParams.get("search") || "";
      if (search !== "stale-probe" && search !== "fresh-probe") {
        await route.continue();
        return;
      }
      requestedPostings.push({
        search,
        sortBy: url.searchParams.get("sort_by") || ""
      });
      if (search === "fresh-probe") {
        await page.waitForTimeout(650);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: search === "stale-probe" ? 8301 : 8302,
              company_name: search === "stale-probe" ? "Old Nordic Card" : "Fresh Result Company",
              position_name: search === "stale-probe" ? "Unrelated regional role" : "Fresh Probe Engineer",
              job_posting_url: `https://jobs.example.com/${search}`,
              location: search === "stale-probe" ? "Oslo, Norway" : "Remote",
              posting_date: search === "stale-probe" ? "2026-05-01" : "2026-05-27",
              ats: "greenhouse"
            }
          ],
          count: 1,
          count_exact: true,
          source_facets: [{ value: "greenhouse", label: "Greenhouse", count: 1 }],
          limit: Number(url.searchParams.get("limit") || 80),
          offset: Number(url.searchParams.get("offset") || 0),
          has_more: false,
          next_offset: null,
          filters: {
            search,
            sort_by: url.searchParams.get("sort_by") || "relevance"
          }
        })
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("stale-probe");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("posting-card").first()).toContainText("Old Nordic Card");

    await page.getByTestId("search-input").fill("fresh-probe");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByText("Old Nordic Card")).toHaveCount(0);
    await expect(page.getByTestId("public-footer-meta")).toHaveCount(0);
    await expect(page.getByTestId("posting-card").first()).toContainText("Fresh Result Company", { timeout: 5000 });
    await expect
      .poll(() => requestedPostings.some((request) => request.search === "fresh-probe" && request.sortBy === "posted_date"))
      .toBeTruthy();
    await expectNoRawErrors(page);
  });

  test("submitted searches do not show no-results while the response is pending", async ({ page }) => {
    let releasePendingSearchResponse = null;
    const pendingSearchResponse = new Promise((resolve) => {
      releasePendingSearchResponse = resolve;
    });
    await page.route("**/postings**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/postings")) {
        await route.continue();
        return;
      }
      const search = url.searchParams.get("search") || "";
      if (search === "pending-probe") {
        await pendingSearchResponse;
      }
      const items = search === "pending-probe"
        ? [
            {
              id: 8401,
              company_name: "Pending Response Company",
              position_name: "Pending Probe Engineer",
              job_posting_url: "https://jobs.example.com/pending-probe",
              location: "Remote",
              posting_date: "2026-05-27",
              ats: "greenhouse"
            }
          ]
        : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items,
          count: items.length,
          count_exact: true,
          visible_ats_count: items.length ? 1 : 0,
          visible_company_count: items.length ? 1 : 0,
          limit: Number(url.searchParams.get("limit") || 80),
          offset: Number(url.searchParams.get("offset") || 0),
          has_more: false,
          next_offset: null,
          filters: {
            search,
            sort_by: url.searchParams.get("sort_by") || "relevance"
          }
        })
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("pending-probe");
    await page.getByTestId("search-input").press("Enter");
    try {
      await expect(page.getByTestId("postings-refresh-indicator")).toBeVisible();
      await expect(page.getByTestId("postings-empty-state")).toHaveCount(0);
      await expect(page.getByText(/No slots match this exact search/i)).toHaveCount(0);
    } finally {
      releasePendingSearchResponse();
    }
    await expect(page.getByTestId("posting-card").first()).toContainText("Pending Response Company", { timeout: 5000 });
  });

  test("source facets stay data-only while visible source filters stay hidden", async ({ page }) => {
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
    await expect
      .poll(() => requestedPostings.some((request) => request.search === "source mix" && request.ats === ""))
      .toBeTruthy();
    await expect(page.getByTestId("posting-card").first()).toContainText("Source Intelligence Engineer");
    await expectNoFilterChrome(page);
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
    await expectNoFilterChrome(page);
    await expectNoRawErrors(page);
  });

  test("search motion, suggestions, coverage, and scrolling stay calm", async ({ page }) => {
    await openJobSlots(page);

    await expect(page.getByTestId("coverage-details")).toHaveCount(0);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
    await page.waitForTimeout(380);
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
    await expect(page.getByTestId("postings-filter-clear")).toHaveCount(0);
    await page.getByTestId("search-input").fill("remote jobs");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("postings-filter-clear")).toHaveCount(0);
    await expect(page.getByTestId("postings-filter-toggle")).toHaveCount(0);
    await expect(page.getByTestId("filters-panel")).toHaveCount(0);
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

    await page.getByTestId("app-logo").click();
    await expect(page.getByTestId("search-input")).toHaveValue("");
    await page.getByTestId("search-input").fill("hybrid designer");
    await expect(page.getByTestId("intent-chip-hybrid")).toBeVisible();

    await page.getByTestId("app-logo").click();
    await expect(page.getByTestId("search-input")).toHaveValue("");
    await page.getByTestId("search-input").fill("greenhouse engineer");
    await expect(page.getByTestId("intent-chip-source-greenhouse")).toBeVisible();

    await page.getByTestId("app-logo").click();
    await expect(page.getByTestId("search-input")).toHaveValue("");
    await page.getByTestId("search-input").fill("last 3 days");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await expect(page.getByTestId("intent-chip-freshness-3d")).toBeVisible();
    await page.getByTestId("intent-chip-freshness-3d").click();
    await expect
      .poll(() => postingsRequests.some((request) => request.search === "last 3 days" && request.freshnessDays === "3"))
      .toBeTruthy();

    await page.getByTestId("app-logo").click();
    await expect(page.getByTestId("search-input")).toHaveValue("");
    await page.getByTestId("search-input").fill("remote frontend engineer");
    await expect(page.getByTestId("search-suggestions-panel")).toBeVisible({ timeout: 1000 });
    await page.getByTestId("search-input").press("Escape");
    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
    await expectNoRawErrors(page);
    await expectNoProtectedPublicRouteCalls(protectedCalls, "autocomplete intent");
  });

  test("autocomplete does not echo an unmatched raw query as a Search suggestion", async ({ page }) => {
    await page.route("**/search/suggest**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], count: 0 })
      });
    });

    await openJobSlots(page);
    await page.getByTestId("search-input").fill("zzzxqv nohit");

    await expect(page.getByTestId("search-suggestions-panel")).toHaveCount(0);
    await expect(page.getByText("zzzxqv nohit")).toHaveCount(0);
  });

  test("typing a search term debounces autocomplete and auto-search API calls", async ({ page }) => {
    const calls = await installSearchRequestThrottleRoutes(page);
    await openJobSlots(page);
    calls.postings.length = 0;
    calls.filterOptions.length = 0;
    calls.suggestions.length = 0;

    const input = page.getByTestId("search-input");
    await input.click();
    await input.pressSequentially("software", { delay: 250 });
    await page.waitForTimeout(2600);

    expect(calls.suggestions).toEqual(["software"]);
    expect(calls.postings.filter((search) => search === "software")).toHaveLength(1);
    expect(calls.filterOptions.filter((search) => search === "software")).toHaveLength(1);
  });

  test("pressing Enter cancels pending auto-search instead of duplicating result requests", async ({ page }) => {
    const calls = await installSearchRequestThrottleRoutes(page);
    await openJobSlots(page);
    calls.postings.length = 0;
    calls.filterOptions.length = 0;
    calls.suggestions.length = 0;

    const input = page.getByTestId("search-input");
    await input.click();
    await input.pressSequentially("software", { delay: 20 });
    await input.press("Enter");
    await page.waitForTimeout(2600);

    expect(calls.suggestions).toEqual([]);
    expect(calls.postings.filter((search) => search === "software")).toHaveLength(1);
    expect(calls.filterOptions.filter((search) => search === "software")).toHaveLength(0);
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

    await page.getByTestId("app-logo").click();
    await expect(page.getByTestId("search-input")).toHaveValue("");
    await expectNoFilterChrome(page);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("search-input")).toBeFocused();
  });

  test("public search buttons are clickable without exposing admin controls", async ({ page }) => {
    await openJobSlots(page);
    await expectPublicSearchChrome(page);

    const visiblePublicButtons = [
      page.getByTestId("app-logo"),
      page.getByTestId("theme-toggle"),
      page.getByTestId("language-selector")
    ];

    for (const button of visiblePublicButtons) {
      await expect(button).toBeVisible();
    }

    await expectNoFilterChrome(page);

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

    await page.getByTestId("postings-search-clear").click();
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

  test("public search does not expose legacy filter controls", async ({ page }) => {
    await openJobSlots(page);

    await expectNoFilterChrome(page);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId("search-input").fill("remote jobs");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("posting-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("postings-search-clear")).toBeVisible();
    await expectNoFilterChrome(page);
    await expect(page.getByTestId("sync-status-panel")).toHaveCount(0);
  });

  test("legacy geo filter controls stay out of the public search surface", async ({ page }) => {
    await openJobSlots(page);
    await submitSearchAndExpectResults(page, "remote jobs");
    await expect(page.getByTestId("regions-filter-trigger")).toHaveCount(0);
    await expect(page.getByTestId("countries-filter-trigger")).toHaveCount(0);
    await expect(page.getByTestId("states-filter-trigger")).toHaveCount(0);
    await expect(page.getByTestId("counties-filter-trigger")).toHaveCount(0);
    await expectNoFilterChrome(page);
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
