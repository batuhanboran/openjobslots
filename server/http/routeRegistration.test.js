const assert = require("assert");

const { registerAdminRoutes } = require("./registerAdminRoutes");
const {
  getCanonicalPublicHostRedirectTarget,
  isInternalPublicAnalyticsProbe,
  registerPublicRoutes
} = require("./registerPublicRoutes");
const { registerUserRoutes } = require("./registerUserRoutes");

function createRecordingApp() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (routePath, ...handlers) => {
      const paths = Array.isArray(routePath) ? routePath : [routePath];
      for (const path of paths) {
        routes.push({ method, path, handlerCount: handlers.length });
      }
      return app;
    };
  }
  app.use = () => app;
  return { app, routes };
}

function createContext() {
  const fallback = () => {};
  return new Proxy({
    express: {
      static: () => fallback
    },
    fs: {
      existsSync: () => true,
      readFileSync: () => "<html><head></head><body></body></html>"
    },
    path: require("path"),
    publicReadCache: {},
    webDistPath: "dist",
    webIndexPath: "dist/index.html"
  }, {
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = fallback;
      }
      return target[prop];
    }
  });
}

function routeSet(routes) {
  return new Set(routes.map((route) => `${route.method.toUpperCase()} ${route.path}`));
}

function assertRoutes(routes, expected) {
  const registered = routeSet(routes);
  for (const route of expected) {
    assert.ok(registered.has(route), `expected route ${route} to be registered`);
  }
}

function assertRoutesAbsent(routes, unexpected) {
  const registered = routeSet(routes);
  for (const route of unexpected) {
    assert.ok(!registered.has(route), `expected route ${route} not to be registered`);
  }
}

function testPublicRoutes() {
  const { app, routes } = createRecordingApp();
  registerPublicRoutes(app, createContext());
  assertRoutes(routes, [
    "POST /frontend/log",
    "GET /health",
    "GET /public/preferences",
    "GET /sync/status",
    "GET /ingestion/status",
    "GET /search/popular",
    "GET /search/suggest",
    "GET /postings/filter-options",
    "GET /postings",
    "GET /",
    "GET /index.html",
    "GET /robots.txt",
    "GET /llms.txt",
    "GET /sitemap.xml",
    "GET /sitemaps/static.xml",
    "GET /sitemaps/ats-sources.xml"
  ]);
}

function testCanonicalPublicHostRedirectTarget() {
  const req = {
    method: "GET",
    originalUrl: "/en/job-openings?q=remote",
    get(name) {
      return String(name).toLowerCase() === "host" ? "www.openjobslots.com" : "";
    }
  };
  assert.equal(
    getCanonicalPublicHostRedirectTarget(req),
    "https://openjobslots.com/en/job-openings?q=remote"
  );

  const postReq = {
    ...req,
    method: "POST"
  };
  assert.equal(getCanonicalPublicHostRedirectTarget(postReq), "");
}

function testInternalPublicAnalyticsProbeDetection() {
  assert.equal(isInternalPublicAnalyticsProbe({
    query: { _validation: "1" },
    get: () => ""
  }), true);
  assert.equal(isInternalPublicAnalyticsProbe({
    query: {},
    get(name) {
      return String(name).toLowerCase() === "user-agent"
        ? "OpenJobSlots-Codex-Playwright-Validation/1.0"
        : "";
    }
  }), true);
  assert.equal(isInternalPublicAnalyticsProbe({
    query: {},
    get(name) {
      return String(name).toLowerCase() === "user-agent" ? "Mozilla/5.0" : "";
    }
  }), false);
}

function testAdminRoutes() {
  const { app, routes } = createRecordingApp();
  registerAdminRoutes(app, createContext());
  assertRoutes(routes, [
    "GET /ingestion/growth-summary",
    "GET /postings/diagnostics",
    "GET /postings/:id/diagnostics",
    "GET /ingestion/quality/summary",
    "GET /ingestion/rejections",
    "GET /ingestion/parser-stats",
    "GET /ingestion/source-quality",
    "GET /ingestion/parser-drift",
    "GET /ingestion/quarantine-summary",
    "GET /admin/services",
    "GET /admin/storage",
    "GET /admin/queue",
    "POST /sync/start",
    "POST /sync/stop",
    "POST /sync/workday",
    "POST /sync/ats",
    "GET /admin/ats",
    "GET /admin/parsers",
    "GET /admin/parsers/:ats_key",
    "GET /admin/ingestion/runs",
    "GET /admin/ingestion/errors",
    "GET /admin/ingestion/sources"
  ]);
  assertRoutesAbsent(routes, [
    "POST /frontend/log",
    "GET /health",
    "GET /public/preferences",
    "GET /sync/status",
    "GET /ingestion/status",
    "GET /search/suggest",
    "GET /postings/filter-options",
    "GET /postings"
  ]);
}

function testUserRoutes() {
  const { app, routes } = createRecordingApp();
  registerUserRoutes(app, createContext());
  assertRoutes(routes, [
    "GET /settings/personal-information",
    "PUT /settings/personal-information",
    "GET /settings/mcp",
    "PUT /settings/mcp",
    "GET /settings/sync",
    "PUT /settings/sync",
    "GET /settings/sync/blocked-companies",
    "POST /settings/sync/blocked-companies",
    "POST /settings/sync/blocked-companies/unblock",
    "POST /settings/migrate-db",
    "GET /mcp/candidates",
    "POST /mcp/cover-letter-draft",
    "POST /mcp/applications/complete",
    "GET /applications",
    "POST /applications",
    "PATCH /applications/:id",
    "DELETE /applications/:id",
    "POST /postings/ignore"
  ]);
}

testPublicRoutes();
testCanonicalPublicHostRedirectTarget();
testInternalPublicAnalyticsProbeDetection();
testAdminRoutes();
testUserRoutes();

console.log("route registration tests passed");
