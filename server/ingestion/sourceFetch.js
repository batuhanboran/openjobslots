const { safeFetch: defaultSafeFetch } = require("./safeFetch");

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
    safeFetch = defaultSafeFetch
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
      const waitMs = Number(state.blockedUntilEpochMs || 0) - Date.now();
      if (waitMs <= 0) return;
      await sleep(waitMs);
    }
  }

  async function fetchWithAtsRateLimit(rateLimitKey, fallbackWaitMs, url, init = {}) {
    while (true) {
      await acquireAtsRequestSlot(rateLimitKey);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
      try {
        await waitForAtsCooldown(rateLimitKey);
        const res = await safeFetch(url, {
          ...init,
          signal: controller.signal
        });

        if (res.status === 429) {
          await markAtsRateLimited(rateLimitKey, getAtsRateLimitWaitMs(res, fallbackWaitMs));
          continue;
        }

        return res;
      } finally {
        clearTimeout(timeout);
        releaseAtsRequestSlot(rateLimitKey);
      }
    }
  }

  return {
    fetchWithAtsRateLimit,
    getAtsRateLimitState
  };
}

module.exports = {
  createSourceFetchRuntime,
  getAtsRateLimitWaitMs,
  parseRetryAfterMilliseconds
};
