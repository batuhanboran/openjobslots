const assert = require("assert");
const test = require("node:test");

const {
  createSourceCollectorRuntime
} = require("./sourceCollectors");
const { SOURCE_FAMILIES, SOURCE_STATUSES } = require("./sourceContracts");
const { getSourceModule } = require("./sources");

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

test("Gem dispatches through registry source module", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "gem",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "gem",
      source_family: "direct_json",
      list_url: "https://jobs.gem.com/fixme"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return [{ test: "fixture" }];
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload) ? "Gem Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Gem registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "gem",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "gem",
    company_name: "Gem Registry Co",
    url_string: "https://jobs.gem.com/fixme"
  });

  assert.deepEqual(calls, [
    ["module", "gem"],
    ["fetchList", "gem", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Gem Registry Co",
    position_name: "Gem Registry Posting"
  }]);
});

test("Gem registry source stays idle while registry metadata is disabled", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "gem",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false,
    discover: () => ({
      ats_key: "gem",
      source_family: "direct_json",
      list_url: "https://jobs.gem.com/fixme"
    }),
    fetchList: async () => {
      calls.push(["fetchList"]);
      return [{ test: "fixture" }];
    },
    parse: () => [{
      company_name: "Gem Registry Co",
      position_name: "Unexpected Disabled Posting"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Gem disabled registry dispatch should not hit network");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "gem",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "gem",
    company_name: "Gem Registry Co",
    url_string: "https://jobs.gem.com/fixme"
  });

  assert.deepEqual(calls, [["module", "gem"]]);
  assert.deepEqual(postings, []);
});

test("Eightfold dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "eightfold",
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "eightfold",
      source_family: "enterprise_api",
      list_url: "https://fixture.eightfold.ai/careers"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { data: { positions: [{ id: "ef-1" }] } };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload?.data?.positions) ? "Eightfold Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Eightfold registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "eightfold",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "eightfold.ai",
    company_name: "Eightfold Registry Co",
    url_string: "https://fixture.eightfold.ai/careers"
  });

  assert.deepEqual(calls, [
    ["module", "eightfold"],
    ["fetchList", "eightfold.ai", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Eightfold Registry Co",
    position_name: "Eightfold Registry Posting"
  }]);
});

test("Eightfold registry source stays idle while registry metadata is disabled", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "eightfold",
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false,
    discover: () => ({
      ats_key: "eightfold",
      source_family: "enterprise_api",
      list_url: "https://fixture.eightfold.ai/careers"
    }),
    fetchList: async () => {
      calls.push(["fetchList"]);
      return { data: { positions: [{ id: "ef-1" }] } };
    },
    parse: () => [{
      company_name: "Eightfold Registry Co",
      position_name: "Unexpected Disabled Posting"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Eightfold disabled registry dispatch should not hit network");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "eightfold",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "eightfold",
    company_name: "Eightfold Registry Co",
    url_string: "https://fixture.eightfold.ai/careers"
  });

  assert.deepEqual(calls, [["module", "eightfold"]]);
  assert.deepEqual(postings, []);
});

test("Gem registry JSON arrays preserve final URL metadata for host validation", async () => {
  const gemSource = {
    ...getSourceModule("gem"),
    atsKey: "gem",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.enabled
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => createTextResponse("[]", {
      contentType: "application/json",
      url: "https://unexpected.example/api/public/graphql/batch"
    }),
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "gem",
    getRegistrySourceModule: () => gemSource
  });

  await assert.rejects(
    () => runtime.collectPostingsForCompany({
      ATS_name: "gem",
      company_name: "Gem Registry Co",
      url_string: "https://jobs.gem.com/fixme"
    }),
    /Gem API URL redirected to unexpected host/
  );
});

test("Workday dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "workday",
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "workday",
      source_family: "enterprise_api",
      list_url: "https://fixture.wd1.myworkdayjobs.com/wday/cxs/fixture/Careers/jobs"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { jobPostings: [{ jobRequisitionId: "JR9001" }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload.jobPostings) ? "Workday Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Workday registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "workday",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "workday",
    company_name: "Workday Registry Co",
    url_string: "https://fixture.wd1.myworkdayjobs.com/Careers"
  });

  assert.deepEqual(calls, [
    ["module", "workday"],
    ["fetchList", "workday", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Workday Registry Co",
    position_name: "Workday Registry Posting"
  }]);
});

test("ADP MyJobs dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "adp_myjobs",
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "adp_myjobs",
      source_family: "enterprise_api",
      list_url: "https://myjobs.adp.com/public/staffing/v1/career-site/fixture"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { jobRequisitions: [{ reqId: "REQ-9001" }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload.jobRequisitions) ? "ADP MyJobs Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("ADP MyJobs registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "adp_myjobs",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "adpmyjobs",
    company_name: "ADP Registry Co",
    url_string: "https://myjobs.adp.com/fixture/cx"
  });

  assert.deepEqual(calls, [
    ["module", "adp_myjobs"],
    ["fetchList", "adpmyjobs", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "ADP Registry Co",
    position_name: "ADP MyJobs Registry Posting"
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

test("TalentReef dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "talentreef",
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "talentreef",
      source_family: "html_detail",
      list_url: "https://apply.jobappnetwork.com/fixture"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { hits: { hits: [{ _source: { jobId: "TR-1" } }] } };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload?.hits?.hits) ? "TalentReef Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("TalentReef registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "talentreef",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "jobappnetwork.com",
    company_name: "TalentReef Registry Co",
    url_string: "https://apply.jobappnetwork.com/fixture"
  });

  assert.deepEqual(calls, [
    ["module", "talentreef"],
    ["fetchList", "jobappnetwork.com", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "TalentReef Registry Co",
    position_name: "TalentReef Registry Posting"
  }]);
});

test("TalentReef registry source stays idle while disabled", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "talentreef",
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false,
    discover: () => ({
      ats_key: "talentreef",
      source_family: "html_detail",
      list_url: "https://apply.jobappnetwork.com/fixture"
    }),
    fetchList: async () => {
      calls.push(["fetchList"]);
      return { hits: { hits: [{ _source: { jobId: "TR-1" } }] } };
    },
    parse: () => [{
      company_name: "TalentReef Registry Co",
      position_name: "Unexpected Disabled Posting"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("TalentReef disabled registry dispatch should not hit network");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "talentreef",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "talentreef",
    company_name: "TalentReef Registry Co",
    url_string: "https://apply.jobappnetwork.com/fixture"
  });

  assert.deepEqual(calls, [["module", "talentreef"]]);
  assert.deepEqual(postings, []);
});

test("BrassRing registry source stays idle while disabled", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "brassring",
    family: SOURCE_FAMILIES.brittleHighRisk,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false,
    discover: () => ({
      ats_key: "brassring",
      source_family: "brittle",
      list_url: "https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid=1&siteid=2"
    }),
    fetchList: async () => {
      calls.push(["fetchList"]);
      return { responseJson: { Jobs: { Job: [] } } };
    },
    parse: () => [{
      company_name: "BrassRing Registry Co",
      position_name: "Unexpected Disabled Posting"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("BrassRing disabled registry dispatch should not hit network");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "brassring",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "brassring",
    company_name: "BrassRing Registry Co",
    url_string: "https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?partnerid=1&siteid=2"
  });

  assert.deepEqual(calls, [["module", "brassring"]]);
  assert.deepEqual(postings, []);
});

test("HireBridge dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "hirebridge",
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "hirebridge",
      source_family: "html_detail",
      list_url: "https://recruit.hirebridge.com/v3/jobs/list.aspx?cid=1234"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return {
        html: "<ul></ul>",
        __detailHtmlByUrl: {}
      };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload?.html ? "HireBridge Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("HireBridge registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "hirebridge",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "recruit.hirebridge.com",
    company_name: "HireBridge Registry Co",
    url_string: "https://recruit.hirebridge.com/v3/jobs/list.aspx?cid=1234"
  });

  assert.deepEqual(calls, [
    ["module", "hirebridge"],
    ["fetchList", "recruit.hirebridge.com", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "HireBridge Registry Co",
    position_name: "HireBridge Registry Posting"
  }]);
});

test("HireBridge registry source stays idle while disabled", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "hirebridge",
    family: SOURCE_FAMILIES.embeddedOrSemiStructured,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false,
    discover: () => ({
      ats_key: "hirebridge",
      source_family: "html_detail",
      list_url: "https://recruit.hirebridge.com/v3/jobs/list.aspx?cid=1234"
    }),
    fetchList: async () => {
      calls.push(["fetchList"]);
      return {
        html: "<ul></ul>",
        __detailHtmlByUrl: {}
      };
    },
    parse: () => [{
      company_name: "HireBridge Registry Co",
      position_name: "Unexpected Disabled Posting"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("HireBridge disabled registry dispatch should not hit network");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "hirebridge",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "hirebridge",
    company_name: "HireBridge Registry Co",
    url_string: "https://recruit.hirebridge.com/v3/jobs/list.aspx?cid=1234"
  });

  assert.deepEqual(calls, [["module", "hirebridge"]]);
  assert.deepEqual(postings, []);
});

test("PageUp dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "pageup",
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "pageup",
      source_family: "html_detail",
      list_url: "https://careers.pageuppeople.com/123/cw/en-us"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return {
        html: "<table></table>",
        __detailHtmlByUrl: {}
      };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload?.html ? "PageUp Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("PageUp registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "pageup",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "careers.pageuppeople.com",
    company_name: "PageUp Registry Co",
    url_string: "https://careers.pageuppeople.com/123/cw/en-us"
  });

  assert.deepEqual(calls, [
    ["module", "pageup"],
    ["fetchList", "careers.pageuppeople.com", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "PageUp Registry Co",
    position_name: "PageUp Registry Posting"
  }]);
});

test("PageUp registry source stays idle while disabled", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "pageup",
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    collectWhenDisabled: false,
    discover: () => ({
      ats_key: "pageup",
      source_family: "html_detail",
      list_url: "https://careers.pageuppeople.com/123/cw/en-us"
    }),
    fetchList: async () => {
      calls.push(["fetchList"]);
      return {
        html: "<table></table>",
        __detailHtmlByUrl: {}
      };
    },
    parse: () => [{
      company_name: "PageUp Registry Co",
      position_name: "Unexpected Disabled Posting"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("PageUp disabled registry dispatch should not hit network");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "pageup",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "pageup",
    company_name: "PageUp Registry Co",
    url_string: "https://careers.pageuppeople.com/123/cw/en-us"
  });

  assert.deepEqual(calls, [["module", "pageup"]]);
  assert.deepEqual(postings, []);
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

test("UltiPro dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "ultipro",
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "ultipro",
      source_family: "enterprise_api",
      list_url: "https://recruiting.ultipro.com/ACME1000/JobBoard/11111111-1111-1111-1111-111111111111/JobBoardView/LoadSearchResults"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { opportunities: [{ Id: "OPP-9001" }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload.opportunities) ? "UltiPro Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("UltiPro registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "ultipro",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "ukg",
    company_name: "UltiPro Registry Co",
    url_string: "https://recruiting.ultipro.com/ACME1000/JobBoard/11111111-1111-1111-1111-111111111111"
  });

  assert.deepEqual(calls, [
    ["module", "ultipro"],
    ["fetchList", "ukg", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "UltiPro Registry Co",
    position_name: "UltiPro Registry Posting"
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

test("isolvisolvedhire dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "isolvisolvedhire",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "isolvisolvedhire",
      source_family: "direct_json",
      list_url: "https://fixture.isolvedhire.com/core/jobs/12345?getParams=%7B%7D"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { data: { jobs: [{ id: "iso-9001" }] } };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload?.data?.jobs) ? "isolvisolvedhire Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("isolvisolvedhire registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "isolvisolvedhire",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "isolvedhire.com",
    company_name: "Isolved Registry Co",
    url_string: "https://fixture.isolvedhire.com/jobs"
  });

  assert.deepEqual(calls, [
    ["module", "isolvisolvedhire"],
    ["fetchList", "isolvedhire.com", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Isolved Registry Co",
    position_name: "isolvisolvedhire Registry Posting"
  }]);
});

test("Jobvite dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "jobvite",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({
      ats_key: "jobvite",
      source_family: "html_detail",
      list_url: "https://jobs.jobvite.com/fixture/jobs"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { html: "<table class=\"jv-job-list\"></table>" };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: payload.html ? "Jobvite Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Jobvite registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "jobvite",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "jobvite.com",
    company_name: "Jobvite Registry Co",
    url_string: "https://jobs.jobvite.com/fixture/jobs"
  });

  assert.deepEqual(calls, [
    ["module", "jobvite"],
    ["fetchList", "jobvite.com", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Jobvite Registry Co",
    position_name: "Jobvite Registry Posting"
  }]);
});

test("SmartRecruiters dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "smartrecruiters",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "smartrecruiters",
      source_family: "direct_json",
      list_url: "https://jobs.smartrecruiters.com/sr-jobs/search?company=fixture"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return { content: [{ id: "sr-2001", name: "SmartRecruiters Registry Posting" }] };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload?.content) ? "SmartRecruiters Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("SmartRecruiters registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "smartrecruiters",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "jobs.smartrecruiters.com",
    company_name: "SmartRecruiters Registry Co",
    url_string: "https://jobs.smartrecruiters.com/fixture/search?company=fixture"
  });

  assert.deepEqual(calls, [
    ["module", "smartrecruiters"],
    ["fetchList", "jobs.smartrecruiters.com", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "SmartRecruiters Registry Co",
    position_name: "SmartRecruiters Registry Posting"
  }]);
});

test("Paylocity dispatches through registry source module instead of legacy collector", async () => {
  const calls = [];
  const registrySource = {
    atsKey: "paylocity",
    family: SOURCE_FAMILIES.enterpriseDirect,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({
      ats_key: "paylocity",
      source_family: "enterprise_api",
      list_url: "https://recruiting.paylocity.com/recruiting/jobs/All/fixtureco"
    }),
    fetchList: async (company, options) => {
      calls.push(["fetchList", company.ATS_name, typeof options.fetcher]);
      return {
        Jobs: [{ JobId: "PL-9001", JobTitle: "Payroll Operations" }],
        __sourceConfig: { companyId: "fixtureco" },
        __sourceFetchFinalUrl: "https://recruiting.paylocity.com/recruiting/jobs/All/fixtureco"
      };
    },
    parse: (payload, company) => [{
      company_name: company.company_name,
      position_name: Array.isArray(payload.Jobs) ? "Paylocity Registry Posting" : "Unexpected Payload"
    }],
    normalize: () => null,
    validate: () => ({ ok: true })
  };
  const runtime = createSourceCollectorRuntime({
    fetchWithAtsRateLimit: async () => {
      throw new Error("Paylocity registry dispatch should not hit legacy network code");
    },
    getPostingLocationByJobUrl: () => new Map(),
    isRegistryPilotSource: (atsKey) => atsKey === "paylocity",
    getRegistrySourceModule: (atsKey) => {
      calls.push(["module", atsKey]);
      return registrySource;
    }
  });

  const postings = await runtime.collectPostingsForCompany({
    ATS_name: "paylocity",
    company_name: "Paylocity Registry Co",
    url_string: "https://recruiting.paylocity.com/recruiting/jobs/All/fixtureco"
  });

  assert.deepEqual(calls, [
    ["module", "paylocity"],
    ["fetchList", "paylocity", "function"]
  ]);
  assert.deepEqual(postings, [{
    company_name: "Paylocity Registry Co",
    position_name: "Paylocity Registry Posting"
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
