const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const { promisify } = require("node:util");
const zlib = require("node:zlib");

const gunzipAsync = promisify(zlib.gunzip);
const inflateAsync = promisify(zlib.inflate);
const brotliDecompressAsync = zlib.brotliDecompress ? promisify(zlib.brotliDecompress) : null;

const DEFAULT_MAX_RESPONSE_BYTES = Math.max(
  1024,
  Math.min(25 * 1024 * 1024, Number(process.env.OPENJOBSLOTS_SOURCE_FETCH_MAX_BYTES || 5 * 1024 * 1024))
);
const DEFAULT_MAX_REDIRECTS = 5;
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const PROXIES = [
  "38.154.203.95:5863:REDACTED:REDACTED",
  "198.105.121.200:6462:REDACTED:REDACTED",
  "64.137.96.74:6641:REDACTED:REDACTED",
  "209.127.138.10:5784:REDACTED:REDACTED",
  "38.154.185.97:6370:REDACTED:REDACTED",
  "84.247.60.125:6095:REDACTED:REDACTED",
  "142.111.67.146:5611:REDACTED:REDACTED",
  "191.96.254.138:6185:REDACTED:REDACTED",
  "31.58.9.4:6077:REDACTED:REDACTED",
  "104.239.107.47:5699:REDACTED:REDACTED"
];

function getActiveProxies() {
  const envProxies = process.env.OPENJOBSLOTS_PROXIES;
  if (envProxies && typeof envProxies === "string" && envProxies.trim()) {
    return envProxies
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return PROXIES;
}

const BROWSER_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
];

function injectBrowserHeaders(url, headers) {
  const requestHeaders = { ...headers };
  
  if (!hasRequestHeader(requestHeaders, "user-agent")) {
    const randomUserAgent = BROWSER_USER_AGENTS[Math.floor(Math.random() * BROWSER_USER_AGENTS.length)];
    requestHeaders["User-Agent"] = randomUserAgent;
  }
  
  if (!hasRequestHeader(requestHeaders, "accept")) {
    requestHeaders["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
  }
  if (!hasRequestHeader(requestHeaders, "accept-language")) {
    requestHeaders["Accept-Language"] = "en-US,en;q=0.9";
  }
  if (!hasRequestHeader(requestHeaders, "sec-ch-ua")) {
    requestHeaders["sec-ch-ua"] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
  }
  if (!hasRequestHeader(requestHeaders, "sec-ch-ua-mobile")) {
    requestHeaders["sec-ch-ua-mobile"] = "?0";
  }
  if (!hasRequestHeader(requestHeaders, "sec-ch-ua-platform")) {
    requestHeaders["sec-ch-ua-platform"] = '"Windows"';
  }
  if (!hasRequestHeader(requestHeaders, "sec-fetch-dest")) {
    requestHeaders["sec-fetch-dest"] = "document";
  }
  if (!hasRequestHeader(requestHeaders, "sec-fetch-mode")) {
    requestHeaders["sec-fetch-mode"] = "navigate";
  }
  if (!hasRequestHeader(requestHeaders, "sec-fetch-site")) {
    requestHeaders["sec-fetch-site"] = "none";
  }
  if (!hasRequestHeader(requestHeaders, "sec-fetch-user")) {
    requestHeaders["sec-fetch-user"] = "?1";
  }
  if (!hasRequestHeader(requestHeaders, "upgrade-insecure-requests")) {
    requestHeaders["upgrade-insecure-requests"] = "1";
  }

  return requestHeaders;
}

const DEFAULT_DNS_LOOKUP_TIMEOUT_MS = Math.max(
  250,
  Math.min(30_000, Number(process.env.OPENJOBSLOTS_DNS_LOOKUP_TIMEOUT_MS || 8000))
);
const DEFAULT_DNS_LOOKUP_RETRIES = Math.max(
  0,
  Math.min(5, Math.floor(Number(process.env.OPENJOBSLOTS_DNS_LOOKUP_RETRIES || 1)))
);
const DEFAULT_DNS_LOOKUP_RETRY_DELAY_MS = Math.max(
  0,
  Math.min(5_000, Number(process.env.OPENJOBSLOTS_DNS_LOOKUP_RETRY_DELAY_MS || 250))
);

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
  const timeoutMs = Math.max(0, Number(options.dnsLookupTimeoutMs || DEFAULT_DNS_LOOKUP_TIMEOUT_MS));
  const maxRetries = Math.max(0, Math.floor(Number(options.dnsLookupRetries ?? DEFAULT_DNS_LOOKUP_RETRIES)));
  const retryDelayMs = Math.max(0, Number(options.dnsLookupRetryDelayMs || DEFAULT_DNS_LOOKUP_RETRY_DELAY_MS));
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      const result = await withTimeout(
        lookup(hostname, { all: true, verbatim: true }),
        timeoutMs,
        () => makeDnsLookupTimeoutError(hostname, timeoutMs),
        options.signal
      );
      if (Array.isArray(result)) return result;
      if (result && typeof result === "object") return [result];
      return [];
    } catch (error) {
      lastError = error;
      if (isAbortSignalError(error) || !isTransientDnsLookupError(error) || attempt >= maxRetries) {
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1), options.signal);
    }
  }

  if (lastError) throw lastError;
  return [];
}

async function resolveSafeFetchTarget(url, options = {}) {
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
    return {
      parsed,
      addresses: [{ address: hostname, family: net.isIP(hostname) }]
    };
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
  return { parsed, addresses };
}

async function assertSafeFetchUrl(url, options = {}) {
  const target = await resolveSafeFetchTarget(url, options);
  return target.parsed;
}

function normalizeRequestHeaders(headers) {
  const normalized = {};
  if (!headers) return normalized;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
    return normalized;
  }
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      normalized[String(pair[0])] = String(pair[1]);
    }
    return normalized;
  }
  if (typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      normalized[String(key)] = String(value);
    });
    return normalized;
  }
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined || value === null) continue;
      normalized[String(key)] = String(value);
    }
  }
  return normalized;
}

function hasRequestHeader(headers, name) {
  const target = String(name || "").toLowerCase();
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === target);
}

function makeNodeHeaders(rawHeaders = {}) {
  if (typeof Headers !== "undefined") {
    const headers = new Headers();
    for (const [key, value] of Object.entries(rawHeaders || {})) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, String(item));
      } else if (value !== undefined && value !== null) {
        headers.set(key, String(value));
      }
    }
    return headers;
  }

  const values = new Map();
  for (const [key, value] of Object.entries(rawHeaders || {})) {
    const normalizedKey = String(key).toLowerCase();
    const normalizedValue = Array.isArray(value) ? value.join(", ") : String(value || "");
    values.set(normalizedKey, normalizedValue);
  }
  return {
    get(name) {
      return values.get(String(name || "").toLowerCase()) || null;
    }
  };
}

function makeAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortSignalError(error) {
  return error?.name === "AbortError";
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw makeAbortError();
}

function isTransientDnsLookupError(error) {
  const code = String(error?.code || "").toUpperCase();
  return ["EAI_AGAIN", "ETIMEOUT", "ETIMEDOUT", "ESERVFAIL"].includes(code);
}

function makeDnsLookupTimeoutError(hostname, timeoutMs) {
  const error = makeSafeFetchError("timeout", `DNS lookup timed out for ${hostname} after ${timeoutMs}ms`);
  error.code = "ETIMEDOUT";
  return error;
}

function sleep(ms, signal) {
  const waitMs = Math.max(0, Number(ms || 0));
  if (waitMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(makeAbortError());
    };
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, waitMs);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function withTimeout(promise, timeoutMs, onTimeout, signal) {
  const waitMs = Math.max(0, Number(timeoutMs || 0));
  if (waitMs <= 0 && !signal) return promise;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const done = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => done(reject, makeAbortError());

    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }

    if (waitMs > 0) {
      timeout = setTimeout(() => done(reject, onTimeout()), waitMs);
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });

    Promise.resolve(promise).then(
      (value) => done(resolve, value),
      (error) => done(reject, error)
    );
  });
}

function requestBodyToBuffer(body) {
  if (body === undefined || body === null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return Buffer.from(body.toString());
  return Buffer.from(String(body));
}

function chooseFetchAddress(addresses) {
  const items = Array.isArray(addresses) ? addresses : [];
  const selected =
    items.find((item) => item?.address && Number(item.family || net.isIP(item.address)) === 4) ||
    items.find((item) => item?.address) ||
    null;
  if (!selected) {
    throw makeSafeFetchError("dns_lookup_failed", "source URL host did not resolve");
  }
  return {
    address: normalizeHostname(selected.address),
    family: Number(selected.family || net.isIP(selected.address) || 0) || undefined
  };
}

async function decodeResponseBuffer(buffer, headers) {
  const encoding = String(headers.get("content-encoding") || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .pop();
  if (!encoding || encoding === "identity") return buffer;
  if (encoding === "gzip" || encoding === "x-gzip") return gunzipAsync(buffer);
  if (encoding === "deflate") return inflateAsync(buffer);
  if (encoding === "br" && brotliDecompressAsync) return brotliDecompressAsync(buffer);
  return buffer;
}

function createBufferedResponse({ status, statusText, headers, url, bodyBuffer }) {
  let textPromise = null;
  const response = {
    status,
    statusText,
    ok: status >= 200 && status < 300,
    headers,
    url,
    body: null,
    text() {
      if (!textPromise) textPromise = Promise.resolve(bodyBuffer.toString("utf8"));
      return textPromise;
    },
    async json() {
      return JSON.parse(await response.text());
    },
    async arrayBuffer() {
      return bodyBuffer.buffer.slice(bodyBuffer.byteOffset, bodyBuffer.byteOffset + bodyBuffer.byteLength);
    }
  };
  return response;
}

function connectProxyTunnel(proxyStr, targetParsed, selectedAddress, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const parts = proxyStr.split(":");
    if (parts.length !== 4) {
      return reject(new Error("Invalid proxy format, expected host:port:user:pass"));
    }
    const [pHost, pPort, pUser, pPass] = parts;
    const auth = Buffer.from(`${pUser}:${pPass}`).toString("base64");
    const port = targetParsed.port || (targetParsed.protocol === "https:" ? 443 : 80);
    const targetHostPort = `${selectedAddress.address}:${port}`;

    let settled = false;
    let req;

    const cleanup = () => {
      signal?.removeEventListener?.("abort", onAbort);
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      req?.destroy();
      reject(err);
    };

    const onAbort = () => fail(makeAbortError());

    if (signal?.aborted) {
      return reject(makeAbortError());
    }

    req = http.request({
      host: pHost,
      port: Number(pPort),
      method: "CONNECT",
      path: targetHostPort,
      headers: {
        "Proxy-Authorization": `Basic ${auth}`,
        "Proxy-Connection": "Keep-Alive"
      }
    });

    if (timeoutMs > 0) {
      req.setTimeout(timeoutMs);
    }

    req.on("connect", (res, socket) => {
      if (settled) {
        socket.destroy();
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        fail(new Error(`Proxy CONNECT failed with status code ${res.statusCode}`));
        socket.destroy();
        return;
      }

      if (targetParsed.protocol === "https:") {
        const tlsSocket = tls.connect({
          socket: socket,
          servername: targetParsed.hostname
        }, () => {
          if (settled) {
            tlsSocket.destroy();
            return;
          }
          settled = true;
          cleanup();
          resolve(tlsSocket);
        });

        tlsSocket.on("error", (err) => {
          fail(err);
        });
      } else {
        settled = true;
        cleanup();
        resolve(socket);
      }
    });

    req.on("error", fail);

    req.on("timeout", () => {
      req.destroy();
      fail(makeSafeFetchError("timeout", `Proxy CONNECT timed out for ${targetHostPort}`));
    });

    signal?.addEventListener?.("abort", onAbort, { once: true });
    req.end();
  });
}

async function fetchPinnedUrl(target, init = {}, options = {}) {
  const parsed = target.parsed;
  const selectedAddress = chooseFetchAddress(target.addresses);
  const requestHeaders = injectBrowserHeaders(parsed.toString(), normalizeRequestHeaders(init.headers));
  if (!hasRequestHeader(requestHeaders, "host")) requestHeaders.Host = parsed.host;
  if (!hasRequestHeader(requestHeaders, "accept-encoding")) requestHeaders["Accept-Encoding"] = "gzip, deflate, br";
  const maxBytes = Math.max(1, Number(options.maxResponseBytes || options.maxBytes || DEFAULT_MAX_RESPONSE_BYTES));
  const bodyBuffer = requestBodyToBuffer(init.body);
  if (bodyBuffer && !hasRequestHeader(requestHeaders, "content-length")) {
    requestHeaders["Content-Length"] = String(bodyBuffer.byteLength);
  }

  let tunnelSocket = null;
  if (options.proxy) {
    const timeoutMs = options.dnsLookupTimeoutMs || DEFAULT_DNS_LOOKUP_TIMEOUT_MS;
    tunnelSocket = await connectProxyTunnel(options.proxy, parsed, selectedAddress, timeoutMs, init.signal);
  }

  return new Promise((resolve, reject) => {
    const client = parsed.protocol === "https:" ? https : http;
    let settled = false;
    let request;
    const cleanup = () => {
      init.signal?.removeEventListener?.("abort", onAbort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      request?.destroy?.(error);
      if (tunnelSocket) {
        tunnelSocket.destroy();
      }
      reject(error);
    };
    const onAbort = () => fail(makeAbortError());
    if (init.signal?.aborted) {
      if (tunnelSocket) {
        tunnelSocket.destroy();
      }
      reject(makeAbortError());
      return;
    }

    const requestOpts = {
      protocol: parsed.protocol,
      hostname: selectedAddress.address,
      family: selectedAddress.family,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      method: String(init.method || "GET").toUpperCase(),
      path: `${parsed.pathname || "/"}${parsed.search || ""}`,
      headers: requestHeaders,
      servername: parsed.hostname
    };

    if (tunnelSocket) {
      requestOpts.createConnection = () => tunnelSocket;
    }

    request = client.request(requestOpts, (res) => {
      const headers = makeNodeHeaders(res.headers);
      const contentLength = Number(headers.get("content-length") || 0);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        res.resume();
        fail(makeSafeFetchError("response_too_large", "source response is too large", {
          url: parsed.toString()
        }));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      res.on("data", (chunk) => {
        if (settled) return;
        const buffer = Buffer.from(chunk);
        totalBytes += buffer.byteLength;
        if (totalBytes > maxBytes) {
          res.destroy();
          fail(makeSafeFetchError("response_too_large", "source response is too large", {
            url: parsed.toString()
          }));
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", async () => {
        if (settled) return;
        try {
          const decoded = await decodeResponseBuffer(Buffer.concat(chunks), headers);
          if (decoded.byteLength > maxBytes) {
            throw makeSafeFetchError("response_too_large", "source response is too large", {
              url: parsed.toString()
            });
          }
          settled = true;
          cleanup();
          resolve(createBufferedResponse({
            status: Number(res.statusCode || 0),
            statusText: String(res.statusMessage || ""),
            headers,
            url: parsed.toString(),
            bodyBuffer: decoded
          }));
        } catch (error) {
          fail(error);
        }
      });
    });

    request.on("error", fail);
    init.signal?.addEventListener?.("abort", onAbort, { once: true });
    if (bodyBuffer) request.write(bodyBuffer);
    request.end();
  });
}

const NON_RETRYABLE_ERRORS = new Set([
  "invalid_url",
  "unsupported_url_scheme",
  "url_userinfo_not_allowed",
  "blocked_private_host",
  "blocked_private_address",
  "too_many_redirects",
  "response_too_large"
]);

function isRetryableError(error) {
  if (!error) return false;
  if (error.name === "AbortError" || error.code === "AbortError") return false;
  const code = error.ingestionErrorType || error.code;
  if (NON_RETRYABLE_ERRORS.has(code)) return false;
  return true;
}

function withFinalUrl(response, finalUrl, options = {}) {
  return new Proxy(response, {
    get(target, property) {
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
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(Number(status || 0));
}

async function safeFetchInternal(url, init = {}, options = {}) {
  const fetcher = typeof options.fetcher === "function" ? options.fetcher : null;
  const requester = options.requester || null;
  const maxRedirects = Math.max(0, Math.min(10, Number(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS)));
  let currentUrl = String(url || "");

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const target = await resolveSafeFetchTarget(currentUrl, { ...options, signal: init.signal });
    const requestInit = {
      ...init,
      redirect: "manual"
    };
    const response = typeof requester === "function"
      ? await requester(target, requestInit, options)
      : fetcher
        ? await fetcher(currentUrl, requestInit)
        : await fetchPinnedUrl(target, requestInit, options);
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

async function safeFetch(url, init = {}, options = {}) {
  if (options.proxy) {
    return safeFetchInternal(url, init, options);
  }

  let lastError = null;
  let lastResponse = null;
  let useProxy = false;

  try {
    const response = await safeFetchInternal(url, init, options);
    if (![403, 406, 503, 429].includes(response.status)) {
      return response;
    }
    lastResponse = response;
    console.warn(`[safeFetch] Direct request to ${url} returned WAF status ${response.status}. Will retry via proxy...`);
    useProxy = true;
  } catch (error) {
    if (!isRetryableError(error)) {
      throw error;
    }
    lastError = error;
    console.warn(`[safeFetch] Direct request to ${url} failed with error: ${error.message}. Will retry via proxy...`);
    useProxy = true;
  }

  if (useProxy) {
    const activeProxies = getActiveProxies();
    if (!activeProxies.length) {
      console.warn(`[safeFetch] No active proxies available for retry on ${url}`);
      if (lastError) throw lastError;
      return lastResponse;
    }

    const maxAttempts = Math.min(activeProxies.length, 3);
    const attemptedProxies = new Set();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let proxy = null;
      const remainingProxies = activeProxies.filter((p) => !attemptedProxies.has(p));
      if (remainingProxies.length > 0) {
        proxy = remainingProxies[Math.floor(Math.random() * remainingProxies.length)];
      } else {
        proxy = activeProxies[Math.floor(Math.random() * activeProxies.length)];
      }
      attemptedProxies.add(proxy);

      const proxyDisplay = proxy.split(":")[0];
      console.log(`[safeFetch] Attempt ${attempt}/${maxAttempts} fetching ${url} via proxy ${proxyDisplay}...`);

      try {
        const response = await safeFetchInternal(url, init, { ...options, proxy });
        if (![403, 406, 503, 429].includes(response.status)) {
          return response;
        }
        lastResponse = response;
        console.warn(`[safeFetch] Proxy attempt ${attempt} returned WAF status ${response.status}`);
      } catch (error) {
        if (!isRetryableError(error)) {
          throw error;
        }
        lastError = error;
        console.warn(`[safeFetch] Proxy attempt ${attempt} failed with error: ${error.message}`);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return lastResponse;
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  assertSafeFetchUrl,
  isPrivateAddress,
  makeSafeFetchError,
  readLimitedResponseText,
  safeFetch
};
