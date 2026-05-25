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

test("Taleo dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "taleo",
    family: SOURCE_FAMILIES.brittleHighRisk,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "taleo",
      source_family: "brittle",
      list_url: "https://fixture.taleo.net/careersection/001/jobsearch.ftl?lang=en"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { requisitionList: [{ jobId: "7001" }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload.requisitionList) ? "Taleo Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Taleo registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "taleo",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "taleo",
    company_name: "Taleo Registry Co",
    url_string: "https://fixture.taleo.net/careersection/001/jobsearch.ftl?lang=en"
  });

  assert.deepEqual(calls, [
    ["module", "taleo"],
    ["fetchList", "taleo", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Taleo Registry Co",
    position_name: "Taleo Registry Posting"
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

test("ApplicantPro dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "applicantpro",
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "applicantpro",
      source_family: "embedded_json",
      list_url: "https://fixture.applicantpro.com/jobs/"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { data: { jobs: [{ id: 445566 }] } };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload?.data?.jobs?.length ? "ApplicantPro Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("ApplicantPro registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "applicantpro",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "applicantpro",
    company_name: "ApplicantPro Registry Co",
    url_string: "https://fixture.applicantpro.com/jobs/"
  });

  assert.deepEqual(calls, [
    ["module", "applicantpro"],
    ["fetchList", "applicantpro", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "ApplicantPro Registry Co",
    position_name: "ApplicantPro Registry Posting"
  }]);
});

test("Ashby dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "ashby",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "ashby",
      source_family: "direct_json",
      list_url: "https://api.ashbyhq.com/posting-api/job-board/fixtureco"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { jobs: [{ id: "ashby-1001" }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload?.jobs) ? "Ashby Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Ashby registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "ashby",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "ashbyhq",
    company_name: "Ashby Registry Co",
    url_string: "https://jobs.ashbyhq.com/fixtureco"
  });

  assert.deepEqual(calls, [
    ["module", "ashby"],
    ["fetchList", "ashbyhq", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Ashby Registry Co",
    position_name: "Ashby Registry Posting"
  }]);
});

test("Lever dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "lever",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "lever",
      source_family: "direct_json",
      list_url: "https://api.lever.co/v0/postings/fixtureco?mode=json"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return [{ id: "lev-1001" }];
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload) ? "Lever Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Lever registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "lever",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "lever.co",
    company_name: "Lever Registry Co",
    url_string: "https://jobs.lever.co/fixtureco"
  });

  assert.deepEqual(calls, [
    ["module", "lever"],
    ["fetchList", "lever.co", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Lever Registry Co",
    position_name: "Lever Registry Posting"
  }]);
});

test("PinpointHQ dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "pinpointhq",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "pinpointhq",
      source_family: "direct_json",
      list_url: "https://fixtureco.pinpointhq.com/postings.json"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { data: [{ id: "pin-1" }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload.data) ? "PinpointHQ Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("PinpointHQ registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "pinpointhq",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "pinpointhq",
    company_name: "Pinpoint Registry Co",
    url_string: "https://fixtureco.pinpointhq.com/"
  });

  assert.deepEqual(calls, [
    ["module", "pinpointhq"],
    ["fetchList", "pinpointhq", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Pinpoint Registry Co",
    position_name: "PinpointHQ Registry Posting"
  }]);
});

test("Join dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "join",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "join",
      source_family: "embedded_json",
      list_url: "https://join.com/companies/fixtureco"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { html: "<script id=\"__NEXT_DATA__\">{}</script>" };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.html ? "Join Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Join registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "join",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "join",
    company_name: "Join Registry Co",
    url_string: "https://join.com/companies/fixtureco"
  });

  assert.deepEqual(calls, [
    ["module", "join"],
    ["fetchList", "join", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Join Registry Co",
    position_name: "Join Registry Posting"
  }]);
});

test("Zoho dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "zoho",
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.canary,
    discover: () => ({
      ats_key: "zoho",
      source_family: "embedded_json",
      list_url: "https://fixtureco.zohorecruit.com/jobs/Careers"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { body: "<input id=\"jobs\" value='[]'>" };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.body ? "Zoho Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Zoho registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "zoho",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "zohorecruit",
    company_name: "Zoho Registry Co",
    url_string: "https://fixtureco.zohorecruit.com/jobs/Careers"
  });

  assert.deepEqual(calls, [
    ["module", "zoho"],
    ["fetchList", "zohorecruit", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Zoho Registry Co",
    position_name: "Zoho Registry Posting"
  }]);
});

test("RecruitCRM dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "recruitcrm",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.quarantine,
    discover: () => ({
      ats_key: "recruitcrm",
      source_family: "direct_json",
      list_url: "https://albatross.recruitcrm.io/v1/external-pages/jobs-by-account/get?account=fixtureco&batch=true"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { data: { jobs: [{ id: "rc-1001" }] } };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload?.data?.jobs) ? "RecruitCRM Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("RecruitCRM registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "recruitcrm",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "recruitcrm.io",
    company_name: "RecruitCRM Registry Co",
    url_string: "https://recruitcrm.io/jobs/fixtureco"
  });

  assert.deepEqual(calls, [
    ["module", "recruitcrm"],
    ["fetchList", "recruitcrm.io", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "RecruitCRM Registry Co",
    position_name: "RecruitCRM Registry Posting"
  }]);
});

test("Rippling dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "rippling",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "rippling",
      source_family: "direct_json",
      list_url: "https://ats.rippling.com/api/v2/board/fixtureco/jobs"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { items: [{ name: "Fixture Rippling Role" }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload.items) ? "Rippling Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Rippling registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "rippling",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "rippling",
    company_name: "Rippling Registry Co",
    url_string: "https://ats.rippling.com/fixtureco/jobs"
  });

  assert.deepEqual(calls, [
    ["module", "rippling"],
    ["fetchList", "rippling", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Rippling Registry Co",
    position_name: "Rippling Registry Posting"
  }]);
});

test("Manatal dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "manatal",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "manatal",
      source_family: "direct_json",
      list_url: "https://www.careers-page.com/api/v1.0/c/fixtureco/jobs/"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { results: [{ position_name: "Fixture Manatal Role" }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload.results) ? "Manatal Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Manatal registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "manatal",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "manatal",
    company_name: "Manatal Registry Co",
    url_string: "https://www.careers-page.com/fixtureco"
  });

  assert.deepEqual(calls, [
    ["module", "manatal"],
    ["fetchList", "manatal", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Manatal Registry Co",
    position_name: "Manatal Registry Posting"
  }]);
});

test("Teamtailor dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "teamtailor",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "teamtailor",
      source_family: "html_detail",
      list_url: "https://fixture.teamtailor.com/jobs"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { html: "<li class=\"block-grid-item\">Fixture</li>" };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.html ? "Teamtailor Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Teamtailor registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "teamtailor",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "teamtailor",
    company_name: "Teamtailor Registry Co",
    url_string: "https://fixture.teamtailor.com/jobs"
  });

  assert.deepEqual(calls, [
    ["module", "teamtailor"],
    ["fetchList", "teamtailor", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Teamtailor Registry Co",
    position_name: "Teamtailor Registry Posting"
  }]);
});

test("Freshteam dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "freshteam",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "freshteam",
      source_family: "html_detail",
      list_url: "https://fixture.freshteam.com/jobs"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { html: "<a class=\"heading\">Fixture</a>" };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.html ? "Freshteam Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Freshteam registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "freshteam",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "freshteam",
    company_name: "Freshteam Registry Co",
    url_string: "https://fixture.freshteam.com/jobs"
  });

  assert.deepEqual(calls, [
    ["module", "freshteam"],
    ["fetchList", "freshteam", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Freshteam Registry Co",
    position_name: "Freshteam Registry Posting"
  }]);
});

test("Recruitee dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "recruitee",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.quarantine,
    discover: () => ({
      ats_key: "recruitee",
      source_family: "direct_json",
      list_url: "https://fixture.recruitee.com/api/offers/"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { offers: [{ id: 1001 }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload?.offers) ? "Recruitee Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Recruitee registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "recruitee",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "recruitee.com",
    company_name: "Recruitee Registry Co",
    url_string: "https://fixture.recruitee.com"
  });

  assert.deepEqual(calls, [
    ["module", "recruitee"],
    ["fetchList", "recruitee.com", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Recruitee Registry Co",
    position_name: "Recruitee Registry Posting"
  }]);
});

test("Fountain dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "fountain",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "fountain",
      source_family: "direct_json",
      list_url: "https://web.fountain.com/c/fixtureco/jobs/board.json"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { openings: [{ id: 1001 }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload?.openings) ? "Fountain Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Fountain registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "fountain",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "fountain.com",
    company_name: "Fountain Registry Co",
    url_string: "https://web.fountain.com/c/fixtureco/jobs/board"
  });

  assert.deepEqual(calls, [
    ["module", "fountain"],
    ["fetchList", "fountain.com", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Fountain Registry Co",
    position_name: "Fountain Registry Posting"
  }]);
});

test("Applitrack dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "applitrack",
    family: SOURCE_FAMILIES.publicSectorEducation,
    status: SOURCE_STATUSES.quarantine,
    discover: () => ({
      ats_key: "applitrack",
      source_family: "public_sector",
      list_url: "https://district.applitrack.com/onlineapp/jobpostings/Output.asp?all=1"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { __legacyParsed: [{ company_name: company.company_name, position_name: "Applitrack Registry Posting" }] };
    },
    parse: (payload) => payload.__legacyParsed,
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Applitrack registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "applitrack",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "applitrack.com",
    company_name: "Applitrack Registry Co",
    url_string: "https://district.applitrack.com/onlineapp/default.aspx"
  });

  assert.deepEqual(calls, [
    ["module", "applitrack"],
    ["fetchList", "applitrack.com", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Applitrack Registry Co",
    position_name: "Applitrack Registry Posting"
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
