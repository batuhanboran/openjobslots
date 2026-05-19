const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DETAIL_EVIDENCE_STATUS,
  buildDetailEvidenceSnapshot,
  buildDetailEvidenceSummary,
  collectDetailEvidence,
  htmlToEvidenceText,
  selectEvidenceSpans
} = require("./detailEvidence");

function makeResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status || 200,
    url: options.url || "https://jobs.example.com/final",
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-length") return String(Buffer.byteLength(body, "utf8"));
        return "";
      }
    },
    async text() {
      return body;
    }
  };
}

test("detail evidence is disabled by default and does not fetch", async () => {
  let fetched = false;
  const snapshot = await collectDetailEvidence("https://jobs.example.com/1", {
    env: {},
    fetcher: async () => {
      fetched = true;
      return makeResponse("");
    }
  });

  assert.equal(fetched, false);
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.status, DETAIL_EVIDENCE_STATUS.DISABLED);
  assert.ok(snapshot.warnings.includes("detail_evidence_disabled"));
});

test("local extractor creates evidence-only markdown and spans", async () => {
  const html = `
    <html>
      <head><style>.hidden{}</style><script>throw new Error()</script></head>
      <body>
        <h1>Senior Engineer</h1>
        <p>Location: Austin, Texas</p>
        <p>Workplace type: Hybrid</p>
        <p>Posted May 19, 2026</p>
      </body>
    </html>`;
  const snapshot = await collectDetailEvidence("https://jobs.example.com/1", {
    enabled: true,
    env: {},
    fetcher: async () => makeResponse(html),
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    includeHtml: true,
    maxSpans: 10
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.status, DETAIL_EVIDENCE_STATUS.FETCHED);
  assert.equal(snapshot.http_status, 200);
  assert.equal(snapshot.final_url, "https://jobs.example.com/final");
  assert.ok(snapshot.markdown.includes("Senior Engineer"));
  assert.ok(snapshot.markdown.includes("Location: Austin, Texas"));
  assert.ok(snapshot.html.includes("<h1>Senior Engineer</h1>"));
  assert.equal(snapshot.country, undefined);
  assert.equal(snapshot.region, undefined);
  assert.equal(snapshot.city, undefined);
  assert.equal(snapshot.remote_type, undefined);
  assert.equal(snapshot.posting_date, undefined);
  assert.equal(snapshot.source_job_id, undefined);
  assert.ok(snapshot.content_hash.length >= 64);
  assert.ok(snapshot.evidence_spans.some((span) => span.kind === "location"));
  assert.ok(snapshot.evidence_spans.some((span) => span.kind === "workplace"));
});

test("unsafe hosts are blocked by safe fetch before evidence capture", async () => {
  const snapshot = await collectDetailEvidence("http://127.0.0.1/admin", {
    enabled: true,
    env: {},
    fetcher: async () => makeResponse("should not fetch")
  });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.status, DETAIL_EVIDENCE_STATUS.FAILED);
  assert.ok(snapshot.warnings.includes("blocked_private_host"));
});

test("external providers require explicit allowlist and implementation", async () => {
  const notAllowed = await collectDetailEvidence("https://jobs.example.com/1", {
    enabled: true,
    provider: "jina",
    env: {}
  });
  assert.equal(notAllowed.status, DETAIL_EVIDENCE_STATUS.PROVIDER_NOT_ALLOWED);

  const unsupported = await collectDetailEvidence("https://jobs.example.com/1", {
    enabled: true,
    provider: "jina",
    allowedProviders: ["local", "jina"],
    env: {},
    extractors: {}
  });
  assert.equal(unsupported.status, DETAIL_EVIDENCE_STATUS.PROVIDER_UNSUPPORTED);
});

test("snapshot summary exposes bounded metadata instead of raw parser truth", () => {
  const snapshot = buildDetailEvidenceSnapshot({
    ok: true,
    status: "fetched",
    sourceUrl: "https://jobs.example.com/1",
    finalUrl: "https://jobs.example.com/1",
    httpStatus: 200,
    extractor: "local",
    markdown: "Location: Austin, Texas\nRemote eligible"
  });
  const summary = buildDetailEvidenceSummary(snapshot);

  assert.equal(summary.present, true);
  assert.equal(summary.status, "fetched");
  assert.equal(summary.extractor, "local");
  assert.equal(summary.evidence_span_count > 0, true);
  assert.equal(summary.country, undefined);
  assert.equal(summary.remote_type, undefined);
});

test("html and span helpers are deterministic", () => {
  const text = htmlToEvidenceText("<div>Location:&nbsp;<b>Remote</b></div><script>bad()</script>");
  assert.equal(text, "Location: Remote");
  const spans = selectEvidenceSpans(text, { maxSpans: 2 });
  assert.equal(spans.length, 2);
  assert.equal(spans[0].kind, "workplace");
});

console.log("detail evidence tests passed");
