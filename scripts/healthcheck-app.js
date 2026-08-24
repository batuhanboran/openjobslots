const url = String(process.env.OPENJOBSLOTS_APP_HEALTHCHECK_URL || "http://127.0.0.1:8787/health/ready");
const timeoutMs = Math.max(1000, Number(process.env.OPENJOBSLOTS_APP_HEALTHCHECK_TIMEOUT_MS || 5000));

(async () => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`app healthcheck returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.ok !== true) throw new Error("app healthcheck did not return ok=true");
  console.log(JSON.stringify(payload));
})().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
