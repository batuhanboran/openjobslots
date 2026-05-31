const assert = require("node:assert/strict");

const {
  createTtlJsonCache,
  sendCachedPublicJson
} = require("./index");

function request(url = "/postings/filter-options?search=software") {
  return {
    method: "GET",
    originalUrl: url,
    url,
    path: url.split("?")[0],
    get() {
      return "";
    }
  };
}

function response() {
  return {
    headers: {},
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function testConcurrentRequestsShareProducer() {
  const cache = createTtlJsonCache({ ttlMs: 1000, maxEntries: 10 });
  const gate = deferred();
  let producerCalls = 0;
  const producer = async () => {
    producerCalls += 1;
    return gate.promise;
  };

  const firstRes = response();
  const first = sendCachedPublicJson(request(), firstRes, cache, producer);
  await Promise.resolve();

  const secondRes = response();
  const second = sendCachedPublicJson(request(), secondRes, cache, producer);
  await Promise.resolve();

  assert.equal(producerCalls, 1, "concurrent same-key requests should share one producer");
  gate.resolve({ ok: true, source: "singleflight" });
  await Promise.all([first, second]);

  assert.equal(firstRes.headers["X-OpenJobSlots-Cache"], "MISS");
  assert.equal(secondRes.headers["X-OpenJobSlots-Cache"], "HIT");
  assert.deepEqual(firstRes.payload, secondRes.payload);

  const thirdRes = response();
  await sendCachedPublicJson(request(), thirdRes, cache, producer);
  assert.equal(producerCalls, 1, "completed payload should be reused from cache");
  assert.equal(thirdRes.headers["X-OpenJobSlots-Cache"], "HIT");
}

async function testFailedProducerClearsPendingRequest() {
  const cache = createTtlJsonCache({ ttlMs: 1000, maxEntries: 10 });
  let producerCalls = 0;
  const failingProducer = async () => {
    producerCalls += 1;
    throw new Error("boom");
  };

  await assert.rejects(
    () => sendCachedPublicJson(request(), response(), cache, failingProducer),
    /boom/
  );
  await assert.rejects(
    () => sendCachedPublicJson(request(), response(), cache, failingProducer),
    /boom/
  );

  assert.equal(producerCalls, 2, "failed producers should not leave a stuck pending entry");
}

async function run() {
  await testConcurrentRequestsShareProducer();
  await testFailedProducerClearsPendingRequest();
  console.log("public read cache tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
