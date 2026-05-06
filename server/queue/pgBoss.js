const OPENJOBSLOTS_INGESTION_QUEUE = "openjobslots-ingestion";

function getPgBossConfig(env = process.env) {
  return {
    enabled: String(env.OPENJOBSLOTS_QUEUE_BACKEND || "sqlite-worker").trim().toLowerCase() === "pg-boss",
    connectionString: String(env.DATABASE_URL || env.POSTGRES_URL || "").trim(),
    queueName: String(env.PG_BOSS_INGESTION_QUEUE || OPENJOBSLOTS_INGESTION_QUEUE).trim() ||
      OPENJOBSLOTS_INGESTION_QUEUE
  };
}

async function createPgBoss(config = getPgBossConfig()) {
  if (!config.enabled) return null;
  if (!config.connectionString) {
    throw new Error("OPENJOBSLOTS_QUEUE_BACKEND=pg-boss requires DATABASE_URL");
  }
  const PgBoss = require("pg-boss");
  const boss = new PgBoss({
    connectionString: config.connectionString,
    schema: "pgboss"
  });
  boss.on("error", (error) => {
    console.error("[openjobslots queue] pg-boss error:", error);
  });
  await boss.start();
  await boss.createQueue(config.queueName);
  return boss;
}

async function enqueueCompanySync(boss, company, options = {}) {
  if (!boss) return null;
  const queueName = String(options.queueName || OPENJOBSLOTS_INGESTION_QUEUE);
  const atsKey = String(company?.ATS_name || company?.ats_key || "").trim().toLowerCase();
  const companyUrl = String(company?.url_string || company?.company_url || "").trim();
  const jobId = `${atsKey}:${companyUrl}`;
  return boss.send(queueName, company, {
    singletonKey: jobId,
    retryLimit: Number(options.retryLimit || 5),
    retryDelay: Number(options.retryDelay || 60),
    expireInSeconds: Number(options.expireInSeconds || 30 * 60)
  });
}

module.exports = {
  OPENJOBSLOTS_INGESTION_QUEUE,
  createPgBoss,
  enqueueCompanySync,
  getPgBossConfig
};
