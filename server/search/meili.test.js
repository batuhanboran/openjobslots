const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ensureMeiliPostingsIndex,
  resolveMeiliTaskTimeoutMs,
  updateMeiliPostingFreshness,
  upsertMeiliPostings
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

test("document upsert waits for the Meili task to succeed", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = String(options.method || "GET").toUpperCase();
    calls.push({ href, method });
    if (href === "http://meili.test/indexes/postings/documents" && method === "POST") {
      return jsonResponse({ taskUid: 42, status: "enqueued" });
    }
    if (href === "http://meili.test/tasks/42" && method === "GET") {
      return jsonResponse({ uid: 42, status: "succeeded" });
    }
    throw new Error(`unexpected request ${method} ${href}`);
  };

  try {
    const result = await upsertMeiliPostings([{
      canonical_url: "https://example.com/jobs/42",
      position_name: "Platform Engineer",
      company_name: "Example"
    }], {
      enabled: true,
      host: "http://meili.test",
      apiKey: "",
      indexName: "postings",
      taskTimeoutMs: 5000
    });
    assert.equal(result.status, "succeeded");
    assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("freshness updates use partial PUT documents without replacing search content", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = String(options.method || "GET").toUpperCase();
    calls.push({ href, method, body: options.body ? JSON.parse(String(options.body)) : null });
    if (href === "http://meili.test/indexes/postings/documents?skipCreation=true" && method === "PUT") {
      return jsonResponse({ taskUid: 43, status: "enqueued" });
    }
    if (href === "http://meili.test/tasks/43" && method === "GET") {
      return jsonResponse({ uid: 43, status: "succeeded" });
    }
    throw new Error(`unexpected request ${method} ${href}`);
  };

  try {
    const result = await updateMeiliPostingFreshness([{
      canonical_url: "https://example.com/jobs/43",
      last_seen_epoch: 1770000043
    }], {
      enabled: true,
      host: "http://meili.test",
      apiKey: "",
      indexName: "postings",
      taskTimeoutMs: 5000
    });
    assert.equal(result.status, "succeeded");
    assert.deepEqual(calls.map((call) => call.method), ["PUT", "GET"]);
    assert.equal(calls[0].body.length, 1);
    assert.equal(calls[0].body[0].last_seen_epoch, 1770000043);
    assert.equal(calls[0].body[0].canonical_url, "https://example.com/jobs/43");
    assert.ok(calls[0].body[0].id);
    assert.equal(Object.hasOwn(calls[0].body[0], "title"), false);
    assert.equal(Object.hasOwn(calls[0].body[0], "description_plain"), false);
  } finally {
    global.fetch = originalFetch;
  }
});
