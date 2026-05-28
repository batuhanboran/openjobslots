const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ensureMeiliPostingsIndex,
  resolveMeiliTaskTimeoutMs
} = require("./meili");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

test("Meili task timeout uses a production-sized default with bounded env override", () => {
  assert.equal(resolveMeiliTaskTimeoutMs({}), 300000);
  assert.equal(resolveMeiliTaskTimeoutMs({ OPENJOBSLOTS_MEILI_TASK_TIMEOUT_MS: "7000" }), 7000);
  assert.equal(resolveMeiliTaskTimeoutMs({ OPENJOBSLOTS_MEILI_TASK_TIMEOUT_MS: "bad" }), 300000);
  assert.equal(resolveMeiliTaskTimeoutMs({ OPENJOBSLOTS_MEILI_TASK_TIMEOUT_MS: "100" }), 5000);
});

test("existing Meili index does not block API startup when settings task is still processing", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const href = String(url);
    calls.push({ href, method });

    if (href === "http://meili.test/indexes/postings" && method === "GET") {
      return jsonResponse({ uid: "postings", primaryKey: "id" });
    }
    if (href === "http://meili.test/indexes/postings/settings" && method === "PATCH") {
      return jsonResponse({ taskUid: 123 });
    }
    if (href === "http://meili.test/tasks/123" && method === "GET") {
      return jsonResponse({ uid: 123, status: "processing" });
    }
    throw new Error(`unexpected request ${method} ${href}`);
  };

  try {
    const result = await ensureMeiliPostingsIndex({
      enabled: true,
      host: "http://meili.test",
      apiKey: "",
      indexName: "postings",
      taskTimeoutMs: 1
    });

    assert.equal(result.ok, true);
    assert.equal(result.settings_pending, true);
    assert.ok(calls.some((call) => call.href === "http://meili.test/indexes/postings/settings"));
  } finally {
    global.fetch = originalFetch;
  }
});
