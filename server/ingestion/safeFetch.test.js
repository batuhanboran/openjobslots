const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertSafeFetchUrl,
  isPrivateAddress,
  readLimitedResponseText,
  safeFetch
} = require("./safeFetch");

function publicLookup(address = "93.184.216.34") {
  return async () => [{ address, family: address.includes(":") ? 6 : 4 }];
}

test("source fetch URL guard rejects non-http schemes and local hosts", async () => {
  await assert.rejects(
    () => assertSafeFetchUrl("file:///etc/passwd"),
    /unsupported_url_scheme/
  );
  await assert.rejects(
    () => assertSafeFetchUrl("http://localhost/jobs"),
    /blocked_private_host/
  );
  await assert.rejects(
    () => assertSafeFetchUrl("https://127.0.0.1/jobs"),
    /blocked_private_host/
  );
  await assert.rejects(
    () => assertSafeFetchUrl("https://[::1]/jobs"),
    /blocked_private_host/
  );
});

test("source fetch URL guard rejects DNS answers in private ranges", async () => {
  await assert.rejects(
    () => assertSafeFetchUrl("https://example.com/jobs", {
      lookup: async () => [{ address: "10.0.0.12", family: 4 }]
    }),
    /blocked_private_address/
  );
  await assert.rejects(
    () => assertSafeFetchUrl("https://example.com/jobs", {
      lookup: async () => [{ address: "169.254.169.254", family: 4 }]
    }),
    /blocked_private_address/
  );
});

test("private address classifier covers loopback, private, link-local, and documentation ranges", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("10.1.2.3"), true);
  assert.equal(isPrivateAddress("172.16.0.1"), true);
  assert.equal(isPrivateAddress("192.168.1.1"), true);
  assert.equal(isPrivateAddress("169.254.169.254"), true);
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("fc00::1"), true);
  assert.equal(isPrivateAddress("fe80::1"), true);
  assert.equal(isPrivateAddress("93.184.216.34"), false);
});

test("safeFetch revalidates redirect targets before following them", async () => {
  const calls = [];
  await assert.rejects(
    () => safeFetch("https://example.com/jobs", {}, {
      fetcher: async (url) => {
        calls.push(url);
        return new Response("", {
          status: 302,
          headers: { location: "http://127.0.0.1/latest/meta-data" }
        });
      },
      lookup: publicLookup()
    }),
    /blocked_private_host/
  );
  assert.deepEqual(calls, ["https://example.com/jobs"]);
});

test("safeFetch follows safe redirects with an explicit maximum", async () => {
  const calls = [];
  const response = await safeFetch("https://example.com/jobs", {}, {
    fetcher: async (url) => {
      calls.push(url);
      if (url === "https://example.com/jobs") {
        return new Response("", {
          status: 302,
          headers: { location: "https://jobs.example.com/list" }
        });
      }
      return new Response("ok", { status: 200 });
    },
    lookup: publicLookup()
  });
  assert.equal(response.url, "https://jobs.example.com/list");
  assert.equal(await response.text(), "ok");
  assert.deepEqual(calls, ["https://example.com/jobs", "https://jobs.example.com/list"]);
});

test("limited response reader rejects oversized bodies", async () => {
  await assert.rejects(
    () => readLimitedResponseText(new Response("abcdef"), {
      maxBytes: 5,
      sourceUrl: "https://example.com/jobs"
    }),
    /response_too_large/
  );
});

test("safeFetch response text and json methods enforce response size limits", async () => {
  const textResponse = await safeFetch("https://example.com/jobs", {}, {
    fetcher: async () => new Response("abcdef", { status: 200 }),
    lookup: publicLookup(),
    maxResponseBytes: 5
  });
  await assert.rejects(
    () => textResponse.text(),
    /response_too_large/
  );

  const jsonResponse = await safeFetch("https://example.com/jobs", {}, {
    fetcher: async () => new Response("{\"ok\":true}", {
      status: 200,
      headers: { "content-type": "application/json" }
    }),
    lookup: publicLookup(),
    maxResponseBytes: 64
  });
  assert.deepEqual(await jsonResponse.json(), { ok: true });
});
