const { safeFetchDirect: defaultSafeFetch } = require("./safeFetch");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMilliseconds(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  const parsedEpochMs = Date.parse(raw);
  if (!Number.isFinite(parsedEpochMs)) return null;
  return Math.max(0, parsedEpochMs - Date.now());
}

function getAtsRateLimitWaitMs(res, fallbackWaitMs) {
  const minimumWaitMs = Math.max(0, Number(fallbackWaitMs || 0));
  const retryAfterMs = parseRetryAfterMilliseconds(res?.headers?.get("retry-after"));
  if (!Number.isFinite(retryAfterMs)) return minimumWaitMs;
  return Math.max(minimumWaitMs, retryAfterMs);
}

function createSourceFetchRuntime(dependencies = {}) {
  const {
    atsRateLimitStore,
    fetchTimeoutMs = 12000,
    getAtsRequestQueueConcurrency = () => 1,
    maxRateLimitRetries = 2,
    nowMs = () => Date.now(),
    safeFetch = defaultSafeFetch,
    sleepFn = sleep
  } = dependencies;

  if (!atsRateLimitStore || typeof atsRateLimitStore.getState !== "function") {
    throw new Error("createSourceFetchRuntime requires atsRateLimitStore.getState");
  }

  function getAtsRateLimitState(rateLimitKey) {
    return atsRateLimitStore.getState(rateLimitKey);
  }

  async function acquireAtsRequestSlot(rateLimitKey) {
    const state = getAtsRateLimitState(rateLimitKey);
    const concurrency = Math.max(1, Number(getAtsRequestQueueConcurrency() || 1));
    if (state.active < concurrency) {
      state.active += 1;
      return;
    }
    await new Promise((resolve) => {
      state.queue.push(resolve);
    });
  }

  function releaseAtsRequestSlot(rateLimitKey) {
    const state = getAtsRateLimitState(rateLimitKey);
    const next = state.queue.shift();
    if (typeof next === "function") {
      next();
      return;
    }
    state.active = Math.max(0, state.active - 1);
  }

  async function markAtsRateLimited(rateLimitKey, waitMs) {
    await atsRateLimitStore.markRateLimited(rateLimitKey, waitMs);
  }

  async function waitForAtsCooldown(rateLimitKey) {
    await atsRateLimitStore.hydrateCooldown(rateLimitKey);
    const state = getAtsRateLimitState(rateLimitKey);
    while (true) {
      const waitMs = Number(state.blockedUntilEpochMs || 0) - nowMs();
      if (waitMs <= 0) return;
      await sleepFn(waitMs);
    }
  }

  async function waitForRequestCadence(rateLimitKey, intervalMs) {
    const state = getAtsRateLimitState(rateLimitKey);
    const waitMs = Number(state.nextAllowedAtEpochMs || 0) - nowMs();
    if (waitMs > 0) await sleepFn(waitMs);
    state.nextAllowedAtEpochMs = Math.max(Number(state.nextAllowedAtEpochMs || 0), nowMs())
      + Math.max(0, Number(intervalMs || 0));
  }

  async function fetchWithAtsRateLimit(rateLimitKey, fallbackWaitMs, url, init = {}, safeFetchOptions = {}) {
    const retryLimit = Math.max(0, Math.min(10, Number(maxRateLimitRetries || 0)));
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      await acquireAtsRequestSlot(rateLimitKey);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
      const externalSignal = init.signal;
      const abortFromExternal = () => controller.abort(externalSignal?.reason);
      if (externalSignal?.aborted) abortFromExternal();
      else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
      try {
        await waitForAtsCooldown(rateLimitKey);
        await waitForRequestCadence(rateLimitKey, fallbackWaitMs);
        const res = await safeFetch(url, {
          ...init,
          signal: controller.signal
        }, safeFetchOptions);

        if (res.status === 429) {
          const retryAfterMs = getAtsRateLimitWaitMs(res, fallbackWaitMs);
          await markAtsRateLimited(rateLimitKey, retryAfterMs);
          if (attempt >= retryLimit) {
            const error = new Error(`source request rate limited after ${attempt + 1} attempt(s)`);
            error.code = "source_rate_limited";
            error.ingestionErrorType = "source_rate_limited";
            error.status = 429;
            error.retryAfterMs = retryAfterMs;
            throw error;
          }
          continue;
        }

        return res;
      } catch (error) {
        if (controller.signal.aborted && !externalSignal?.aborted) {
          const timeoutError = new Error(`source request timed out after ${fetchTimeoutMs}ms`);
          timeoutError.code = "ETIMEDOUT";
          timeoutError.ingestionErrorType = "timeout";
          timeoutError.cause = error;
          throw timeoutError;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener?.("abort", abortFromExternal);
        releaseAtsRequestSlot(rateLimitKey);
      }
    }
    throw new Error("source fetch retry loop exhausted");
  }

  return {
    fetchWithAtsRateLimit,
    getAtsRateLimitState
  };
}

function requestIntervalMsFromRateLimit(rateLimit = {}) {
  const requestsPerMinute = Number(rateLimit?.requestsPerMinute || 0);
  if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) return 1000;
  return Math.max(0, Math.ceil(60_000 / requestsPerMinute));
}

function createSourceFetchBroker(runtime, options = {}) {
  if (!runtime || typeof runtime.fetchWithAtsRateLimit !== "function") {
    throw new Error("createSourceFetchBroker requires a source fetch runtime");
  }
  const rateLimitKey = String(options.rateLimitKey || "default").trim().toLowerCase() || "default";
  const intervalMs = requestIntervalMsFromRateLimit(options.rateLimit);
  return (url, init = {}, safeFetchOptions = {}) => runtime.fetchWithAtsRateLimit(
    rateLimitKey,
    intervalMs,
    url,
    init,
    safeFetchOptions
  );
}

module.exports = {
  createSourceFetchBroker,
  createSourceFetchRuntime,
  getAtsRateLimitWaitMs,
  parseRetryAfterMilliseconds,
  requestIntervalMsFromRateLimit
};
