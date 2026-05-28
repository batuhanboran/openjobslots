const { test, expect } = require("@playwright/test");

const apiPort = process.env.OPENJOBSLOTS_E2E_API_PORT || "8877";
const apiBaseUrl = process.env.OPENJOBSLOTS_API_BASE_URL || `http://127.0.0.1:${apiPort}`;
const adminToken = process.env.OPENJOBSLOTS_E2E_ADMIN_TOKEN || "openjobslots-e2e-admin-token";
const adminHeaders = {
  Authorization: `Bearer ${adminToken}`
};

test.describe("openjobslots API compatibility", () => {
  test("public routes respond without an admin token", async ({ request }) => {
    const publicChecks = [
      { path: "/health" },
      { path: "/public/preferences" },
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

  test("SEO shell, robots, and sitemap expose public-safe crawl metadata", async ({ request }) => {
    const html = await request.get(`${apiBaseUrl}/`, {
      params: { q: "Frontend Engineer" }
    });
    expect(html.status()).toBe(200);
    expect(html.headers()["content-type"]).toMatch(/text\/html/i);
    expect(html.headers()["cache-control"]).toContain("s-maxage=300");
    expect(html.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    const htmlText = await html.text();
    expect(htmlText).toContain("<title>Frontend Engineer jobs | OpenJobSlots</title>");
    expect(htmlText).toContain('<link rel="canonical" href="http://127.0.0.1:8877/?q=Frontend%20Engineer" />');
    expect(htmlText).toContain('"@type":"SearchAction"');
    expect(htmlText).not.toMatch(/postgres:\/\/|MEILI_|MASTER_KEY|OPENJOBSLOTS_DB_|stack trace/i);

    const robots = await request.get(`${apiBaseUrl}/robots.txt`);
    expect(robots.status()).toBe(200);
    expect(robots.headers()["content-type"]).toMatch(/text\/plain/i);
    expect(robots.headers()["cache-control"]).toContain("s-maxage=3600");
    const robotsText = await robots.text();
    expect(robotsText).toMatch(/^User-agent: \*/m);
    expect(robotsText).toMatch(/^Disallow: \/postings$/m);
    expect(robotsText).toMatch(/^Sitemap: http:\/\/127\.0\.0\.1:8877\/sitemap\.xml$/m);

    const sitemap = await request.get(`${apiBaseUrl}/sitemap.xml`, {
      params: { q: "private@example.com" }
    });
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()["content-type"]).toMatch(/application\/xml/i);
    expect(sitemap.headers()["cache-control"]).toContain("s-maxage=3600");
    const sitemapText = await sitemap.text();
    expect(sitemapText).toContain("<loc>http://127.0.0.1:8877/</loc>");
    expect(sitemapText).toContain("<loc>http://127.0.0.1:8877/?q=frontend%20engineer</loc>");
    expect(sitemapText).toContain("<loc>http://127.0.0.1:8877/?q=greenhouse%20jobs</loc>");
    expect(sitemapText).not.toMatch(/private@example\.com|%40|\/postings|\/applications|\/settings|\/ingestion|\/mcp|\/frontend/);
  });

  test("health and status endpoints respond with JSON", async ({ request }) => {
    const health = await request.get(`${apiBaseUrl}/health`);
    expect(health.ok()).toBeTruthy();
    expect(await health.json()).toEqual(expect.objectContaining({ ok: true }));

    const syncStatus = await request.get(`${apiBaseUrl}/sync/status`, { headers: adminHeaders });
    expect(syncStatus.ok()).toBeTruthy();
    const syncPayload = await syncStatus.json();
    expect(syncPayload).toEqual(
      expect.objectContaining({
        db_backend: expect.any(String),
        ingestion_worker: expect.any(Object),
        job_slot_count: expect.any(Number),
        legacy_api_sync: expect.any(Boolean),
        parser_attention_count: expect.any(Number),
        postings_seen_24h_count: expect.any(Number),
        configured_ats_count: expect.any(Number),
        visible_company_count: expect.any(Number)
      })
    );
    expect(syncPayload).not.toHaveProperty("heavy_job");
    expect(syncPayload).not.toHaveProperty("parser_attention_by_ats");
    expect(syncPayload.ingestion_worker).not.toHaveProperty("current_company_url");
    expect(syncPayload.ingestion_worker).not.toHaveProperty("current_company_name");
    expect(syncPayload.ingestion_worker).not.toHaveProperty("last_error");
    expect(syncPayload.ingestion_worker).not.toHaveProperty("http_status_counts");
    expect(syncPayload.ingestion_worker).not.toHaveProperty("active_ats");
    expect(syncPayload.ingestion_worker).not.toHaveProperty("parser_attention_by_ats");

    const preferences = await request.get(`${apiBaseUrl}/public/preferences`, {
      headers: {
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.4",
        "CF-IPCountry": "DE"
      }
    });
    expect(preferences.ok()).toBeTruthy();
    const preferencePayload = await preferences.json();
    expect(preferencePayload).toEqual(
      expect.objectContaining({
        ok: true,
        default_language: "tr",
        country: "DE",
        supported_languages: expect.arrayContaining([
          expect.objectContaining({ code: "en" }),
          expect.objectContaining({ code: "tr" })
        ])
      })
    );
    expect(JSON.stringify(preferencePayload)).not.toMatch(/ip|address|cf-|accept-language|cookie|postgres:\/\/|MEILI_|MASTER_KEY/i);

    const countryFallback = await request.get(`${apiBaseUrl}/public/preferences`, {
      headers: {
        "Accept-Language": "ja-JP,ja;q=0.9",
        "CF-IPCountry": "TR"
      }
    });
    expect(countryFallback.ok()).toBeTruthy();
    expect(await countryFallback.json()).toEqual(expect.objectContaining({ default_language: "tr", country: "TR" }));

    const ingestionStatus = await request.get(`${apiBaseUrl}/ingestion/status`, { headers: adminHeaders });
    expect(ingestionStatus.ok()).toBeTruthy();
    const ingestionPayload = await ingestionStatus.json();
    expect(ingestionPayload).toEqual(expect.objectContaining({
      ok: true,
      item: expect.objectContaining({
        growth_24h: expect.objectContaining({
          new_visible_rows_24h: expect.any(Number),
          new_clean_rows_24h: expect.any(Number),
          new_rows_by_ats_24h: expect.any(Array)
        })
      })
    }));
    expect(ingestionPayload.item).not.toHaveProperty("current_company_url");
    expect(ingestionPayload.item).not.toHaveProperty("current_company_name");
    expect(ingestionPayload.item).not.toHaveProperty("last_error");
    expect(ingestionPayload.item).not.toHaveProperty("http_status_counts");
    expect(ingestionPayload.item).not.toHaveProperty("active_ats");
    expect(ingestionPayload.item).not.toHaveProperty("parser_attention_by_ats");
    expect(ingestionPayload.item).not.toHaveProperty("source_quality");
    expect(ingestionPayload.item).not.toHaveProperty("source_jobs");
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

    const qAliasSuggestions = await request.get(`${apiBaseUrl}/search/suggest`, {
      params: { q: "remote frontend", limit: "5" }
    });
    expect(qAliasSuggestions.ok()).toBeTruthy();
    const qAliasPayload = await qAliasSuggestions.json();
    expect(qAliasPayload.items.some((item) => item.intent_type === "remote" && item.filter?.remote === "remote")).toBeTruthy();

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

  test("postings expose exact count metadata plus read-only freshness and sort params", async ({ request }) => {
    const firstPage = await request.get(`${apiBaseUrl}/postings`, {
      params: {
        search: "QA",
        limit: "1",
        include_applied: "1",
        include_ignored: "1"
      }
    });
    expect(firstPage.ok()).toBeTruthy();
    const firstPagePayload = await firstPage.json();
    expect(firstPagePayload.items.length).toBe(1);
    expect(firstPagePayload.count).toBeGreaterThan(firstPagePayload.items.length);
    expect(firstPagePayload.count_exact).toBe(true);

    const freshOnly = await request.get(`${apiBaseUrl}/postings`, {
      params: {
        search: "QA",
        freshness_days: "3",
        limit: "10",
        include_applied: "1",
        include_ignored: "1"
      }
    });
    expect(freshOnly.ok()).toBeTruthy();
    const freshPayload = await freshOnly.json();
    expect(freshPayload.filters).toEqual(expect.objectContaining({ freshness_days: 3 }));
    expect(freshPayload.count).toBeLessThan(firstPagePayload.count);
    expect(freshPayload.items.every((item) => Number(item.last_seen_epoch || 0) > 0)).toBeTruthy();

    const sortOptions = await request.get(`${apiBaseUrl}/postings/filter-options`);
    expect(sortOptions.ok()).toBeTruthy();
    const sortPayload = await sortOptions.json();
    expect(sortPayload.sort_options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "relevance" }),
        expect.objectContaining({ value: "last_seen" }),
        expect.objectContaining({ value: "posted_date" }),
        expect.objectContaining({ value: "ats_source" }),
        expect.objectContaining({ value: "confidence" })
      ])
    );

    for (const sortBy of ["relevance", "last_seen", "posted_date", "ats_source", "confidence"]) {
      const sorted = await request.get(`${apiBaseUrl}/postings`, {
        params: {
          search: "QA",
          sort_by: sortBy,
          limit: "10",
          include_applied: "1",
          include_ignored: "1"
        }
      });
      expect(sorted.ok(), `${sortBy} should be accepted`).toBeTruthy();
      const payload = await sorted.json();
      expect(payload.filters).toEqual(expect.objectContaining({ sort_by: sortBy }));
      expect(Array.isArray(payload.items)).toBeTruthy();
    }
  });

  test("search suggestions expose safe visible intent metadata", async ({ request }) => {
    const cases = [
      {
        search: "remote frontend engineer",
        matcher: (item) => item.intent_type === "remote" && item.filter?.remote === "remote"
      },
      {
        search: "hybrid designer",
        matcher: (item) => item.intent_type === "hybrid" && item.filter?.remote === "hybrid"
      },
      {
        search: "greenhouse engineer",
        matcher: (item) => item.intent_type === "source" && item.filter?.ats === "greenhouse"
      },
      {
        search: "last 3 days",
        matcher: (item) => item.intent_type === "freshness" && Number(item.filter?.freshness_days) === 3
      }
    ];

    for (const check of cases) {
      const response = await request.get(`${apiBaseUrl}/search/suggest`, {
        params: { search: check.search, limit: "8" }
      });
      expect(response.ok(), `${check.search} should return suggestions`).toBeTruthy();
      const payload = await response.json();
      expect(Array.isArray(payload.items)).toBeTruthy();
      expect(payload.items.some(check.matcher), `${check.search} should include matching visible intent`).toBeTruthy();
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/source_quality|parser_version|quality_flags|raw_payload|rejection_reason|MEILI_|MASTER_KEY|postgres:\/\//i);
    }
  });

  test("postings expose bounded public source facets without diagnostics", async ({ request }) => {
    const response = await request.get(`${apiBaseUrl}/postings`, {
      params: {
        search: "QA",
        limit: "10",
        include_applied: "1",
        include_ignored: "1"
      }
    });
    expect(response.ok()).toBeTruthy();
    const payload = await response.json();
    expect(Array.isArray(payload.source_facets)).toBeTruthy();
    expect(payload.source_facets.length).toBeGreaterThan(0);

    const greenhouse = payload.source_facets.find((item) => item.value === "greenhouse");
    expect(greenhouse).toEqual(
      expect.objectContaining({
        value: "greenhouse",
        label: expect.any(String),
        count: expect.any(Number),
        avg_confidence: expect.any(Number),
        avg_quality: expect.any(Number),
        latest_seen_epoch: expect.any(Number),
        fresh_percentage: expect.any(Number)
      })
    );
    expect(greenhouse.count).toBeGreaterThan(0);

    const greenhouseOnly = await request.get(`${apiBaseUrl}/postings`, {
      params: {
        search: "QA",
        ats: "greenhouse",
        limit: "10",
        include_applied: "1",
        include_ignored: "1"
      }
    });
    expect(greenhouseOnly.ok()).toBeTruthy();
    const greenhousePayload = await greenhouseOnly.json();
    expect(greenhousePayload.source_facets.map((item) => item.value)).toEqual(["greenhouse"]);

    const serialized = JSON.stringify(payload.source_facets);
    expect(serialized).not.toMatch(/risk|recommendation|source_quality|parser_version|quality_flags|raw_payload|rejection_reason|MEILI_|MASTER_KEY|postgres:\/\//i);
  });

  test("public status endpoints expose coarse read-only health without diagnostics", async ({ request }) => {
    for (const path of ["/sync/status", "/ingestion/status"]) {
      const response = await request.get(`${apiBaseUrl}${path}`);
      expect(response.ok(), `${path} should be public read-only status`).toBeTruthy();
      const payload = await response.json();
      expect(payload).toEqual(expect.any(Object));
      expect(JSON.stringify(payload)).not.toMatch(/postgres:\/\/|MEILI_|MASTER_KEY|OPENJOBSLOTS_DB_|OPENJOBSLOTS_SEARCH_|stack trace|raw_payload|quality_flags|source_quality|parser_version/i);
    }
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
      { method: "get", path: "/postings/diagnostics" },
      { method: "get", path: "/postings/1/diagnostics" },
      { method: "get", path: "/ingestion/growth-summary" },
      { method: "get", path: "/ingestion/quality/summary" },
      { method: "get", path: "/ingestion/rejections" },
      { method: "get", path: "/ingestion/parser-stats" },
      { method: "get", path: "/ingestion/source-quality" },
      { method: "get", path: "/ingestion/parser-drift" },
      { method: "get", path: "/ingestion/quarantine-summary" },
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
      headers: adminHeaders,
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
      headers: adminHeaders,
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
      headers: adminHeaders,
      params: { limit: "10" }
    });
    expect(rejections.ok()).toBeTruthy();
    const rejectionsPayload = await rejections.json();
    expect(rejectionsPayload.ok).toBe(true);
    expect(Array.isArray(rejectionsPayload.items)).toBeTruthy();
    expect(rejectionsPayload.items.some((item) => /missing required title|missing title/i.test(item.rejection_reason))).toBeTruthy();

    const parserStats = await request.get(`${apiBaseUrl}/ingestion/parser-stats`, {
      headers: adminHeaders,
      params: { limit: "10" }
    });
    expect(parserStats.ok()).toBeTruthy();
    const statsPayload = await parserStats.json();
    expect(statsPayload.ok).toBe(true);
    expect(Array.isArray(statsPayload.items)).toBeTruthy();
  });
});
