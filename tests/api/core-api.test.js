const { test, expect } = require("@playwright/test");

const apiPort = process.env.OPENJOBSLOTS_E2E_API_PORT || "8877";
const apiBaseUrl = process.env.OPENJOBSLOTS_API_BASE_URL || `http://127.0.0.1:${apiPort}`;

test.describe("openjobslots API compatibility", () => {
  test("public routes respond without an admin token", async ({ request }) => {
    const publicChecks = [
      { path: "/health" },
      { path: "/sync/status" },
      { path: "/ingestion/status" },
      { path: "/postings", params: { search: "remote jobs", limit: "10" } },
      { path: "/postings/diagnostics", params: { url: "https://boards.greenhouse.io/openjobslotsqa/jobs/1001" } },
      { path: "/postings/filter-options" },
      { path: "/search/suggest", params: { search: "tur", limit: "5" } },
      { path: "/ingestion/quality/summary" },
      { path: "/ingestion/rejections" },
      { path: "/ingestion/parser-stats" },
      { path: "/ingestion/growth-summary", params: { hours: "24" } }
    ];

    for (const check of publicChecks) {
      const response = await request.get(`${apiBaseUrl}${check.path}`, { params: check.params });
      expect(response.status(), `GET ${check.path} should be public 200`).toBe(200);
      expect(response.headers()["content-type"]).toMatch(/application\/json/i);
    }
  });

  test("health and status endpoints respond with JSON", async ({ request }) => {
    const health = await request.get(`${apiBaseUrl}/health`);
    expect(health.ok()).toBeTruthy();
    expect(await health.json()).toEqual(expect.objectContaining({ ok: true }));

    const syncStatus = await request.get(`${apiBaseUrl}/sync/status`);
    expect(syncStatus.ok()).toBeTruthy();
    const syncPayload = await syncStatus.json();
    expect(syncPayload).toEqual(
      expect.objectContaining({
        db_backend: expect.any(String),
        ingestion_worker: expect.any(Object),
        legacy_api_sync: expect.any(Boolean),
        parser_attention_count: expect.any(Number),
        postings_seen_24h_count: expect.any(Number)
      })
    );

    const ingestionStatus = await request.get(`${apiBaseUrl}/ingestion/status`);
    expect(ingestionStatus.ok()).toBeTruthy();
    expect(await ingestionStatus.json()).toEqual(expect.objectContaining({
      ok: true,
      item: expect.objectContaining({
        growth_24h: expect.objectContaining({
          new_visible_rows_24h: expect.any(Number),
          new_clean_rows_24h: expect.any(Number),
          new_rows_by_ats_24h: expect.any(Array)
        })
      })
    }));
  });

  test("postings and filters support Turkish/Turkiye search terms", async ({ request }) => {
    for (const search of ["turkish jobs", "turksih jobs", "turkyie", "turkiye", "t\u00fcrkiye", "remote jobs", "QA Greenhouse"]) {
      const response = await request.get(`${apiBaseUrl}/postings`, {
        params: {
          search,
          limit: "10",
          include_applied: "1",
          include_ignored: "1"
        }
      });
      expect(response.ok(), `${search} should return 200`).toBeTruthy();
      const payload = await response.json();
      expect(Array.isArray(payload.items)).toBeTruthy();
      expect(payload.items.length, `${search} should find seeded postings`).toBeGreaterThan(0);
    }

    const filters = await request.get(`${apiBaseUrl}/postings/filter-options`);
    expect(filters.ok()).toBeTruthy();
    const filterPayload = await filters.json();
    expect(filterPayload.ats.some((item) => item.value === "greenhouse")).toBeTruthy();
    expect(Array.isArray(filterPayload.regions)).toBeTruthy();
    expect(filterPayload.regions.length).toBeGreaterThan(0);
    expect(filterPayload.regions.every((item) => item.value && item.label)).toBeTruthy();
    expect(filterPayload.countries.some((item) => /Turkey|T\u00fcrkiye/i.test(item.label))).toBeTruthy();
    expect(Array.isArray(filterPayload.states)).toBeTruthy();
    expect(Array.isArray(filterPayload.counties)).toBeTruthy();

    const suggestions = await request.get(`${apiBaseUrl}/search/suggest`, {
      params: { search: "tur", limit: "5" }
    });
    expect(suggestions.ok()).toBeTruthy();
    const suggestionPayload = await suggestions.json();
    expect(Array.isArray(suggestionPayload.items)).toBeTruthy();
    expect(suggestionPayload.items.length).toBeGreaterThan(0);

    const combined = await request.get(`${apiBaseUrl}/postings`, {
      params: {
        search: "turkish jobs",
        countries: "Turkey",
        limit: "10",
        include_applied: "1",
        include_ignored: "1"
      }
    });
    expect(combined.ok()).toBeTruthy();
    const combinedPayload = await combined.json();
    expect(combinedPayload.items.length).toBeGreaterThan(0);
    expect(combinedPayload.items.every((item) => /Turkey|T\u00fcrkiye|Istanbul/i.test(`${item.location || ""} ${item.country || ""}`))).toBeTruthy();

    const remoteCombined = await request.get(`${apiBaseUrl}/postings`, {
      params: {
        search: "remote jobs",
        remote: "remote",
        limit: "10",
        include_applied: "1",
        include_ignored: "1"
      }
    });
    expect(remoteCombined.ok()).toBeTruthy();
    const remoteCombinedPayload = await remoteCombined.json();
    expect(remoteCombinedPayload.items.length).toBeGreaterThan(0);
    expect(remoteCombinedPayload.items.every((item) => /Remote/i.test(`${item.location || ""} ${item.position_name || ""}`))).toBeTruthy();
  });

  test("admin and mutation endpoints are protected or absent from public API", async ({ request }) => {
    const protectedChecks = [
      { method: "get", path: "/admin/services" },
      { method: "get", path: "/admin/storage" },
      { method: "get", path: "/admin/queue" },
      { method: "get", path: "/admin/parsers" },
      { method: "get", path: "/settings/sync" },
      { method: "get", path: "/settings/personal-information" },
      { method: "get", path: "/settings/mcp" },
      { method: "get", path: "/settings/sync/blocked-companies" },
      { method: "get", path: "/applications" },
      { method: "post", path: "/applications", data: {} },
      { method: "get", path: "/mcp/candidates" },
      { method: "post", path: "/sync/start", data: {} },
      { method: "post", path: "/sync/stop", data: {} },
      { method: "post", path: "/sync/ats", data: {} },
      { method: "post", path: "/sync/workday", data: {} },
      { method: "post", path: "/postings/ignore", data: {} }
    ];

    for (const check of protectedChecks) {
      const response = await request[check.method](`${apiBaseUrl}${check.path}`, {
        data: check.data
      });
      expect(response.status(), `${check.method.toUpperCase()} ${check.path} should require an admin token`).toBe(401);

      const body = await response.text();
      expect(body).toMatch(/Admin token required|Admin endpoint requires/i);
      expect(body).not.toMatch(/postgres:\/\/|MEILI_|MASTER_KEY|OPENJOBSLOTS_DB_|OPENJOBSLOTS_SEARCH_|stack trace/i);
    }
  });

  test("data quality diagnostics are bounded and explainable", async ({ request }) => {
    const diagnostics = await request.get(`${apiBaseUrl}/postings/diagnostics`, {
      params: { url: "https://boards.greenhouse.io/openjobslotsqa/jobs/1001" }
    });
    expect(diagnostics.ok()).toBeTruthy();
    const diagnosticsPayload = await diagnostics.json();
    expect(diagnosticsPayload).toEqual(expect.objectContaining({ ok: true, item: expect.any(Object) }));
    expect(diagnosticsPayload.item.diagnostics).toEqual(
      expect.objectContaining({
        quality_score: expect.any(Number),
        quality_flags: expect.any(Array),
        parser_key: expect.any(String),
        parser_version: expect.any(String),
        source_ats: expect.any(String),
        source_url: expect.any(String),
        normalized_location: expect.any(Object),
        freshness: expect.any(Object)
      })
    );
    expect(JSON.stringify(diagnosticsPayload)).not.toMatch(/raw_payload|stack trace|MEILI_|postgres:\/\//i);

    const summary = await request.get(`${apiBaseUrl}/ingestion/quality/summary`, {
      params: { limit: "10" }
    });
    expect(summary.ok()).toBeTruthy();
    const summaryPayload = await summary.json();
    expect(summaryPayload.ok).toBe(true);
    expect(Array.isArray(summaryPayload.items)).toBeTruthy();
    expect(summaryPayload.items.length).toBeGreaterThan(0);
    expect(summaryPayload.items[0]).toEqual(
      expect.objectContaining({
        ats_key: expect.any(String),
        total_postings: expect.any(Number),
        avg_quality_score: expect.any(Number),
        flag_counts: expect.any(Object)
      })
    );

    const rejections = await request.get(`${apiBaseUrl}/ingestion/rejections`, {
      params: { limit: "10" }
    });
    expect(rejections.ok()).toBeTruthy();
    const rejectionsPayload = await rejections.json();
    expect(rejectionsPayload.ok).toBe(true);
    expect(Array.isArray(rejectionsPayload.items)).toBeTruthy();
    expect(rejectionsPayload.items.some((item) => /missing required title|missing title/i.test(item.rejection_reason))).toBeTruthy();

    const parserStats = await request.get(`${apiBaseUrl}/ingestion/parser-stats`, {
      params: { limit: "10" }
    });
    expect(parserStats.ok()).toBeTruthy();
    const statsPayload = await parserStats.json();
    expect(statsPayload.ok).toBe(true);
    expect(Array.isArray(statsPayload.items)).toBeTruthy();
  });
});
