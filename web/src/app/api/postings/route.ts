// Server-side proxy to the OpenJobSlots backend search API.
// Runs on the Node runtime; keeps the upstream origin out of the browser and
// avoids any cross-origin coupling regardless of where this app is deployed.

const API_BASE = process.env.OJS_API_BASE || "https://openjobslots.com";
const FORWARD_KEYS = [
  "search",
  "limit",
  "offset",
  "sort_by",
  "countries",
  "regions",
  "freshness_days",
] as const;

export async function GET(request: Request) {
  const inParams = new URL(request.url).searchParams;
  const out = new URLSearchParams();
  for (const key of FORWARD_KEYS) {
    const v = inParams.get(key);
    if (v != null && v !== "") out.set(key, v);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const upstream = await fetch(`${API_BASE}/postings?${out.toString()}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "upstream_unavailable", items: [], count: 0 },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
