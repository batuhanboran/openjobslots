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

test("safeFetch pins the transport request to the validated DNS answer", async () => {
  let lookupCount = 0;
  const response = await safeFetch("https://example.com/jobs", {}, {
    lookup: async () => {
      lookupCount += 1;
      return [{ address: "93.184.216.34", family: 4 }];
    },
    requester: async (target, init) => {
      assert.equal(target.parsed.hostname, "example.com");
      assert.deepEqual(target.addresses, [{ address: "93.184.216.34", family: 4 }]);
      assert.equal(init.redirect, "manual");
      return new Response("ok", { status: 200 });
    }
  });

  assert.equal(lookupCount, 1);
  assert.equal(response.url, "https://example.com/jobs");
  assert.equal(await response.text(), "ok");
});

test("safeFetch retries transient DNS lookup failures before requesting", async () => {
  let lookupCount = 0;
  let requestCount = 0;
  const response = await safeFetch("https://example.com/jobs", {}, {
    lookup: async () => {
      lookupCount += 1;
      if (lookupCount === 1) {
        const error = new Error("temporary resolver failure");
        error.code = "EAI_AGAIN";
        throw error;
      }
      return [{ address: "93.184.216.34", family: 4 }];
    },
    requester: async () => {
      requestCount += 1;
      return new Response("ok", { status: 200 });
    },
    dnsLookupRetryDelayMs: 1
  });

  assert.equal(lookupCount, 2);
  assert.equal(requestCount, 1);
  assert.equal(await response.text(), "ok");
});

test("safeFetch bounds stalled DNS lookups", async () => {
  await assert.rejects(
    () => safeFetch("https://example.com/jobs", {}, {
      lookup: async () => new Promise(() => {}),
      requester: async () => {
        throw new Error("request should not start");
      },
      dnsLookupTimeoutMs: 5,
      dnsLookupRetries: 0
    }),
    (error) => {
      assert.equal(error.code, "ETIMEDOUT");
      assert.equal(error.ingestionErrorType, "timeout");
      assert.match(error.message, /DNS lookup timed out/);
      return true;
    }
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
