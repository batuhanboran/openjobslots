const http = require("http");
const https = require("https");

const LIVE_PUBLIC_API_ORIGIN = process.env.OPENJOBSLOTS_PUBLIC_API_ORIGIN || "https://www.openjobslots.com";
const DEFAULT_PUBLIC_API_PROXY_PORT = process.env.OPENJOBSLOTS_PUBLIC_API_PROXY_PORT || process.env.PORT || "8877";

const SAFE_PUBLIC_GET_PATHS = new Set([
  "/health",
  "/postings",
  "/postings/filter-options",
  "/ingestion/status",
  "/public/preferences",
  "/search/popular",
  "/search/suggest",
  "/sync/status"
]);

const LOCAL_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400"
};

function resolvePublicProxyRequest({ method = "GET", rawUrl = "/" } = {}) {
  const requestMethod = String(method || "GET").trim().toUpperCase();
  let url;
  try {
    url = new URL(String(rawUrl || "/"), "http://local.openjobslots");
  } catch {
    return { type: "blocked", status: 400, message: "Invalid proxy URL." };
  }

  if (requestMethod === "OPTIONS") {
    if (url.pathname === "/frontend/log" || SAFE_PUBLIC_GET_PATHS.has(url.pathname)) {
      return { type: "preflight", status: 204 };
    }
    return { type: "blocked", status: 404, message: "Route not exposed by local public API proxy." };
  }

  if (url.pathname === "/frontend/log" && requestMethod === "POST") {
    return { type: "frontend_log", status: 202 };
  }

  if (!["GET", "HEAD"].includes(requestMethod)) {
    return { type: "blocked", status: 405, message: "Method not allowed by local public API proxy." };
  }

  if (!SAFE_PUBLIC_GET_PATHS.has(url.pathname)) {
    return { type: "blocked", status: 404, message: "Route not exposed by local public API proxy." };
  }

  const targetUrl = new URL(`${url.pathname}${url.search}`, LIVE_PUBLIC_API_ORIGIN);
  return { type: "proxy", status: 200, targetUrl: targetUrl.toString() };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload || {});
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...LOCAL_CORS_HEADERS
  });
  res.end(body);
}

function copyPublicResponseHeaders(headers = {}) {
  const nextHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "set-cookie" ||
      lowerKey === "content-security-policy" ||
      lowerKey === "cross-origin-resource-policy" ||
      lowerKey === "x-frame-options" ||
      lowerKey === "content-encoding" ||
      lowerKey === "transfer-encoding" ||
      lowerKey === "connection"
    ) {
      continue;
    }
    nextHeaders[key] = value;
  }
  nextHeaders["Cache-Control"] = "no-store";
  Object.assign(nextHeaders, LOCAL_CORS_HEADERS);
  return nextHeaders;
}

function proxyPublicRequest(req, res, resolved) {
  const targetUrl = new URL(resolved.targetUrl);
  const upstream = https.request(
    targetUrl,
    {
      method: req.method,
      headers: {
        Accept: req.headers.accept || "application/json",
        "User-Agent": "openjobslots-local-public-api-proxy/1.0"
      }
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, copyPublicResponseHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    }
  );

  upstream.setTimeout(25_000, () => upstream.destroy(new Error("Live public API proxy timeout.")));
  upstream.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    sendJson(res, 502, {
      ok: false,
      error: "Live public API proxy failed.",
      detail: String(error?.message || error)
    });
  });
  upstream.end();
}

function createPublicApiProxyServer() {
  return http.createServer((req, res) => {
    const resolved = resolvePublicProxyRequest({ method: req.method, rawUrl: req.url });
    if (resolved.type === "preflight") {
      req.resume();
      res.writeHead(resolved.status, {
        "Content-Length": "0",
        ...LOCAL_CORS_HEADERS
      });
      res.end();
      return;
    }
    if (resolved.type === "frontend_log") {
      req.resume();
      sendJson(res, resolved.status, { ok: true, proxied: false });
      return;
    }
    if (resolved.type !== "proxy") {
      req.resume();
      sendJson(res, resolved.status || 404, { ok: false, error: resolved.message || "Route not available." });
      return;
    }
    proxyPublicRequest(req, res, resolved);
  });
}

if (require.main === module) {
  const server = createPublicApiProxyServer();
  server.listen(Number(DEFAULT_PUBLIC_API_PROXY_PORT), "127.0.0.1", () => {
    console.log(
      `Local public API proxy listening on http://127.0.0.1:${DEFAULT_PUBLIC_API_PROXY_PORT} -> ${LIVE_PUBLIC_API_ORIGIN}`
    );
  });
}

module.exports = {
  LIVE_PUBLIC_API_ORIGIN,
  resolvePublicProxyRequest,
  createPublicApiProxyServer
};
