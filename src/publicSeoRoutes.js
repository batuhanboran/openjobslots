function normalizePublicSeoPath(value) {
  const raw = String(value || "/").split("?")[0].split("#")[0].trim();
  const withLeadingSlash = `/${raw.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  const normalized = withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
  return normalized.toLowerCase() || "/";
}

const PUBLIC_SEO_HOME_PAGES = Object.freeze([
  {
    languageCode: "en",
    path: "/en",
    title: "Search open job slots | OpenJobSlots",
    description: "Find fresh openings across public ATS job boards. Search remote and local roles by title, company, location, and freshness."
  },
  {
    languageCode: "tr",
    path: "/tr",
    title: "İş ilanları ara | OpenJobSlots",
    description: "Herkese açık ATS iş panolarındaki güncel iş ilanlarını Türkçe arayüzle ara."
  },
  {
    languageCode: "de",
    path: "/de",
    title: "Offene Jobslots suchen | OpenJobSlots",
    description: "Finde aktuelle Stellen auf öffentlichen ATS-Jobbörsen nach Rolle, Unternehmen, Standort und Aktualität."
  },
  {
    languageCode: "fr",
    path: "/fr",
    title: "Rechercher des postes ouverts | OpenJobSlots",
    description: "Trouvez des offres récentes sur les jobboards ATS publics par poste, entreprise, lieu et fraîcheur."
  },
  {
    languageCode: "es",
    path: "/es",
    title: "Buscar puestos abiertos | OpenJobSlots",
    description: "Encuentra ofertas recientes en bolsas ATS públicas por puesto, empresa, ubicación y frescura."
  }
]);

const PUBLIC_SEO_LANDING_GROUPS = Object.freeze([
  {
    key: "job-search",
    canonicalSearchQuery: "job openings",
    pages: [
      {
        languageCode: "en",
        path: "/en/job-openings",
        searchQuery: "job openings",
        title: "Job openings | OpenJobSlots",
        description: "Search fresh job openings from public employer ATS boards by title, company, location, and posting freshness."
      },
      {
        languageCode: "tr",
        path: "/tr/is-ilanlari",
        searchQuery: "iş ilanları",
        title: "İş ilanları | OpenJobSlots",
        description: "Türkiye ve global pazarlardaki güncel iş ilanlarını title, şirket, lokasyon ve tazelik filtresiyle ara."
      },
      {
        languageCode: "de",
        path: "/de/stellenangebote",
        searchQuery: "stellenangebote",
        title: "Stellenangebote | OpenJobSlots",
        description: "Suche aktuelle Stellenangebote aus öffentlichen ATS-Jobbörsen nach Rolle, Unternehmen, Standort und Aktualität."
      },
      {
        languageCode: "fr",
        path: "/fr/offres-emploi",
        searchQuery: "offres emploi",
        title: "Offres d'emploi | OpenJobSlots",
        description: "Recherchez des offres d'emploi récentes sur des jobboards ATS publics par poste, entreprise, lieu et fraîcheur."
      },
      {
        languageCode: "es",
        path: "/es/ofertas-empleo",
        searchQuery: "ofertas empleo",
        title: "Ofertas de empleo | OpenJobSlots",
        description: "Busca ofertas de empleo recientes en bolsas ATS públicas por puesto, empresa, ubicación y frescura."
      }
    ]
  },
  {
    key: "remote",
    canonicalSearchQuery: "remote",
    pages: [
      {
        languageCode: "en",
        path: "/en/remote-job-openings",
        searchQuery: "remote job openings",
        title: "Remote job openings | OpenJobSlots",
        description: "Search fresh remote job openings from public employer ATS boards across technology, operations, sales, support, and more."
      },
      {
        languageCode: "tr",
        path: "/tr/uzaktan-calisma-ilanlari",
        searchQuery: "uzaktan çalışma ilanları",
        title: "Uzaktan çalışma ilanları | OpenJobSlots",
        description: "Türkiye ve global pazarlardaki güncel uzaktan çalışma ilanlarını ara."
      },
      {
        languageCode: "de",
        path: "/de/remote-jobs",
        searchQuery: "remote jobs",
        title: "Remote Jobs | OpenJobSlots",
        description: "Finde aktuelle Remote Jobs aus öffentlichen ATS-Jobbörsen nach Rolle, Unternehmen und Aktualität."
      },
      {
        languageCode: "fr",
        path: "/fr/offres-emploi-remote",
        searchQuery: "offres emploi remote",
        title: "Offres d'emploi remote | OpenJobSlots",
        description: "Trouvez des offres remote récentes sur des jobboards ATS publics par poste, entreprise et fraîcheur."
      },
      {
        languageCode: "es",
        path: "/es/trabajos-remotos",
        searchQuery: "trabajos remotos",
        title: "Trabajos remotos | OpenJobSlots",
        description: "Encuentra trabajos remotos recientes en bolsas ATS públicas por puesto, empresa y frescura."
      }
    ]
  },
  {
    key: "software-engineer",
    canonicalSearchQuery: "software engineer",
    pages: [
      {
        languageCode: "en",
        path: "/en/software-engineer-jobs",
        searchQuery: "software engineer jobs",
        title: "Software engineer jobs | OpenJobSlots",
        description: "Search fresh software engineer jobs from public ATS boards, including remote, hybrid, and local openings."
      },
      {
        languageCode: "tr",
        path: "/tr/yazilim-muhendisi-is-ilanlari",
        searchQuery: "yazılım mühendisi iş ilanları",
        title: "Yazılım mühendisi iş ilanları | OpenJobSlots",
        description: "Güncel yazılım mühendisi iş ilanlarını açık ATS kaynaklarından ara."
      },
      {
        languageCode: "de",
        path: "/de/software-engineer-jobs",
        searchQuery: "software engineer jobs",
        title: "Software Engineer Jobs | OpenJobSlots",
        description: "Finde aktuelle Software Engineer Jobs aus öffentlichen ATS-Jobbörsen."
      },
      {
        languageCode: "fr",
        path: "/fr/emplois-software-engineer",
        searchQuery: "emplois software engineer",
        title: "Emplois Software Engineer | OpenJobSlots",
        description: "Recherchez des emplois Software Engineer récents sur des jobboards ATS publics."
      },
      {
        languageCode: "es",
        path: "/es/empleos-software-engineer",
        searchQuery: "empleos software engineer",
        title: "Empleos Software Engineer | OpenJobSlots",
        description: "Busca empleos Software Engineer recientes en bolsas ATS públicas."
      }
    ]
  },
  {
    key: "product-manager",
    canonicalSearchQuery: "product manager",
    pages: [
      {
        languageCode: "en",
        path: "/en/product-manager-jobs",
        searchQuery: "product manager jobs",
        title: "Product manager jobs | OpenJobSlots",
        description: "Search fresh product manager jobs from public employer ATS boards by location, company, remote mode, and freshness."
      },
      {
        languageCode: "tr",
        path: "/tr/product-manager-is-ilanlari",
        searchQuery: "product manager iş ilanları",
        title: "Product manager iş ilanları | OpenJobSlots",
        description: "Güncel product manager iş ilanlarını açık ATS kaynaklarından ara."
      },
      {
        languageCode: "de",
        path: "/de/product-manager-jobs",
        searchQuery: "product manager jobs",
        title: "Product Manager Jobs | OpenJobSlots",
        description: "Finde aktuelle Product Manager Jobs aus öffentlichen ATS-Jobbörsen."
      },
      {
        languageCode: "fr",
        path: "/fr/emplois-product-manager",
        searchQuery: "emplois product manager",
        title: "Emplois Product Manager | OpenJobSlots",
        description: "Recherchez des emplois Product Manager récents sur des jobboards ATS publics."
      },
      {
        languageCode: "es",
        path: "/es/empleos-product-manager",
        searchQuery: "empleos product manager",
        title: "Empleos Product Manager | OpenJobSlots",
        description: "Busca empleos Product Manager recientes en bolsas ATS públicas."
      }
    ]
  },
  {
    key: "technical-support",
    canonicalSearchQuery: "technical support engineer",
    pages: [
      {
        languageCode: "en",
        path: "/en/technical-support-engineer-jobs",
        searchQuery: "technical support engineer jobs",
        title: "Technical support engineer jobs | OpenJobSlots",
        description: "Search fresh technical support engineer jobs from public ATS boards by company, location, remote mode, and freshness."
      },
      {
        languageCode: "tr",
        path: "/tr/teknik-destek-muhendisi-is-ilanlari",
        searchQuery: "teknik destek mühendisi iş ilanları",
        title: "Teknik destek mühendisi iş ilanları | OpenJobSlots",
        description: "Güncel teknik destek mühendisi iş ilanlarını açık ATS kaynaklarından ara."
      },
      {
        languageCode: "de",
        path: "/de/technical-support-engineer-jobs",
        searchQuery: "technical support engineer jobs",
        title: "Technical Support Engineer Jobs | OpenJobSlots",
        description: "Finde aktuelle Technical Support Engineer Jobs aus öffentlichen ATS-Jobbörsen."
      },
      {
        languageCode: "fr",
        path: "/fr/emplois-technical-support-engineer",
        searchQuery: "emplois technical support engineer",
        title: "Emplois Technical Support Engineer | OpenJobSlots",
        description: "Recherchez des emplois Technical Support Engineer récents sur des jobboards ATS publics."
      },
      {
        languageCode: "es",
        path: "/es/empleos-technical-support-engineer",
        searchQuery: "empleos technical support engineer",
        title: "Empleos Technical Support Engineer | OpenJobSlots",
        description: "Busca empleos Technical Support Engineer recientes en bolsas ATS públicas."
      }
    ]
  }
]);

const PUBLIC_SEO_ATS_PAGES = Object.freeze([
  {
    path: "/ats/greenhouse-jobs",
    searchQuery: "greenhouse jobs",
    canonicalSearchQuery: "greenhouse",
    title: "Greenhouse jobs | OpenJobSlots",
    description: "Search fresh public Greenhouse job openings indexed by OpenJobSlots."
  },
  {
    path: "/ats/lever-jobs",
    searchQuery: "lever jobs",
    canonicalSearchQuery: "lever",
    title: "Lever jobs | OpenJobSlots",
    description: "Search fresh public Lever job openings indexed by OpenJobSlots."
  },
  {
    path: "/ats/ashby-jobs",
    searchQuery: "ashby jobs",
    canonicalSearchQuery: "ashby",
    title: "Ashby jobs | OpenJobSlots",
    description: "Search fresh public Ashby job openings indexed by OpenJobSlots."
  },
  {
    path: "/ats/workday-jobs",
    searchQuery: "workday jobs",
    canonicalSearchQuery: "workday",
    title: "Workday jobs | OpenJobSlots",
    description: "Search fresh public Workday job openings indexed by OpenJobSlots."
  },
  {
    path: "/ats/bamboohr-jobs",
    searchQuery: "bamboohr jobs",
    canonicalSearchQuery: "bamboohr",
    title: "BambooHR jobs | OpenJobSlots",
    description: "Search fresh public BambooHR job openings indexed by OpenJobSlots."
  }
]);

const PUBLIC_SEO_ROUTES = Object.freeze([
  ...PUBLIC_SEO_HOME_PAGES.map((page) => ({
    ...page,
    alternateGroup: "home",
    changefreq: "daily",
    priority: "0.9"
  })),
  ...PUBLIC_SEO_LANDING_GROUPS.flatMap((group) =>
    group.pages.map((page) => ({
      ...page,
      alternateGroup: group.key,
      searchIntent: group.key,
      canonicalSearchQuery: page.canonicalSearchQuery || group.canonicalSearchQuery || page.searchQuery,
      changefreq: "daily",
      priority: "0.8"
    }))
  ),
  ...PUBLIC_SEO_ATS_PAGES.map((page) => ({
    ...page,
    languageCode: "en",
    searchIntent: `ats-${String(page.path || "").replace(/^\/ats\//, "").replace(/-jobs$/, "")}`,
    canonicalSearchQuery: page.canonicalSearchQuery || page.searchQuery,
    changefreq: "daily",
    priority: "0.7"
  }))
]);

const PUBLIC_SEO_ROUTE_BY_PATH = new Map(PUBLIC_SEO_ROUTES.map((route) => [normalizePublicSeoPath(route.path), route]));
const PUBLIC_SEO_ALTERNATE_GROUPS = new Map([
  ["home", PUBLIC_SEO_HOME_PAGES],
  ...PUBLIC_SEO_LANDING_GROUPS.map((group) => [group.key, group.pages])
]);

const SEO_LANDING_LINK_LIMIT = 8;

function normalizePublicSeoQueryKey(value) {
  return String(value || "")
    .replace(/[İı]/g, "i")
    .replace(/[Şş]/g, "s")
    .replace(/[Ğğ]/g, "g")
    .replace(/[Çç]/g, "c")
    .replace(/[Öö]/g, "o")
    .replace(/[Üü]/g, "u")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripOpenJobSlotsTitleSuffix(title) {
  return String(title || "").replace(/\s+\|\s+OpenJobSlots\s*$/i, "").trim();
}

function getPublicSeoCanonicalSearchQuery(route) {
  return String(route?.canonicalSearchQuery || route?.searchQuery || "").replace(/\s+/g, " ").trim();
}

function getPublicSeoRouteLabel(route) {
  return stripOpenJobSlotsTitleSuffix(route?.title) || String(route?.searchQuery || route?.path || "").trim();
}

function getPublicSeoLandingRoutesForLanguage(languageCode, limit = SEO_LANDING_LINK_LIMIT) {
  const normalizedLanguageCode = ["en", "tr", "de", "fr", "es"].includes(languageCode) ? languageCode : "en";
  const localizedRoutes = PUBLIC_SEO_ROUTES.filter(
    (route) => route.languageCode === normalizedLanguageCode && route.alternateGroup && route.alternateGroup !== "home"
  );
  const atsRoutes = normalizedLanguageCode === "en"
    ? PUBLIC_SEO_ROUTES.filter((route) => String(route.path || "").startsWith("/ats/")).slice(0, 3)
    : [];
  return [...localizedRoutes, ...atsRoutes].slice(0, Math.max(1, Math.min(20, Number(limit || SEO_LANDING_LINK_LIMIT))));
}

function getPublicSeoHomePathForLanguage(languageCode) {
  const normalizedLanguageCode = ["en", "tr", "de", "fr", "es"].includes(languageCode) ? languageCode : "en";
  return PUBLIC_SEO_HOME_PAGES.find((page) => page.languageCode === normalizedLanguageCode)?.path || "/en";
}

function getPublicSeoQueryLandingPath(languageCode, query) {
  const normalizedQuery = String(query || "").replace(/\s+/g, " ").trim();
  if (!normalizedQuery) return getPublicSeoHomePathForLanguage(languageCode);
  return `${getPublicSeoHomePathForLanguage(languageCode)}?q=${encodeURIComponent(normalizedQuery)}`;
}

function getPublicSeoPopularQueryLabel(query) {
  const acronyms = new Set(["ai", "api", "qa", "ui", "uk", "us", "usa", "ux"]);
  return String(query || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => {
      const lower = part.toLowerCase();
      if (acronyms.has(lower)) return lower.toUpperCase();
      return lower.slice(0, 1).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function isPublicSeoPopularQueryCandidate(query) {
  const normalized = normalizePublicSeoQueryKey(query);
  if (normalized.length < 2 || normalized.length > 64) return false;
  if (/^\d+$/.test(normalized)) return false;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (words.some((word) => word.length > 24)) return false;
  if (/\b(?:inc|llc|ltd|corp|corporation|holdings|gmbh|plc|bv|oy|ag)\b/.test(normalized)) return false;
  return true;
}

function buildPublicSeoIntentByQueryKey() {
  const byQuery = new Map();
  for (const route of PUBLIC_SEO_ROUTES) {
    const intent = String(route?.searchIntent || "").trim();
    if (!intent) continue;
    for (const query of [route.searchQuery, route.canonicalSearchQuery]) {
      const key = normalizePublicSeoQueryKey(query);
      if (key) byQuery.set(key, intent);
    }
  }
  return byQuery;
}

const PUBLIC_SEO_INTENT_BY_QUERY_KEY = buildPublicSeoIntentByQueryKey();

function getPublicSeoPopularSearchItems(languageCode, queryCounts = [], limit = SEO_LANDING_LINK_LIMIT) {
  const routes = getPublicSeoLandingRoutesForLanguage(languageCode, 20);
  const routeByIntent = new Map(routes.map((route) => [String(route.searchIntent || "").trim(), route]));
  const countByIntent = new Map();
  const countByQuery = new Map();

  for (const item of Array.isArray(queryCounts) ? queryCounts : []) {
    const query = item?.query || item?.query_normalized || item?.searchQuery || item?.value || "";
    const queryKey = normalizePublicSeoQueryKey(query);
    const count = Math.max(0, Number(item?.count || 0));
    if (!queryKey || count <= 0) continue;
    const intent = PUBLIC_SEO_INTENT_BY_QUERY_KEY.get(queryKey);
    if (intent && routeByIntent.has(intent)) {
      countByIntent.set(intent, Number(countByIntent.get(intent) || 0) + count);
      continue;
    }
    if (isPublicSeoPopularQueryCandidate(queryKey)) {
      countByQuery.set(queryKey, Number(countByQuery.get(queryKey) || 0) + count);
    }
  }

  const rankedRoutes = [...countByIntent.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([intent, count]) => ({ type: "route", route: routeByIntent.get(intent), count }));
  const rankedQueryLinks = [...countByQuery.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([query, count]) => ({
      type: "query",
      query,
      count,
      path: getPublicSeoQueryLandingPath(languageCode, query)
    }));
  const rankedItems = [...rankedRoutes, ...rankedQueryLinks]
    .sort((left, right) => right.count - left.count || String(left.route?.path || left.path).localeCompare(String(right.route?.path || right.path)));
  const seenPaths = new Set(rankedItems.map((item) => item.route?.path || item.path).filter(Boolean));
  const fallbackRoutes = routes
    .filter((route) => !seenPaths.has(route.path))
    .map((route) => ({ type: "route", route, count: 0 }));

  return [...rankedItems, ...fallbackRoutes]
    .slice(0, Math.max(1, Math.min(20, Number(limit || SEO_LANDING_LINK_LIMIT))))
    .map(({ type, route, path, query, count }) => ({
      path: type === "query" ? path : route.path,
      label: type === "query" ? getPublicSeoPopularQueryLabel(query) : getPublicSeoRouteLabel(route),
      searchIntent: type === "query" ? `query:${query}` : route.searchIntent || "",
      searchQuery: type === "query" ? query : getPublicSeoCanonicalSearchQuery(route),
      localizedSearchQuery: type === "query" ? query : String(route.searchQuery || "").trim(),
      count
    }));
}

function getPublicSeoRouteHintByPath(pathname) {
  return PUBLIC_SEO_ROUTE_BY_PATH.get(normalizePublicSeoPath(pathname)) || null;
}

function getPublicSeoAlternateGroupPages(alternateGroup) {
  const pages = PUBLIC_SEO_ALTERNATE_GROUPS.get(String(alternateGroup || ""));
  return Array.isArray(pages) ? pages : [];
}

module.exports = {
  PUBLIC_SEO_ROUTES,
  getPublicSeoCanonicalSearchQuery,
  getPublicSeoAlternateGroupPages,
  getPublicSeoLandingRoutesForLanguage,
  getPublicSeoPopularSearchItems,
  getPublicSeoRouteLabel,
  getPublicSeoRouteHintByPath,
  normalizePublicSeoPath,
  normalizePublicSeoQueryKey
};
