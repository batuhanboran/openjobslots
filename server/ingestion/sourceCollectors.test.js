const assert = require("assert");
const test = require("node:test");

const {
  createSourceCollectorRuntime
} = require("./sourceCollectors");
const { SOURCE_FAMILIES, SOURCE_STATUSES } = require("./sourceContracts");

function createTextResponse(body, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    url: options.url || "",
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? options.contentType || "text/plain" : "";
      }
    },
    async text() {
      return body;
    }
  };
}

test("source collector runtime can be required without the server index module", async () => {
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("network should not be used for unknown ATS dispatch");
    },
    getPostingLocationByJobUrl: () => new Map()
  });

  assert.equal(typeof runtime.collectPostingsForCompany, "function");
  assert.equal(typeof runtime.inferPostingLocationFromJobUrl, "function");
  assert.equal(typeof runtime.shouldStorePostingByDate, "function");
  assert.deepEqual(await runtime.collectPostingsForCompany({ ATS_name: "unknown" }), []);
});

test("source collector date policy keeps fresh postings and drops stale postings", () => {
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("network should not be used for date policy");
    },
    getPostingLocationByJobUrl: () => new Map(),
    postingTtlSeconds: 3 * 24 * 60 * 60
  });
  const referenceEpoch = Math.floor(Date.parse("2026-05-24T12:00:00Z") / 1000);

  assert.equal(runtime.shouldStorePostingByDate("posted today", referenceEpoch), true);
  assert.equal(runtime.shouldStorePostingByDate("2 days ago", referenceEpoch), true);
  assert.equal(runtime.shouldStorePostingByDate("4 days ago", referenceEpoch), false);
});

test("pilot ATS dispatches through registry modules before legacy collectors", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "greenhouse",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({ list_url: "https://example.test/jobs" }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { ok: true };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.ok ? "Registry Pilot Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("registry test should not hit network");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "greenhouse",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "greenhouse",
    company_name: "Registry Co",
    url_string: "https://job-boards.greenhouse.io/registryco"
  });

  assert.deepEqual(calls, [
    ["module", "greenhouse"],
    ["fetchList", "greenhouse", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Registry Co",
    position_name: "Registry Pilot Posting"
  }]);
});

test("HRMDirect dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "hrmdirect",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "hrmdirect",
      source_family: "html_detail",
      list_url: "https://fixture.hrmdirect.com/employment/job-openings.php?search=true"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { html: "<table></table>" };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.html ? "HRMDirect Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("HRMDirect registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "hrmdirect",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "hrmdirect",
    company_name: "HRM Registry Co",
    url_string: "https://fixture.hrmdirect.com/employment/job-openings.php"
  });

  assert.deepEqual(calls, [
    ["module", "hrmdirect"],
    ["fetchList", "hrmdirect", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "HRM Registry Co",
    position_name: "HRMDirect Registry Posting"
  }]);
});

test("BambooHR dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "bamboohr",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "bamboohr",
      source_family: "direct_json",
      list_url: "https://fixture.bamboohr.com/careers/list"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { result: [{ id: 1001 }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload.result) ? "BambooHR Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("BambooHR registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "bamboohr",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "bamboohr",
    company_name: "Bamboo Registry Co",
    url_string: "https://fixture.bamboohr.com/careers"
  });

  assert.deepEqual(calls, [
    ["module", "bamboohr"],
    ["fetchList", "bamboohr", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Bamboo Registry Co",
    position_name: "BambooHR Registry Posting"
  }]);
});

test("ApplyToJob dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "applytojob",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "applytojob",
      source_family: "html_detail",
      list_url: "https://fixture.applytojob.com/apply"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { html: "<ul></ul>" };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.html ? "ApplyToJob Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("ApplyToJob registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "applytojob",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "applytojob",
    company_name: "Apply Registry Co",
    url_string: "https://fixture.applytojob.com/apply"
  });

  assert.deepEqual(calls, [
    ["module", "applytojob"],
    ["fetchList", "applytojob", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Apply Registry Co",
    position_name: "ApplyToJob Registry Posting"
  }]);
});

test("Breezy dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "breezy",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "breezy",
      source_family: "html_detail",
      list_url: "https://fixture.breezy.hr/"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { html: "<main></main>" };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.html ? "Breezy Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Breezy registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "breezy",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "breezy",
    company_name: "Breezy Registry Co",
    url_string: "https://fixture.breezy.hr/"
  });

  assert.deepEqual(calls, [
    ["module", "breezy"],
    ["fetchList", "breezy", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Breezy Registry Co",
    position_name: "Breezy Registry Posting"
  }]);
});

test("CareerPlug dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "careerplug",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "careerplug",
      source_family: "html_detail",
      list_url: "https://fixture.careerplug.com/jobs"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { html: "<main></main>" };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.html ? "CareerPlug Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("CareerPlug registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "careerplug",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "careerplug",
    company_name: "CareerPlug Registry Co",
    url_string: "https://fixture.careerplug.com/jobs"
  });

  assert.deepEqual(calls, [
    ["module", "careerplug"],
    ["fetchList", "careerplug", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "CareerPlug Registry Co",
    position_name: "CareerPlug Registry Posting"
  }]);
});

test("Greenhouse pilot collector fetches and parses through the source registry", async () => {
  const calls = [];
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async (atsKey, waitMs, url) => {
      calls.push({ atsKey, waitMs, url });
      return createTextResponse(JSON.stringify({
        jobs: [{
          id: 101,
          title: "Platform Engineer",
          absolute_url: "https://job-boards.greenhouse.io/fixtureco/jobs/101",
          location: { name: "Remote - United States" },
          updated_at: "2026-05-23T10:00:00Z"
        }]
      }), {
        contentType: "application/json",
        url
      });
    },
    getPostingLocationByJobUrl: () => new Map()
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "greenhouse",
    company_name: "Fixture Co",
    url_string: "https://job-boards.greenhouse.io/fixtureco"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].atsKey, "greenhouse");
  assert.equal(calls[0].url, "https://boards-api.greenhouse.io/v1/boards/fixtureco/jobs?content=true");
  assert.equal(postings.length, 1);
  assert.equal(postings[0].position_name, "Platform Engineer");
  assert.equal(postings[0].source_job_id, "101");
});

test("iCIMS pilot collector fetches iframe pages through the source registry", async () => {
  const calls = [];
  const listHtml = `
    <li class="iCIMS_JobCardItem">
      <a href="/jobs/5001/remote-data-analyst/job"><h3>Remote Data Analyst</h3></a>
      <dt><span class="field-label">Location</span></dt>
      <dd class="iCIMS_JobHeaderData"><span>Remote - United States</span></dd>
      <span data-field="remote">Remote</span>
      <span class="field-label">Date Posted</span><span title="2026-05-08">May 8, 2026</span>
    </li>
  `;
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async (atsKey, waitMs, url) => {
      calls.push({ atsKey, waitMs, url });
      return createTextResponse(listHtml, {
        contentType: "text/html",
        url
      });
    },
    getPostingLocationByJobUrl: () => new Map()
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "icims",
    company_name: "Fixture Co",
    url_string: "https://fixtureco.icims.com/jobs/search?ss=1"
  });

  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.atsKey === "icims"));
  assert.match(calls[1].url, /in_iframe=1/);
  assert.equal(postings.length, 1);
  assert.equal(postings[0].position_name, "Remote Data Analyst");
  assert.equal(postings[0].remote_type, "remote");
});
