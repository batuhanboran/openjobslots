const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PUBLIC_SEO_ATS_PAGES,
  PUBLIC_SEO_ROUTES,
  getPublicSeoCanonicalSearchQuery,
  getPublicSeoCountryFallbackQueries,
  getPublicSeoLandingRoutesForLanguage,
  getPublicSeoLocalizedPopularQueryLabel,
  getPublicSeoPopularSearchItems,
  getPublicSeoRouteHintByPath,
  normalizePublicSeoLanguageCode
} = require("./publicSeoRoutes");

const EXPECTED_PUBLIC_LANGUAGE_CODES = [
  "en",
  "tr",
  "de",
  "fr",
  "es",
  "pt-BR",
  "pt-PT",
  "it",
  "nl",
  "pl",
  "ja",
  "ko",
  "zh-CN",
  "hi",
  "ar",
  "id",
  "sv",
  "da",
  "no",
  "fi"
];

test("SEO route hints keep localized labels but expose canonical indexed search", () => {
  const spanishSoftwareEngineer = getPublicSeoRouteHintByPath("/es/empleos-software-engineer");
  assert.equal(spanishSoftwareEngineer.searchQuery, "empleos software engineer");
  assert.equal(getPublicSeoCanonicalSearchQuery(spanishSoftwareEngineer), "software engineer");

  const spanishRemote = getPublicSeoRouteHintByPath("/es/trabajos-remotos");
  assert.equal(spanishRemote.searchQuery, "trabajos remotos");
  assert.equal(getPublicSeoCanonicalSearchQuery(spanishRemote), "remote");
});

test("SEO route titles stay unique across indexed public landing pages", () => {
  const byTitle = new Map();
  for (const route of PUBLIC_SEO_ROUTES) {
    const paths = byTitle.get(route.title) || [];
    paths.push(route.path);
    byTitle.set(route.title, paths);
  }

  const duplicates = [...byTitle.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([title, paths]) => `${title}: ${paths.join(", ")}`);
  assert.deepEqual(duplicates, []);

  assert.equal(getPublicSeoRouteHintByPath("/pt-pt/job-openings").title, "Ofertas de emprego | OpenJobSlots");
  assert.equal(getPublicSeoRouteHintByPath("/hi/devops-engineer-jobs").title, "DevOps engineer नौकरियां | OpenJobSlots");
});

test("popular SEO searches order localized landing links by canonical analytics terms", () => {
  const items = getPublicSeoPopularSearchItems("es", [
    { query: "software engineer", count: 9 },
    { query: "remote", count: 4 }
  ], 2);

  assert.deepEqual(items.map((item) => item.path), [
    "/es/empleos-software-engineer",
    "/es/trabajos-remotos"
  ]);
  assert.deepEqual(items.map((item) => item.searchQuery), [
    "software engineer",
    "remote"
  ]);
  assert.match(items[0].label, /Empleos Software Engineer/);
});

test("popular SEO searches include short live queries before static fallbacks", () => {
  const items = getPublicSeoPopularSearchItems("en", [
    { query: "remote", count: 61 },
    { query: "software", count: 26 },
    { query: "remote engineer", count: 13 },
    { query: "drone operator raptor maps inc", count: 12 },
    { query: "technical support engineer", count: 7 }
  ], 5);

  assert.deepEqual(items.map((item) => item.path), [
    "/en/remote-job-openings",
    "/en?q=software",
    "/en?q=remote%20engineer",
    "/en/technical-support-engineer-jobs",
    "/en/job-openings"
  ]);
  assert.deepEqual(items.map((item) => item.searchQuery), [
    "remote",
    "software",
    "remote engineer",
    "technical support engineer",
    "job openings"
  ]);
  assert.equal(items[1].label, "Software");
});

test("SEO landing catalog includes Semrush-seeded role intents", () => {
  assert.equal(getPublicSeoRouteHintByPath("/en/data-analyst-jobs").canonicalSearchQuery, "data analyst");
  assert.equal(getPublicSeoRouteHintByPath("/en/customer-success-manager-jobs").canonicalSearchQuery, "customer success manager");
  assert.equal(getPublicSeoRouteHintByPath("/en/devops-engineer-jobs").canonicalSearchQuery, "devops engineer");

  const items = getPublicSeoPopularSearchItems("en", [
    { query: "customer success manager", count: 18 },
    { query: "data analyst", count: 16 },
    { query: "devops engineer", count: 12 }
  ], 3);

  assert.deepEqual(items.map((item) => item.path), [
    "/en/customer-success-manager-jobs",
    "/en/data-analyst-jobs",
    "/en/devops-engineer-jobs"
  ]);
});

test("SEO landing catalog includes direct employer and hidden-jobs content intents", () => {
  assert.equal(getPublicSeoRouteHintByPath("/en/ats-job-boards").canonicalSearchQuery, "ats jobs");
  assert.equal(getPublicSeoRouteHintByPath("/en/company-career-page-jobs").canonicalSearchQuery, "company career pages jobs");
  assert.equal(getPublicSeoRouteHintByPath("/en/direct-apply-jobs").canonicalSearchQuery, "direct apply jobs");
  assert.equal(getPublicSeoRouteHintByPath("/en/hidden-jobs").canonicalSearchQuery, "hidden jobs");
  assert.equal(getPublicSeoRouteHintByPath("/en/jobs-not-on-linkedin").canonicalSearchQuery, "jobs not on linkedin");

  const items = getPublicSeoPopularSearchItems("en", [
    { query: "hidden jobs", count: 20 },
    { query: "jobs not on linkedin", count: 18 },
    { query: "ats jobs", count: 16 },
    { query: "direct apply jobs", count: 14 }
  ], 4);

  assert.deepEqual(items.map((item) => item.path), [
    "/en/hidden-jobs",
    "/en/jobs-not-on-linkedin",
    "/en/ats-job-boards",
    "/en/direct-apply-jobs"
  ]);
  assert.deepEqual(items.map((item) => item.searchQuery), [
    "hidden jobs",
    "jobs not on linkedin",
    "ats jobs",
    "direct apply jobs"
  ]);
});

test("ATS source SEO catalog expands beyond the initial five strategic pages", () => {
  assert.ok(PUBLIC_SEO_ATS_PAGES.length >= 40);
  assert.equal(getPublicSeoRouteHintByPath("/ats/icims-jobs").canonicalSearchQuery, "icims");
  assert.equal(getPublicSeoRouteHintByPath("/ats/breezy-jobs").canonicalSearchQuery, "breezy");
  assert.equal(getPublicSeoRouteHintByPath("/ats/paylocity-jobs").canonicalSearchQuery, "paylocity");
  assert.equal(getPublicSeoRouteHintByPath("/ats/adp-workforce-now-jobs").atsSourceKey, "adpworkforcenow");
  assert.ok(PUBLIC_SEO_ATS_PAGES.every((route) => String(route.path || "").startsWith("/ats/")));
});

test("SEO route catalog exposes every public language in home, landing, and hreflang groups", () => {
  const homeRoutes = PUBLIC_SEO_ROUTES.filter((route) => route.alternateGroup === "home");
  assert.deepEqual(homeRoutes.map((route) => route.languageCode), EXPECTED_PUBLIC_LANGUAGE_CODES);

  for (const languageCode of EXPECTED_PUBLIC_LANGUAGE_CODES) {
    const landingRoutes = getPublicSeoLandingRoutesForLanguage(languageCode, 20);
    assert.equal(landingRoutes.length, languageCode === "en" ? 20 : 8);
    assert.ok(landingRoutes.some((route) => route.searchIntent === "software-engineer"));
    assert.ok(landingRoutes.every((route) => route.languageCode === languageCode || String(route.path).startsWith("/ats/")));
  }

  assert.equal(normalizePublicSeoLanguageCode("pt-BR"), "pt-BR");
  assert.equal(normalizePublicSeoLanguageCode("pt-br"), "pt-BR");
  assert.equal(normalizePublicSeoLanguageCode("pt"), "pt-BR");
  assert.equal(normalizePublicSeoLanguageCode("zh-Hans-CN"), "zh-CN");
  assert.equal(getPublicSeoRouteHintByPath("/pt-br/software-engineer-jobs").languageCode, "pt-BR");
  assert.equal(getPublicSeoRouteHintByPath("/zh-cn/job-openings").languageCode, "zh-CN");
});

test("country research fallbacks preserve scoped queries for supported markets", () => {
  const countryLanguagePairs = [
    ["US", "en"],
    ["GB", "en"],
    ["TR", "tr"],
    ["DE", "de"],
    ["FR", "fr"],
    ["ES", "es"],
    ["BR", "pt-BR"],
    ["PT", "pt-PT"],
    ["IT", "it"],
    ["NL", "nl"],
    ["PL", "pl"],
    ["JP", "ja"],
    ["KR", "ko"],
    ["CN", "zh-CN"],
    ["IN", "hi"],
    ["AE", "ar"],
    ["ID", "id"],
    ["SE", "sv"],
    ["DK", "da"],
    ["NO", "no"],
    ["FI", "fi"]
  ];
  for (const [countryCode, languageCode] of countryLanguagePairs) {
    const queries = getPublicSeoCountryFallbackQueries(countryCode, languageCode, 6);
    assert.equal(queries.length, 6);
    assert.ok(queries.every((item) => item.countryCode === countryCode));
    assert.ok(queries.every((item) => item.languageCode === languageCode));
    assert.ok(queries.every((item) => typeof item.label === "string" && item.label.length > 0));
    assert.ok(queries.every((item) => item.source === "research_country_fallback"));
    assert.ok(queries.every((item) => item.trustedPopularFallback === true));
    assert.ok(queries.every((item) => Number(item.count) > 0));
  }

  assert.deepEqual(
    getPublicSeoCountryFallbackQueries("TR", "tr", 4).map((item) => item.query),
    ["remote Turkiye", "Istanbul jobs", "Ankara jobs", "Turkey software"]
  );
  assert.deepEqual(
    getPublicSeoCountryFallbackQueries("BR", "pt-br", 4).map((item) => item.query),
    ["remote Brazil", "Sao Paulo jobs", "Rio de Janeiro jobs", "software engineer Brazil"]
  );
  assert.deepEqual(
    getPublicSeoCountryFallbackQueries("ES", "es", 8).map((item) => item.label),
    [
      "Trabajos remotos en Espa\u00f1a",
      "Empleo en Madrid",
      "Empleo en Barcelona",
      "Ingeniero de software en Espa\u00f1a",
      "Analista de datos en Espa\u00f1a",
      "Atenci\u00f3n al cliente en Espa\u00f1a",
      "Gerente de producto en Espa\u00f1a",
      "Pr\u00e1cticas en Espa\u00f1a"
    ]
  );
});

test("popular SEO searches can render trusted country fallback queries", () => {
  const turkishItems = getPublicSeoPopularSearchItems(
    "tr",
    getPublicSeoCountryFallbackQueries("TR", "tr", 3),
    3,
    { trustedQueryCounts: true }
  );

  assert.deepEqual(turkishItems.map((item) => item.path), [
    "/tr?q=remote%20Turkiye",
    "/tr?q=Istanbul%20jobs",
    "/tr?q=Ankara%20jobs"
  ]);
  assert.deepEqual(turkishItems.map((item) => item.searchQuery), [
    "remote Turkiye",
    "Istanbul jobs",
    "Ankara jobs"
  ]);
  assert.deepEqual(turkishItems.map((item) => item.label), [
    "Uzaktan i\u015f ilanlar\u0131",
    "\u0130stanbul i\u015f ilanlar\u0131",
    "Ankara i\u015f ilanlar\u0131"
  ]);

  const britishItems = getPublicSeoPopularSearchItems(
    "en",
    getPublicSeoCountryFallbackQueries("GB", "en", 2),
    2,
    { trustedQueryCounts: true }
  );
  assert.deepEqual(britishItems.map((item) => item.searchQuery), ["remote jobs UK", "London jobs"]);
});

test("popular SEO country fallback query labels follow the selected language pack", () => {
  assert.equal(
    getPublicSeoLocalizedPopularQueryLabel("remote France", { languageCode: "fr", countryCode: "FR" }),
    "Emplois \u00e0 distance en France"
  );

  const frenchItems = getPublicSeoPopularSearchItems(
    "fr",
    getPublicSeoCountryFallbackQueries("FR", "fr", 4),
    4,
    { trustedQueryCounts: true, countryCode: "FR" }
  );

  assert.deepEqual(frenchItems.map((item) => item.searchQuery), [
    "remote France",
    "Paris jobs",
    "Lyon jobs",
    "software engineer France"
  ]);
  assert.deepEqual(frenchItems.map((item) => item.path), [
    "/fr?q=remote%20France",
    "/fr?q=Paris%20jobs",
    "/fr?q=Lyon%20jobs",
    "/fr?q=software%20engineer%20France"
  ]);
  assert.deepEqual(frenchItems.map((item) => item.label), [
    "Emplois \u00e0 distance",
    "Emplois \u00e0 Paris",
    "Emplois \u00e0 Lyon",
    "Emplois ing\u00e9nieur logiciel"
  ]);
  assert.ok(!frenchItems.some((item) => /France Jobs|Remote France|Engineer France|Software France/.test(item.label)));

  const japaneseItems = getPublicSeoPopularSearchItems(
    "ja",
    getPublicSeoCountryFallbackQueries("JP", "ja", 4),
    4,
    { trustedQueryCounts: true, countryCode: "JP" }
  );
  assert.deepEqual(japaneseItems.map((item) => item.searchQuery), ["remote Japan", "Tokyo jobs", "Osaka jobs", "software engineer Japan"]);
  assert.deepEqual(japaneseItems.map((item) => item.label), [
    "\u30ea\u30e2\u30fc\u30c8\u6c42\u4eba",
    "\u6771\u4eac\u306e\u6c42\u4eba",
    "\u5927\u962a\u306e\u6c42\u4eba",
    "\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u30a8\u30f3\u30b8\u30cb\u30a2\u6c42\u4eba"
  ]);
});
