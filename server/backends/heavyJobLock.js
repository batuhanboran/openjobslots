const HEAVY_JOB_LOCK_NAME = "openjobslots_heavy_job";
const MAX_STATUS_LOCKS = 20;

function bool(value) {
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

async function acquireHeavyJobLock(pool, jobName = "heavy-job", options = {}) {
  if (!pool || typeof pool.query !== "function") return null;
  const lockName = String(options.lockName || HEAVY_JOB_LOCK_NAME);
  const client = typeof pool.connect === "function" ? await pool.connect() : pool;
  let locked = false;
  try {
    const result = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked;", [lockName]);
    locked = bool(result?.rows?.[0]?.locked);
    if (!locked) {
      const error = new Error(`Another OpenJobSlots heavy job is already active; refusing to start ${jobName}.`);
      error.code = "OPENJOBSLOTS_HEAVY_JOB_ACTIVE";
      throw error;
    }
    const startedAt = new Date().toISOString();
    console.error(`[openjobslots heavy-job] start job=${jobName} lock=${lockName} at=${startedAt}`);
    return {
      lockName,
      jobName,
      async release(status = "succeeded") {
        if (!locked) return;
        locked = false;
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext($1)) AS unlocked;", [lockName]);
        } finally {
          if (client !== pool && typeof client.release === "function") client.release();
          console.error(`[openjobslots heavy-job] end job=${jobName} status=${status} at=${new Date().toISOString()}`);
        }
      }
    };
  } catch (error) {
    if (client !== pool && typeof client.release === "function") client.release();
    console.error(`[openjobslots heavy-job] refuse job=${jobName} reason=${error?.code || error?.message || error}`);
    throw error;
  }
}

async function withHeavyJobLock(pool, jobName, callback, options = {}) {
  const lock = await acquireHeavyJobLock(pool, jobName, options);
  try {
    const result = await callback();
    if (lock) await lock.release("succeeded");
    return result;
  } catch (error) {
    if (lock) await lock.release("failed");
    throw error;
  }
}

async function getHeavyJobLockStatus(pool, options = {}) {
  if (!pool || typeof pool.query !== "function") {
    return { lock_name: String(options.lockName || HEAVY_JOB_LOCK_NAME), active: false, locks: [] };
  }
  const lockName = String(options.lockName || HEAVY_JOB_LOCK_NAME);
  try {
    const result = await pool.query(
      `
        SELECT
          l.pid,
          a.application_name,
          a.state,
          extract(epoch from now() - coalesce(a.xact_start, a.query_start, a.backend_start))::bigint AS age_seconds,
          a.wait_event_type,
          a.wait_event,
          a.client_addr::text AS client_addr
        FROM pg_locks l
        LEFT JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory'
          AND l.granted = true
        ORDER BY age_seconds DESC NULLS LAST
        LIMIT $1;
      `,
      [MAX_STATUS_LOCKS]
    );
    const locks = (result.rows || []).map((row) => ({
      pid: Number(row.pid || 0),
      application_name: String(row.application_name || ""),
      state: String(row.state || ""),
      age_seconds: Number(row.age_seconds || 0),
      wait_event_type: String(row.wait_event_type || ""),
      wait_event: String(row.wait_event || ""),
      client_addr: String(row.client_addr || "")
    }));
    return {
      lock_name: lockName,
      active: locks.length > 0,
      locks
    };
  } catch (error) {
    return {
      lock_name: lockName,
      active: false,
      locks: [],
      error: String(error?.message || error).slice(0, 300)
    };
  }
}

module.exports = {
  HEAVY_JOB_LOCK_NAME,
  acquireHeavyJobLock,
  getHeavyJobLockStatus,
  withHeavyJobLock
};
