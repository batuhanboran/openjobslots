const crypto = require("crypto");

const {
  buildGoogleAnalyticsCsp,
  readPublicWebAnalyticsConfig
} = require("../analytics/publicWebAnalytics");

const CONTROL_ROUTE_PREFIXES = Object.freeze([
  "/admin",
  "/settings",
  "/mcp",
  "/applications",
  "/ingestion/quality",
  "/ingestion/rejections",
  "/ingestion/parser-stats",
  "/ingestion/source-quality",
  "/ingestion/parser-drift",
  "/ingestion/quarantine-summary"
]);

const CONTROL_ROUTE_EXACT = Object.freeze([
  "/sync/start",
  "/sync/stop",
  "/sync/ats",
  "/sync/workday",
  "/postings/ignore",
  "/ingestion/growth-summary"
]);

function isLocalRequest(req) {
  const candidates = [
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress
  ].map((value) => String(value || "").toLowerCase());
  return candidates.some((ip) =>
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip === "localhost" ||
    ip.startsWith("::ffff:127.")
  );
}

function safeCompareToken(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(String(actual), "utf8");
  const expectedBuffer = Buffer.from(String(expected), "utf8");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function getBearerToken(req) {
  const header = String(req.get("authorization") || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isPostingDiagnosticsRoute(pathname) {
  return pathname === "/postings/diagnostics" || /^\/postings\/[^/]+\/diagnostics$/.test(pathname);
}

function isControlRoute(req) {
  const pathname = String(req.path || "").toLowerCase();
  return (
    CONTROL_ROUTE_EXACT.includes(pathname) ||
    CONTROL_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    isPostingDiagnosticsRoute(pathname)
  );
}

function buildSecurityContentSecurityPolicy(env = process.env) {
  const analyticsCsp = buildGoogleAnalyticsCsp(readPublicWebAnalyticsConfig(env));
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    ["img-src 'self' data:", ...analyticsCsp.imgSrc].join(" "),
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    ["script-src 'self' 'unsafe-inline'", ...analyticsCsp.scriptSrc].join(" "),
    ["connect-src 'self'", ...analyticsCsp.connectSrc].join(" "),
    "form-action 'self'"
  ].join("; ");
}

function createRateLimiter({ windowMs, max, name }) {
  const buckets = new Map();
  let lastCleanup = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup > windowMs) {
      for (const [key, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastCleanup = now;
    }

    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const key = `${name}:${ip}`;
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      return res.status(429).json({
        ok: false,
        error: "Too many requests. Please retry shortly."
      });
    }
    return next();
  };
}

function genericErrorMiddleware(error, req, res, _next) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = Number.isFinite(status) && status >= 400 && status < 600 ? status : 500;
  console.error("[openjobslots API] request failed:", {
    method: req.method,
    path: req.path,
    status: safeStatus,
    message: String(error?.message || error)
  });
  if (res.headersSent) return;
  res.status(safeStatus).json({
    ok: false,
    error: safeStatus >= 500 ? "Internal server error. Details were logged for debugging." : "Request failed."
  });
}

function createHttpSecurity(options = {}) {
  const adminToken = String(options.adminToken || "").trim();
  const allowLocalAdmin = Boolean(options.allowLocalAdmin);
  const nodeEnv = String(options.nodeEnv || "development").trim().toLowerCase();

  function hasAdminAccess(req) {
    const requestToken = getBearerToken(req) || String(req.get("x-openjobslots-admin-token") || "").trim();
    if (adminToken) return safeCompareToken(requestToken, adminToken);
    if (nodeEnv === "production") return false;
    return allowLocalAdmin && isLocalRequest(req);
  }

  function securityHeadersMiddleware(_req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", buildSecurityContentSecurityPolicy());
    if (nodeEnv === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  }

  function adminGateMiddleware(req, res, next) {
    if (!isControlRoute(req)) return next();
    if (hasAdminAccess(req)) return next();
    return res.status(401).json({
      ok: false,
      error: adminToken
        ? "Admin token required."
        : "Admin endpoint requires OPENJOBSLOTS_ADMIN_TOKEN, or OPENJOBSLOTS_ALLOW_LOCAL_ADMIN=1 for private local development."
    });
  }

  return {
    adminGateMiddleware,
    buildSecurityContentSecurityPolicy,
    createRateLimiter,
    genericErrorMiddleware,
    hasAdminAccess,
    isControlRoute,
    isLocalRequest,
    securityHeadersMiddleware
  };
}

module.exports = {
  buildSecurityContentSecurityPolicy,
  createHttpSecurity,
  createRateLimiter,
  genericErrorMiddleware,
  isControlRoute,
  isLocalRequest
};
