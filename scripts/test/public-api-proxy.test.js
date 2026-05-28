const assert = require("assert");

const {
  LIVE_PUBLIC_API_ORIGIN,
  resolvePublicProxyRequest
} = require("./public-api-proxy");

function assertProxy(method, rawUrl, expectedPath) {
  const resolved = resolvePublicProxyRequest({ method, rawUrl });
  assert.strictEqual(resolved.type, "proxy");
  assert.strictEqual(resolved.status, 200);
  assert.strictEqual(resolved.targetUrl, `${LIVE_PUBLIC_API_ORIGIN}${expectedPath}`);
}

assertProxy(
  "GET",
  "/postings?search=Technical%20Support%20Engineer&limit=5",
  "/postings?search=Technical%20Support%20Engineer&limit=5"
);
assertProxy("GET", "/postings/filter-options?search=engineer", "/postings/filter-options?search=engineer");
assertProxy("GET", "/sync/status?_ts=1", "/sync/status?_ts=1");
assertProxy("GET", "/health", "/health");
assertProxy("GET", "/search/suggest?search=engineer&limit=4", "/search/suggest?search=engineer&limit=4");
assertProxy("HEAD", "/postings?limit=1", "/postings?limit=1");

assert.deepStrictEqual(resolvePublicProxyRequest({ method: "OPTIONS", rawUrl: "/postings?limit=1" }), {
  type: "preflight",
  status: 204
});

assert.deepStrictEqual(resolvePublicProxyRequest({ method: "POST", rawUrl: "/frontend/log" }), {
  type: "frontend_log",
  status: 202
});

assert.deepStrictEqual(resolvePublicProxyRequest({ method: "POST", rawUrl: "/sync/start" }), {
  type: "blocked",
  status: 405,
  message: "Method not allowed by local public API proxy."
});

assert.deepStrictEqual(resolvePublicProxyRequest({ method: "GET", rawUrl: "/settings/mcp" }), {
  type: "blocked",
  status: 404,
  message: "Route not exposed by local public API proxy."
});

console.log("public-api-proxy.test.js passed");
