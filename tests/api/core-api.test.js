const { test, expect } = require("@playwright/test");

const apiPort = process.env.OPENPOSTINGS_E2E_API_PORT || "8877";
const apiBaseUrl = process.env.OPENPOSTINGS_API_BASE_URL || `http://127.0.0.1:${apiPort}`;

test.describe("openjobslots API compatibility", () => {
  test("public routes respond without an admin token", async ({ request }) => {
    const publicChecks = [
      { path: "/health" },
      { path: "/sync/status" },
      { path: "/ingestion/status" },
      { path: "/postings", params: { search: "remote jobs", limit: "10" } },
      { path: "/postings/filter-options" },
      { path: "/search/suggest", params: { search: "tur", limit: "5" } }
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
    expect(await ingestionStatus.json()).toEqual(expect.objectContaining({ ok: true, item: expect.any(Object) }));
  });

  test("postings and filters support Turkish/Turkiye search terms", async ({ request }) => {
    for (const search of ["turkish jobs", "turksih jobs", "turkiye", "t\u00fcrkiye", "remote jobs", "QA Greenhouse"]) {
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
});
