const dns = require("node:dns").promises;
const net = require("node:net");

const DEFAULT_MAX_RESPONSE_BYTES = Math.max(
  1024,
  Math.min(25 * 1024 * 1024, Number(process.env.OPENJOBSLOTS_SOURCE_FETCH_MAX_BYTES || 5 * 1024 * 1024))
);
const DEFAULT_MAX_REDIRECTS = 5;
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

function makeSafeFetchError(code, message, detail = {}) {
  const error = new Error(`[${code}] ${message || code}`);
  error.code = code;
  error.ingestionErrorType = code;
  if (detail.url) error.url = detail.url;
  if (detail.address) error.address = detail.address;
  return error;
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
}

function isPrivateIpv4(address) {
  const octets = String(address || "").split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && octets[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address) {
  const normalized = String(address || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateAddress(normalized.slice("::ffff:".length));
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const firstGroup = Number.parseInt(normalized.split(":")[0] || "", 16);
  if (Number.isFinite(firstGroup) && firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true;
  if (normalized.startsWith("100:")) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  return false;
}

function isPrivateAddress(address) {
  const normalized = normalizeHostname(address);
  const version = net.isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version === 6) return isPrivateIpv6(normalized);
  return true;
}

async function resolveHostAddresses(hostname, options = {}) {
  const lookup = options.lookup || dns.lookup;
  const result = await lookup(hostname, { all: true, verbatim: true });
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") return [result];
  return [];
}

async function assertSafeFetchUrl(url, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    throw makeSafeFetchError("invalid_url", "source URL is invalid", { url });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw makeSafeFetchError("unsupported_url_scheme", "source URL must use http or https", { url: parsed.toString() });
  }
  if (parsed.username || parsed.password) {
    throw makeSafeFetchError("url_userinfo_not_allowed", "source URL must not include credentials", { url: parsed.toString() });
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw makeSafeFetchError("blocked_private_host", "source URL host is blocked", { url: parsed.toString() });
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw makeSafeFetchError("blocked_private_host", "source URL host resolves to a blocked address", {
        url: parsed.toString(),
        address: hostname
      });
    }
    return parsed;
  }

  const addresses = await resolveHostAddresses(hostname, options);
  if (!addresses.length) {
    throw makeSafeFetchError("dns_lookup_failed", "source URL host did not resolve", { url: parsed.toString() });
  }
  for (const item of addresses) {
    const address = normalizeHostname(item?.address);
    if (!address || isPrivateAddress(address)) {
      throw makeSafeFetchError("blocked_private_address", "source URL host resolves to a blocked address", {
        url: parsed.toString(),
        address
      });
    }
  }
  return parsed;
}

function withFinalUrl(response, finalUrl, options = {}) {
  return new Proxy(response, {
    get(target, property, receiver) {
      if (property === "url") return target.url || finalUrl;
      if (property === "text") {
        return () => readLimitedResponseText(target, {
          maxBytes: options.maxResponseBytes || options.maxBytes || DEFAULT_MAX_RESPONSE_BYTES,
          sourceUrl: target.url || finalUrl
        });
      }
      if (property === "json") {
        return async () => JSON.parse(await readLimitedResponseText(target, {
          maxBytes: options.maxResponseBytes || options.maxBytes || DEFAULT_MAX_RESPONSE_BYTES,
          sourceUrl: target.url || finalUrl
        }));
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(Number(status || 0));
}

async function safeFetch(url, init = {}, options = {}) {
  if (typeof fetch !== "function" && typeof options.fetcher !== "function") {
    throw makeSafeFetchError("fetch_unavailable", "global fetch is unavailable for source fetch", { url });
  }
  const fetcher = options.fetcher || fetch;
  const maxRedirects = Math.max(0, Math.min(10, Number(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS)));
  let currentUrl = String(url || "");

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    await assertSafeFetchUrl(currentUrl, options);
    const response = await fetcher(currentUrl, {
      ...init,
      redirect: "manual"
    });
    if (!isRedirectStatus(response.status)) {
      return withFinalUrl(response, currentUrl, options);
    }
    const location = response.headers?.get?.("location");
    if (!location) return withFinalUrl(response, currentUrl, options);
    if (redirects === maxRedirects) {
      throw makeSafeFetchError("too_many_redirects", "source fetch exceeded redirect limit", { url: currentUrl });
    }
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw makeSafeFetchError("too_many_redirects", "source fetch exceeded redirect limit", { url });
}

async function readLimitedResponseText(response, options = {}) {
  const maxBytes = Math.max(1, Number(options.maxBytes || DEFAULT_MAX_RESPONSE_BYTES));
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw makeSafeFetchError("response_too_large", "source response is too large", {
      url: options.sourceUrl || response.url || ""
    });
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw makeSafeFetchError("response_too_large", "source response is too large", {
        url: options.sourceUrl || response.url || ""
      });
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw makeSafeFetchError("response_too_large", "source response is too large", {
          url: options.sourceUrl || response.url || ""
        });
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  assertSafeFetchUrl,
  isPrivateAddress,
  makeSafeFetchError,
  readLimitedResponseText,
  safeFetch
};
