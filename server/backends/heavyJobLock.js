const HEAVY_JOB_LOCK_NAME = "openjobslots_heavy_job";

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

module.exports = {
  HEAVY_JOB_LOCK_NAME,
  acquireHeavyJobLock,
  withHeavyJobLock
};
