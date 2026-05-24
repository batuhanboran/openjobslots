const assert = require("assert");

const { createHttpSecurity } = require("./security");

function createRequest(overrides = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(overrides.headers || {})) {
    headers[key.toLowerCase()] = value;
  }
  return {
    connection: overrides.connection || {},
    ip: overrides.ip || "203.0.113.10",
    method: overrides.method || "GET",
    path: overrides.path || "/",
    socket: overrides.socket || {},
    get(name) {
      return headers[String(name || "").toLowerCase()] || "";
    }
  };
}

function createResponse() {
  return {
    body: null,
    headers: {},
    statusCode: 200,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function testAdminAccessUsesConstantTimeTokenCheck() {
  const { hasAdminAccess } = createHttpSecurity({
    adminToken: "secret-token",
    allowLocalAdmin: false,
    nodeEnv: "production"
  });

  assert.equal(hasAdminAccess(createRequest({ headers: { authorization: "Bearer secret-token" } })), true);
  assert.equal(hasAdminAccess(createRequest({ headers: { "x-openjobslots-admin-token": "wrong" } })), false);
}

function testLocalAdminAccessIsDevelopmentOnly() {
  const development = createHttpSecurity({
    adminToken: "",
    allowLocalAdmin: true,
    nodeEnv: "development"
  });
  const production = createHttpSecurity({
    adminToken: "",
    allowLocalAdmin: true,
    nodeEnv: "production"
  });
  const localRequest = createRequest({ ip: "127.0.0.1" });

  assert.equal(development.hasAdminAccess(localRequest), true);
  assert.equal(production.hasAdminAccess(localRequest), false);
}

function testControlRoutesAndAdminGate() {
  const { adminGateMiddleware, isControlRoute } = createHttpSecurity({
    adminToken: "secret-token",
    allowLocalAdmin: false,
    nodeEnv: "production"
  });

  assert.equal(isControlRoute(createRequest({ path: "/settings" })), true);
  assert.equal(isControlRoute(createRequest({ path: "/postings/abc/diagnostics" })), true);
  assert.equal(isControlRoute(createRequest({ path: "/postings" })), false);

  const res = createResponse();
  let nextCalled = false;
  adminGateMiddleware(createRequest({ path: "/settings" }), res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
}

function testSecurityHeaders() {
  const { buildSecurityContentSecurityPolicy, securityHeadersMiddleware } = createHttpSecurity({
    adminToken: "",
    allowLocalAdmin: false,
    nodeEnv: "production"
  });
  const res = createResponse();
  let nextCalled = false;

  securityHeadersMiddleware(createRequest(), res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.headers["X-Frame-Options"], "DENY");
  assert.equal(res.headers["Strict-Transport-Security"], "max-age=15552000; includeSubDomains");
  assert.ok(buildSecurityContentSecurityPolicy().includes("default-src 'self'"));
  assert.ok(res.headers["Content-Security-Policy"].includes("frame-ancestors 'none'"));
}

function testRateLimiterAndGenericErrorMiddleware() {
  const { createRateLimiter, genericErrorMiddleware } = createHttpSecurity({
    adminToken: "",
    allowLocalAdmin: false,
    nodeEnv: "development"
  });
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, name: "test" });
  const req = createRequest({ ip: "198.51.100.10" });
  const first = createResponse();
  const second = createResponse();
  let firstNextCalled = false;
  let secondNextCalled = false;

  limiter(req, first, () => {
    firstNextCalled = true;
  });
  limiter(req, second, () => {
    secondNextCalled = true;
  });

  assert.equal(firstNextCalled, true);
  assert.equal(secondNextCalled, false);
  assert.equal(second.statusCode, 429);
  assert.equal(second.body.ok, false);

  const errorRes = createResponse();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    genericErrorMiddleware(new Error("private detail"), createRequest(), errorRes, () => {});
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(errorRes.statusCode, 500);
  assert.equal(errorRes.body.error, "Internal server error. Details were logged for debugging.");
}

testAdminAccessUsesConstantTimeTokenCheck();
testLocalAdminAccessIsDevelopmentOnly();
testControlRoutesAndAdminGate();
testSecurityHeaders();
testRateLimiterAndGenericErrorMiddleware();

console.log("HTTP security tests passed");
