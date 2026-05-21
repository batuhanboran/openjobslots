function toAtsRateLimitKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return key || "default";
}

function asEpochMs(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function createEmptyState() {
  return {
    active: 0,
    queue: [],
    blockedUntilEpochMs: 0,
    hydrated: false
  };
}

function createAtsRateLimitStateStore(options = {}) {
  const states = new Map();
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : () => Date.now();
  const getPool = typeof options.getPool === "function" ? options.getPool : () => options.pool || null;
  const onError = typeof options.onError === "function" ? options.onError : null;

  function recordError(error, context) {
    if (onError) onError(error, context);
  }

  function getState(rateLimitKey) {
    const normalizedKey = toAtsRateLimitKey(rateLimitKey);
    let state = states.get(normalizedKey);
    if (!state) {
      state = createEmptyState();
      states.set(normalizedKey, state);
    }
    return state;
  }

  async function hydrateCooldown(rateLimitKey) {
    const normalizedKey = toAtsRateLimitKey(rateLimitKey);
    const state = getState(normalizedKey);
    if (state.hydrated) return state;
    state.hydrated = true;

    const pool = getPool();
    if (!pool || typeof pool.query !== "function") return state;

    let result;
    try {
      result = await pool.query(
        `
          SELECT blocked_until_epoch_ms
          FROM ats_rate_limits
          WHERE rate_limit_key = $1
          LIMIT 1;
        `,
        [normalizedKey]
      );
    } catch (error) {
      recordError(error, { operation: "hydrate", rateLimitKey: normalizedKey });
      return state;
    }
    const persistedUntil = asEpochMs(result?.rows?.[0]?.blocked_until_epoch_ms);
    if (persistedUntil > nowMs()) {
      state.blockedUntilEpochMs = Math.max(state.blockedUntilEpochMs, persistedUntil);
    }
    return state;
  }

  async function markRateLimited(rateLimitKey, waitMs) {
    const normalizedKey = toAtsRateLimitKey(rateLimitKey);
    const state = getState(normalizedKey);
    const blockedUntilEpochMs = nowMs() + Math.max(0, asEpochMs(waitMs));
    state.blockedUntilEpochMs = Math.max(state.blockedUntilEpochMs, blockedUntilEpochMs);
    state.hydrated = true;

    const pool = getPool();
    if (!pool || typeof pool.query !== "function") return state;

    try {
      await pool.query(
        `
          INSERT INTO ats_rate_limits (rate_limit_key, blocked_until_epoch_ms, updated_at)
          VALUES ($1, $2, now())
          ON CONFLICT(rate_limit_key) DO UPDATE SET
            blocked_until_epoch_ms = GREATEST(ats_rate_limits.blocked_until_epoch_ms, EXCLUDED.blocked_until_epoch_ms),
            updated_at = now();
        `,
        [normalizedKey, blockedUntilEpochMs]
      );
    } catch (error) {
      recordError(error, { operation: "persist", rateLimitKey: normalizedKey });
    }
    return state;
  }

  return {
    getState,
    hydrateCooldown,
    markRateLimited
  };
}

module.exports = {
  createAtsRateLimitStateStore,
  toAtsRateLimitKey
};
