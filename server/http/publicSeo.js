const {
  PUBLIC_SEO_ROUTES,
  getPublicSeoAlternateGroupPages,
  getPublicSeoRouteHintByPath,
  normalizePublicSeoPath
} = require("../../src/publicSeoRoutes");

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripOpenJobSlotsTitleSuffix(value) {
  return normalizeInlineText(value).replace(/\s+\|\s+OpenJobSlots\s*$/i, "").trim();
}

const SEO_FALLBACK_COPY_BY_LANGUAGE = Object.freeze({
  en: {
    relatedLabel: "Related public job search pages",
    paragraphIntro: ({ heading, description }) =>
      `${heading} is a crawlable OpenJobSlots landing page for people and search engines that need a stable entry point before the interactive search app loads. ${description}`,
    paragraphCoverage: ({ searchQuery }) =>
      `OpenJobSlots focuses on fresh public employer ATS boards and keeps the public surface search-first. This page helps visitors start with ${searchQuery || "job openings"} and then narrow results by role, company, location, country, region, remote mode, source platform, and posting freshness. The app is built around public posting fields only, so search engines see useful page context without exposing admin controls, private diagnostics, parser payloads, or internal infrastructure details.`,
    paragraphQuality: () =>
      "The index treats employer links as canonical source evidence and keeps Meilisearch as a derived search layer while Postgres remains the source of truth. Ambiguous source data is not promoted as fake location, date, remote, or company evidence. That means public pages can describe the search intent, the filters, and the source families while the ingestion pipeline continues to validate each posting through parser-backed evidence before it becomes searchable.",
    paragraphNavigation: () =>
      "Use the links below to move between localized job-search intents and high-value ATS source pages. They are included as plain HTML in the fallback so crawlers can discover the same curated public routes that appear in the XML sitemap. When JavaScript is available, the interactive interface adds suggestions, filters, result counts, and current posting cards on top of this crawlable foundation.",
    faqLabel: "Search FAQ",
    faqItems: ({ searchQuery }) => [
      {
        question: `What can I find on this ${searchQuery || "job search"} page?`,
        answer: `This page is a stable entry point for searching fresh ${searchQuery || "job openings"} across public employer ATS boards. Results can be narrowed inside the app by title, company, location, country, region, remote mode, source platform, and posting freshness.`
      },
      {
        question: "Where do the listings come from?",
        answer: "OpenJobSlots indexes public employer career pages and ATS boards, then normalizes public posting fields into one searchable schema. Employer job links remain the canonical source for each posting."
      },
      {
        question: "How does OpenJobSlots handle uncertain source data?",
        answer: "Unclear location, date, remote, or source-id evidence is not promoted as a fake public value. Ambiguous postings stay conservative while parser-backed evidence continues to improve search quality."
      }
    ]
  },
  tr: {
    relatedLabel: "İlgili herkese açık iş arama sayfaları",
    paragraphIntro: ({ heading, description }) =>
      `${heading}, etkileşimli arama uygulaması yüklenmeden önce kullanıcılar ve arama motorları için sabit bir OpenJobSlots giriş sayfasıdır. ${description}`,
    paragraphCoverage: ({ searchQuery }) =>
      `OpenJobSlots herkese açık işveren ATS panolarındaki güncel ilanlara odaklanır ve public yüzeyi arama öncelikli tutar. Bu sayfa ziyaretçilerin ${searchQuery || "iş ilanları"} aramasıyla başlamasına, sonra rol, şirket, lokasyon, ülke, bölge, uzaktan çalışma modu, kaynak platform ve ilan tazeliği filtreleriyle sonuçları daraltmasına yardımcı olur. Uygulama yalnızca public ilan alanlarını gösterir; yönetim kontrolleri, özel tanılar, ham parser çıktıları ve dahili altyapı ayrıntıları arama motorlarına açılmaz.`,
    paragraphQuality: () =>
      "Dizin, işveren bağlantılarını kanonik kaynak kanıtı olarak korur ve Meilisearch katmanını türetilmiş arama indeksi olarak kullanırken Postgres kaynak gerçekliğini taşır. Belirsiz kaynak verisi sahte lokasyon, tarih, remote durumu veya şirket kanıtı olarak yayınlanmaz. Böylece public sayfalar arama niyetini, filtreleri ve kaynak ailelerini açıklarken ingestion hattı her ilanı parser destekli kanıtla doğrulamaya devam eder.",
    paragraphNavigation: () =>
      "Aşağıdaki bağlantılar yerelleştirilmiş iş arama niyetleri ve yüksek değerli ATS kaynak sayfaları arasında geçiş sağlar. Bu bağlantılar düz HTML fallback içinde yer aldığı için crawler'lar XML sitemap içinde bulunan aynı seçilmiş public rotaları keşfedebilir. JavaScript kullanılabildiğinde etkileşimli arayüz bu taranabilir temel üzerine öneriler, filtreler, sonuç sayıları ve güncel ilan kartları ekler.",
    faqLabel: "Arama soruları",
    faqItems: ({ searchQuery }) => [
      {
        question: `Bu ${searchQuery || "iş arama"} sayfasında ne bulabilirim?`,
        answer: `Bu sayfa, açık işveren ATS panolarındaki güncel ${searchQuery || "iş ilanları"} için sabit bir arama girişidir. Uygulamada sonuçlar title, şirket, lokasyon, ülke, bölge, remote mod, kaynak platform ve ilan tazeliğine göre daraltılabilir.`
      },
      {
        question: "İlanlar nereden geliyor?",
        answer: "OpenJobSlots herkese açık işveren kariyer sayfalarını ve ATS panolarını indeksler, sonra public ilan alanlarını tek bir aranabilir şemaya normalize eder. Her ilan için işveren bağlantısı kanonik kaynak olarak kalır."
      },
      {
        question: "Belirsiz kaynak verisi nasıl ele alınır?",
        answer: "Belirsiz lokasyon, tarih, remote veya source-id kanıtı sahte public değer olarak yayınlanmaz. Ambiguous ilanlar konservatif tutulur; parser destekli kanıt arttıkça arama kalitesi iyileştirilir."
      }
    ]
  },
  de: {
    relatedLabel: "Verwandte öffentliche Jobsuchseiten",
    paragraphIntro: ({ heading, description }) =>
      `${heading} ist eine crawlbare OpenJobSlots-Landingpage für Nutzer und Suchmaschinen, die einen stabilen Einstieg benötigen, bevor die interaktive Suche geladen ist. ${description}`,
    paragraphCoverage: ({ searchQuery }) =>
      `OpenJobSlots konzentriert sich auf aktuelle öffentliche Arbeitgeber-ATS-Jobbörsen und hält die öffentliche Oberfläche konsequent suchorientiert. Diese Seite hilft Besuchern, mit ${searchQuery || "Stellenangeboten"} zu starten und Ergebnisse anschließend nach Rolle, Unternehmen, Standort, Land, Region, Remote-Modus, Quellplattform und Veröffentlichungsfrische einzugrenzen. Die Anwendung zeigt nur öffentliche Stellendaten, damit Suchmaschinen hilfreichen Kontext erhalten, ohne Administrationsfunktionen, private Diagnosen, Parser-Rohdaten oder interne Infrastrukturdetails zu sehen.`,
    paragraphQuality: () =>
      "Der Index behandelt Arbeitgeberlinks als kanonischen Quellnachweis und nutzt Meilisearch als abgeleitete Suchebene, während Postgres die Quelle der Wahrheit bleibt. Mehrdeutige Quelldaten werden nicht als erfundener Standort, erfundenes Datum, Remote-Status oder Unternehmensnachweis veröffentlicht. So können öffentliche Seiten die Suchabsicht, Filter und Quellfamilien erklären, während die Ingestion-Pipeline jede Stelle weiterhin mit parsergestützter Evidenz validiert, bevor sie durchsuchbar wird.",
    paragraphNavigation: () =>
      "Die folgenden Links verbinden lokalisierte Suchintentionen mit wichtigen ATS-Quellseiten. Sie stehen als einfaches HTML im Fallback, damit Crawler dieselben kuratierten öffentlichen Routen entdecken können, die auch in der XML-Sitemap stehen. Wenn JavaScript verfügbar ist, ergänzt die interaktive Oberfläche diese crawlbare Basis um Vorschläge, Filter, Ergebniszahlen und aktuelle Stellenkarten.",
    faqLabel: "Suchfragen",
    faqItems: ({ searchQuery }) => [
      {
        question: `Was finde ich auf dieser Seite für ${searchQuery || "Jobsuche"}?`,
        answer: `Diese Seite ist ein stabiler Einstieg für aktuelle ${searchQuery || "Stellenangebote"} aus öffentlichen Arbeitgeber-ATS-Jobbörsen. In der App lassen sich Ergebnisse nach Rolle, Unternehmen, Standort, Land, Region, Remote-Modus, Quellplattform und Veröffentlichungsfrische filtern.`
      },
      {
        question: "Woher stammen die Stellenanzeigen?",
        answer: "OpenJobSlots indexiert öffentliche Arbeitgeber-Karriereseiten und ATS-Jobbörsen und normalisiert öffentliche Stellendaten in ein gemeinsames Suchschema. Arbeitgeberlinks bleiben die kanonische Quelle jeder Anzeige."
      },
      {
        question: "Wie geht OpenJobSlots mit unsicheren Quelldaten um?",
        answer: "Unklare Standort-, Datums-, Remote- oder Source-ID-Daten werden nicht als erfundene öffentliche Werte veröffentlicht. Mehrdeutige Anzeigen bleiben konservativ, bis parsergestützte Evidenz die Suchqualität verbessert."
      }
    ]
  },
  fr: {
    relatedLabel: "Pages publiques de recherche d'emploi liées",
    paragraphIntro: ({ heading, description }) =>
      `${heading} est une page d'entrée OpenJobSlots explorable par les moteurs et utile aux visiteurs avant le chargement de l'application de recherche interactive. ${description}`,
    paragraphCoverage: ({ searchQuery }) =>
      `OpenJobSlots se concentre sur les jobboards ATS publics des employeurs et garde la surface publique orientée recherche. Cette page aide les visiteurs à commencer avec ${searchQuery || "des offres d'emploi"}, puis à affiner les résultats par poste, entreprise, lieu, pays, région, mode remote, plateforme source et fraîcheur de publication. L'application expose uniquement des champs publics de postes; les contrôles d'administration, diagnostics privés, charges brutes de parsing et détails internes d'infrastructure ne sont pas publiés aux moteurs de recherche.`,
    paragraphQuality: () =>
      "L'index traite les liens employeur comme des preuves sources canoniques et utilise Meilisearch comme couche de recherche dérivée, tandis que Postgres reste la source de vérité. Les données ambiguës ne sont pas promues comme faux lieu, fausse date, statut remote ou preuve d'entreprise. Les pages publiques peuvent donc expliquer l'intention de recherche, les filtres et les familles de sources pendant que le pipeline d'ingestion valide chaque poste avec une preuve issue du parser avant son indexation.",
    paragraphNavigation: () =>
      "Les liens ci-dessous relient les intentions de recherche localisées aux pages de sources ATS importantes. Ils sont présents en HTML simple dans le fallback afin que les crawlers découvrent les mêmes routes publiques sélectionnées que dans le sitemap XML. Lorsque JavaScript est disponible, l'interface interactive ajoute suggestions, filtres, compteurs de résultats et cartes d'offres récentes sur cette base explorable.",
    faqLabel: "Questions de recherche",
    faqItems: ({ searchQuery }) => [
      {
        question: `Que trouver sur cette page ${searchQuery || "de recherche d'emploi"} ?`,
        answer: `Cette page sert d'entrée stable pour rechercher des ${searchQuery || "offres d'emploi"} récentes issues de jobboards ATS publics d'employeurs. Dans l'application, les résultats peuvent être filtrés par poste, entreprise, lieu, pays, région, mode remote, plateforme source et fraîcheur de publication.`
      },
      {
        question: "D'où viennent les offres ?",
        answer: "OpenJobSlots indexe des pages carrières publiques d'employeurs et des jobboards ATS, puis normalise les champs publics dans un schéma de recherche commun. Les liens employeur restent la source canonique de chaque offre."
      },
      {
        question: "Comment les données sources incertaines sont-elles traitées ?",
        answer: "Les lieux, dates, statuts remote ou identifiants source incertains ne sont pas publiés comme valeurs inventées. Les offres ambiguës restent conservatrices pendant que la preuve issue des parsers améliore la qualité de recherche."
      }
    ]
  },
  es: {
    relatedLabel: "Páginas públicas relacionadas de búsqueda de empleo",
    paragraphIntro: ({ heading, description }) =>
      `${heading} es una página de entrada rastreable de OpenJobSlots para personas y buscadores antes de que cargue la aplicación interactiva de búsqueda. ${description}`,
    paragraphCoverage: ({ searchQuery }) =>
      `OpenJobSlots se centra en bolsas ATS públicas de empleadores y mantiene la superficie pública orientada a la búsqueda. Esta página ayuda a empezar con ${searchQuery || "ofertas de empleo"} y después filtrar por rol, empresa, ubicación, país, región, modalidad remota, plataforma de origen y frescura de publicación. La aplicación expone solo campos públicos de las vacantes, por lo que los buscadores reciben contexto útil sin controles administrativos, diagnósticos privados, cargas crudas de parsers ni detalles internos de infraestructura.`,
    paragraphQuality: () =>
      "El índice trata los enlaces del empleador como evidencia canónica de origen y usa Meilisearch como capa derivada de búsqueda, mientras Postgres conserva la fuente de verdad. Los datos ambiguos no se publican como ubicación, fecha, estado remoto o empresa inventados. Así, las páginas públicas pueden describir la intención de búsqueda, los filtros y las familias de fuentes mientras el pipeline de ingesta valida cada vacante con evidencia respaldada por parsers antes de hacerla buscable.",
    paragraphNavigation: () =>
      "Los enlaces siguientes conectan intenciones de búsqueda localizadas con páginas valiosas de fuentes ATS. Están incluidos como HTML simple en el fallback para que los crawlers descubran las mismas rutas públicas curadas que aparecen en el sitemap XML. Cuando JavaScript está disponible, la interfaz interactiva añade sugerencias, filtros, conteos de resultados y tarjetas de vacantes actuales sobre esta base rastreable.",
    faqLabel: "Preguntas de búsqueda",
    faqItems: ({ searchQuery }) => [
      {
        question: `¿Qué puedo encontrar en esta página de ${searchQuery || "búsqueda de empleo"}?`,
        answer: `Esta página es una entrada estable para buscar ${searchQuery || "ofertas de empleo"} recientes en bolsas ATS públicas de empleadores. En la aplicación, los resultados se pueden filtrar por rol, empresa, ubicación, país, región, modalidad remota, plataforma fuente y frescura de publicación.`
      },
      {
        question: "¿De dónde salen las ofertas?",
        answer: "OpenJobSlots indexa páginas públicas de carreras de empleadores y bolsas ATS, y normaliza los campos públicos en un esquema de búsqueda común. Los enlaces del empleador siguen siendo la fuente canónica de cada oferta."
      },
      {
        question: "¿Cómo se tratan los datos inciertos?",
        answer: "Los datos ambiguos de ubicación, fecha, modalidad remota o source-id no se publican como valores inventados. Las ofertas ambiguas se mantienen conservadoras mientras la evidencia de parsers mejora la calidad de búsqueda."
      }
    ]
  }
});

function getSeoHeadingFromTitle(value) {
  const normalized = normalizeInlineText(value);
  if (/^OpenJobSlots\s+\|/i.test(normalized)) return "OpenJobSlots";
  return stripOpenJobSlotsTitleSuffix(normalized);
}

function escapeMarkdownLinkText(value) {
  return normalizeInlineText(value).replace(/[\[\]]/g, "");
}

function removeExistingSeoTags(html) {
  return String(html || "")
    .replace(/\s*<meta[^>]+name=["'](?:description|robots|twitter:card|twitter:title|twitter:description)["'][^>]*>/gi, "")
    .replace(/\s*<meta[^>]+property=["'](?:og:title|og:description|og:type|og:url|og:site_name)["'][^>]*>/gi, "")
    .replace(/\s*<link[^>]+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/\s*<link[^>]+rel=["']alternate["'][^>]*hreflang=["'][^"']+["'][^>]*>/gi, "")
    .replace(/\s*<style[^>]+id=["']openjobslots-static-seo-style["'][^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\s*<script[^>]+id=["']openjobslots-(?:organization|website|webpage|breadcrumb)-jsonld["'][^>]*>[\s\S]*?<\/script>/gi, "");
}

function stringifyJsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function sanitizeSearchQuery(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 2) return "";
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(normalized)) return "";
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(normalized)) return "";
  return normalized.slice(0, 80);
}

function getRequestPath(req) {
  return normalizePublicSeoPath(req?.path || req?.originalUrl || req?.url || "/");
}

function createPublicSeoHelpers(dependencies = {}) {
  const {
    buildPublicWebAnalyticsHeadTags = () => "",
    nodeEnv = "development",
    port = 8787,
    publicSiteUrl = "",
    readPublicWebAnalyticsConfig = () => ({}),
    seoDescription = "",
    seoTitle = "OpenJobSlots",
    stripPublicWebAnalyticsHeadTags = (html) => String(html || "")
  } = dependencies;

  function getPublicSiteOrigin(req) {
    const configured = normalizeOrigin(publicSiteUrl);
    if (configured) return configured;
    if (nodeEnv === "production") return "https://openjobslots.com";

    const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
    const forwardedHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol || "http";
    const host = forwardedHost || req.get("host") || `localhost:${port}`;
    return normalizeOrigin(`${protocol}://${host}`) || `http://localhost:${port}`;
  }

  function getSeoRoute(req) {
    return getPublicSeoRouteHintByPath(getRequestPath(req));
  }

  function getPublicSiteCanonicalUrl(req) {
    const seoRoute = getSeoRoute(req);
    if (seoRoute) return `${getPublicSiteOrigin(req)}${seoRoute.path}`;
    const searchQuery = sanitizeSearchQuery(req?.query?.q || req?.query?.search || "");
    if (!searchQuery) return `${getPublicSiteOrigin(req)}/`;
    return `${getPublicSiteOrigin(req)}/?q=${encodeURIComponent(searchQuery)}`;
  }

  function getPublicSearchLandingUrl(req, searchTerm) {
    const searchQuery = sanitizeSearchQuery(searchTerm);
    if (!searchQuery) return "";
    return `${getPublicSiteOrigin(req)}/?q=${encodeURIComponent(searchQuery)}`;
  }

  function getSeoMeta(req) {
    const seoRoute = getSeoRoute(req);
    if (seoRoute) {
      return {
        title: seoRoute.title,
        description: seoRoute.description,
        languageCode: seoRoute.languageCode || "en"
      };
    }
    const searchQuery = sanitizeSearchQuery(req?.query?.q || req?.query?.search || "");
    if (!searchQuery) {
      return {
        title: String(seoTitle || "OpenJobSlots").trim(),
        description: String(seoDescription || "").trim(),
        languageCode: "en"
      };
    }
    return {
      title: `${searchQuery} jobs | OpenJobSlots`,
      description: `Search fresh ${searchQuery} job slots from public employer ATS boards.`,
      languageCode: "en"
    };
  }

  function getSeoFallbackCopy(languageCode) {
    return SEO_FALLBACK_COPY_BY_LANGUAGE[languageCode] || SEO_FALLBACK_COPY_BY_LANGUAGE.en;
  }

  function getPublicSeoAlternateLinks(req) {
    const seoRoute = getSeoRoute(req);
    const requestPath = getRequestPath(req);
    const alternateGroup = seoRoute?.alternateGroup || (requestPath === "/" ? "home" : "");
    return getPublicSeoAlternateLinksForGroup(getPublicSiteOrigin(req), alternateGroup);
  }

  function getPublicSeoAlternateLinksForGroup(siteOrigin, alternateGroup) {
    const groupPages = getPublicSeoAlternateGroupPages(alternateGroup);
    if (groupPages.length === 0) return [];
    const links = groupPages.map((page) => ({
      hreflang: page.languageCode,
      href: `${siteOrigin}${page.path}`
    }));
    const xDefaultPath = alternateGroup === "home" ? "/" : groupPages.find((page) => page.languageCode === "en")?.path;
    if (xDefaultPath) {
      links.push({
        hreflang: "x-default",
        href: `${siteOrigin}${xDefaultPath}`
      });
    }
    return links;
  }

  function buildAlternateLanguageLinkTags(req) {
    return getPublicSeoAlternateLinks(req)
      .map((item) =>
        '<link rel="alternate" hreflang="' +
        escapeHtmlAttribute(item.hreflang) +
        '" href="' +
        escapeHtmlAttribute(item.href) +
        '" />'
      )
      .join("\n    ");
  }

  function buildStructuredDataTags(req) {
    const siteOrigin = getPublicSiteOrigin(req);
    const siteUrl = `${siteOrigin}/`;
    const canonicalUrl = getPublicSiteCanonicalUrl(req);
    const seoRoute = getSeoRoute(req);
    const seoMeta = getSeoMeta(req);
    const heading = getSeoHeadingFromTitle(seoMeta.title) || "OpenJobSlots";
    const description = String(seoMeta.description || seoDescription || "").trim();
    const organization = {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${siteOrigin}/#organization`,
      name: "OpenJobSlots",
      url: siteUrl,
      logo: `${siteOrigin}/favicon.ico`
    };
    const website = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${siteOrigin}/#website`,
      name: "OpenJobSlots",
      url: siteUrl,
      description,
      inLanguage: seoMeta.languageCode || "en",
      publisher: {
        "@id": organization["@id"]
      },
      potentialAction: {
        "@type": "SearchAction",
        target: `${siteOrigin}/?q={search_term_string}`,
        "query-input": "required name=search_term_string"
      }
    };
    const webpage = {
      "@context": "https://schema.org",
      "@type": seoRoute ? "CollectionPage" : "WebPage",
      "@id": `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: heading,
      description,
      inLanguage: seoMeta.languageCode || "en",
      isPartOf: {
        "@id": website["@id"]
      },
      publisher: {
        "@id": organization["@id"]
      }
    };
    const breadcrumbItems = [
      {
        "@type": "ListItem",
        position: 1,
        name: "OpenJobSlots",
        item: siteUrl
      }
    ];
    if (canonicalUrl !== siteUrl) {
      breadcrumbItems.push({
        "@type": "ListItem",
        position: 2,
        name: heading,
        item: canonicalUrl
      });
    }
    const breadcrumb = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "@id": `${canonicalUrl}#breadcrumb`,
      itemListElement: breadcrumbItems
    };
    webpage.breadcrumb = {
      "@id": breadcrumb["@id"]
    };

    return [
      '<script type="application/ld+json" id="openjobslots-organization-jsonld">' + stringifyJsonLd(organization) + "</script>",
      '<script type="application/ld+json" id="openjobslots-website-jsonld">' + stringifyJsonLd(website) + "</script>",
      '<script type="application/ld+json" id="openjobslots-webpage-jsonld">' + stringifyJsonLd(webpage) + "</script>",
      '<script type="application/ld+json" id="openjobslots-breadcrumb-jsonld">' + stringifyJsonLd(breadcrumb) + "</script>"
    ].join("\n    ");
  }

  function getStaticSeoFallbackLinks(req) {
    const seoMeta = getSeoMeta(req);
    const languageCode = seoMeta.languageCode || "en";
    const currentPath = getRequestPath(req);
    const currentLanguageRoutes = PUBLIC_SEO_ROUTES.filter(
      (route) => route.languageCode === languageCode && route.alternateGroup && route.alternateGroup !== "home"
    );
    const homeRoutes = PUBLIC_SEO_ROUTES.filter((route) => route.alternateGroup === "home");
    const atsRoutes = PUBLIC_SEO_ROUTES.filter((route) => String(route.path || "").startsWith("/ats/"));
    const remainingRoutes = PUBLIC_SEO_ROUTES.filter((route) => ![
      ...currentLanguageRoutes,
      ...homeRoutes,
      ...atsRoutes
    ].some((item) => item.path === route.path));
    const orderedRoutes = [
      ...currentLanguageRoutes,
      ...homeRoutes,
      ...atsRoutes,
      ...remainingRoutes
    ];
    const seen = new Set();
    return orderedRoutes.filter((route) => {
      if (!route?.path || route.path === currentPath || seen.has(route.path)) return false;
      seen.add(route.path);
      return true;
    });
  }

  function buildStaticSeoFallbackParagraphs(req, heading, description) {
    const seoMeta = getSeoMeta(req);
    const seoRoute = getSeoRoute(req);
    const languageCode = seoMeta.languageCode || "en";
    const copy = getSeoFallbackCopy(languageCode);
    const searchQuery = normalizeInlineText(seoRoute?.canonicalSearchQuery || seoRoute?.searchQuery || heading);
    const values = { heading, description, searchQuery };
    return [
      copy.paragraphIntro(values),
      copy.paragraphCoverage(values),
      copy.paragraphQuality(values),
      copy.paragraphNavigation(values)
    ].map(normalizeInlineText).filter(Boolean);
  }

  function buildStaticSeoFaqItems(req, heading, description) {
    const seoMeta = getSeoMeta(req);
    const seoRoute = getSeoRoute(req);
    const languageCode = seoMeta.languageCode || "en";
    const copy = getSeoFallbackCopy(languageCode);
    const searchQuery = normalizeInlineText(seoRoute?.canonicalSearchQuery || seoRoute?.searchQuery || heading);
    const values = { heading, description, searchQuery };
    const items = typeof copy.faqItems === "function" ? copy.faqItems(values) : SEO_FALLBACK_COPY_BY_LANGUAGE.en.faqItems(values);
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        question: normalizeInlineText(item?.question || ""),
        answer: normalizeInlineText(item?.answer || "")
      }))
      .filter((item) => item.question && item.answer);
  }

  function buildStaticSeoFallback(req) {
    const siteOrigin = getPublicSiteOrigin(req);
    const seoMeta = getSeoMeta(req);
    const languageCode = seoMeta.languageCode || "en";
    const copy = getSeoFallbackCopy(languageCode);
    const heading = getSeoHeadingFromTitle(seoMeta.title) || "OpenJobSlots";
    const description = normalizeInlineText(seoMeta.description || seoDescription);
    const paragraphs = buildStaticSeoFallbackParagraphs(req, heading, description)
      .map((paragraph) => "    <p>" + escapeHtmlAttribute(paragraph) + "</p>")
      .join("\n");
    const faqItems = buildStaticSeoFaqItems(req, heading, description)
      .map((item) => [
        "      <dt>" + escapeHtmlAttribute(item.question) + "</dt>",
        "      <dd>" + escapeHtmlAttribute(item.answer) + "</dd>"
      ].join("\n"))
      .join("\n");
    const links = getStaticSeoFallbackLinks(req)
      .map((route) => {
        const label = stripOpenJobSlotsTitleSuffix(route.title) || route.searchQuery || route.path;
        return [
          "        <li>",
          '<a href="' + escapeHtmlAttribute(`${siteOrigin}${route.path}`) + '">',
          escapeHtmlAttribute(label),
          "</a>",
          "</li>"
        ].join("");
      })
      .join("\n");

    return [
      "<noscript>",
      '  <main id="openjobslots-seo-fallback">',
      "    <h1>" + escapeHtmlAttribute(heading) + "</h1>",
      paragraphs,
      '    <nav aria-label="' + escapeHtmlAttribute(copy.relatedLabel) + '">',
      "      <ul>",
      links,
      "      </ul>",
      "    </nav>",
      '    <section aria-label="' + escapeHtmlAttribute(copy.faqLabel || "Search FAQ") + '">',
      "      <h2>" + escapeHtmlAttribute(copy.faqLabel || "Search FAQ") + "</h2>",
      "      <dl>",
      faqItems,
      "      </dl>",
      "    </section>",
      "  </main>",
      "</noscript>"
    ].join("\n");
  }

  function buildStaticSeoContent(req) {
    const siteOrigin = getPublicSiteOrigin(req);
    const seoMeta = getSeoMeta(req);
    const languageCode = seoMeta.languageCode || "en";
    const copy = getSeoFallbackCopy(languageCode);
    const heading = getSeoHeadingFromTitle(seoMeta.title) || "OpenJobSlots";
    const description = normalizeInlineText(seoMeta.description || seoDescription);
    const searchLabel = stripOpenJobSlotsTitleSuffix(heading) || heading;
    const paragraphs = buildStaticSeoFallbackParagraphs(req, heading, description);
    const faqItems = buildStaticSeoFaqItems(req, heading, description);
    const links = getStaticSeoFallbackLinks(req);
    const primaryLinks = links.slice(0, 12);
    const sourceLinks = links
      .filter((route) => String(route.path || "").startsWith("/ats/"))
      .slice(0, 8);

    function htmlLinkList(routes) {
      return routes
        .map((route) => {
          const label = stripOpenJobSlotsTitleSuffix(route.title) || route.searchQuery || route.path;
          const summary = normalizeInlineText(route.description || "");
          return [
            "            <li>",
            '<a href="' + escapeHtmlAttribute(`${siteOrigin}${route.path}`) + '">',
            escapeHtmlAttribute(label),
            "</a>",
            summary ? '<span> ' + escapeHtmlAttribute(summary) + "</span>" : "",
            "</li>"
          ].join("");
        })
        .join("\n");
    }

    return [
      '<main id="openjobslots-static-seo-content" aria-label="' + escapeHtmlAttribute(`${searchLabel} search context`) + '">',
      '  <section class="openjobslots-seo-band" aria-labelledby="openjobslots-static-seo-heading">',
      '    <article class="openjobslots-seo-copy">',
      '      <h2 id="openjobslots-static-seo-heading">' + escapeHtmlAttribute(heading) + "</h2>",
      ...paragraphs.map((paragraph) => "      <p>" + escapeHtmlAttribute(paragraph) + "</p>"),
      "    </article>",
      '    <aside class="openjobslots-seo-aside" aria-label="' + escapeHtmlAttribute(copy.relatedLabel) + '">',
      "      <h3>" + escapeHtmlAttribute(copy.relatedLabel) + "</h3>",
      "      <nav>",
      "        <ul>",
      htmlLinkList(primaryLinks),
      "        </ul>",
      "      </nav>",
      "    </aside>",
      "  </section>",
      '  <section class="openjobslots-seo-faq" aria-labelledby="openjobslots-static-seo-faq-heading">',
      '    <h3 id="openjobslots-static-seo-faq-heading">' + escapeHtmlAttribute(copy.faqLabel || "Search FAQ") + "</h3>",
      "    <dl>",
      ...faqItems.flatMap((item) => [
        "      <dt>" + escapeHtmlAttribute(item.question) + "</dt>",
        "      <dd>" + escapeHtmlAttribute(item.answer) + "</dd>"
      ]),
      "    </dl>",
      "  </section>",
      '  <footer class="openjobslots-seo-footer" aria-label="OpenJobSlots ATS source pages">',
      "    <h3>ATS source job pages</h3>",
      "    <ul>",
      htmlLinkList(sourceLinks),
      "    </ul>",
      "  </footer>",
      "</main>"
    ].join("\n");
  }

  function replaceStaticSeoContent(html, req) {
    const content = buildStaticSeoContent(req);
    if (/<main\b[^>]+id=["']openjobslots-static-seo-content["'][\s\S]*?<\/main>/i.test(html)) {
      return html.replace(/<main\b[^>]+id=["']openjobslots-static-seo-content["'][\s\S]*?<\/main>/i, content);
    }
    if (/<\/body>/i.test(html)) {
      return html.replace(/<\/body>/i, `    ${content}\n</body>`);
    }
    return html;
  }

  function replaceStaticSeoFallback(html, req) {
    const fallback = buildStaticSeoFallback(req);
    if (/<noscript>[\s\S]*?<\/noscript>/i.test(html)) {
      return html.replace(/<noscript>[\s\S]*?<\/noscript>/i, fallback);
    }
    if (/<body\b[^>]*>/i.test(html)) {
      return html.replace(/<body\b[^>]*>/i, (match) => `${match}\n    ${fallback}`);
    }
    return html;
  }

  function setHtmlLanguage(html, languageCode) {
    const htmlLang = escapeHtmlAttribute(languageCode || "en");
    return String(html || "").replace(/<html\b([^>]*)>/i, (match, attrs) => {
      if (/\s+lang\s*=\s*["'][^"']*["']/i.test(attrs)) {
        return `<html${attrs.replace(/\s+lang\s*=\s*["'][^"']*["']/i, ` lang="${htmlLang}"`)}>`;
      }
      return `<html lang="${htmlLang}"${attrs}>`;
    });
  }

  function renderSeoIndexHtml(indexHtml, req) {
    const canonicalUrl = getPublicSiteCanonicalUrl(req);
    const seoMeta = getSeoMeta(req);
    const title = escapeHtmlAttribute(seoMeta.title);
    const description = escapeHtmlAttribute(seoMeta.description);
    const canonical = escapeHtmlAttribute(canonicalUrl);
    const alternateTags = buildAlternateLanguageLinkTags(req);
    const analyticsTags = buildPublicWebAnalyticsHeadTags(readPublicWebAnalyticsConfig());
    const tags = [
      '<style id="openjobslots-static-seo-style">#openjobslots-static-seo-content{max-width:1120px;margin:40px auto 56px;padding:0 24px;color:#334155;font:15px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#openjobslots-static-seo-content h2,#openjobslots-static-seo-content h3{color:#0f172a;letter-spacing:0;margin:0 0 12px}#openjobslots-static-seo-content h2{font-size:24px;line-height:1.25}#openjobslots-static-seo-content h3{font-size:16px;line-height:1.3}#openjobslots-static-seo-content p{margin:0 0 12px}.openjobslots-seo-band{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:32px}.openjobslots-seo-aside,.openjobslots-seo-faq,.openjobslots-seo-footer{border-top:1px solid #e2e8f0;padding-top:16px}.openjobslots-seo-faq,.openjobslots-seo-footer{margin-top:24px}.openjobslots-seo-faq dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:0}.openjobslots-seo-faq dt{color:#0f172a;font-weight:700;margin:0 0 4px}.openjobslots-seo-faq dd{margin:0;color:#475569}.openjobslots-seo-aside ul,.openjobslots-seo-footer ul{display:grid;gap:8px;list-style:none;margin:0;padding:0}.openjobslots-seo-footer ul{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}.openjobslots-seo-aside a,.openjobslots-seo-footer a{color:#0369a1;font-weight:650;text-decoration:none}.openjobslots-seo-aside a:hover,.openjobslots-seo-footer a:hover{text-decoration:underline}.openjobslots-seo-aside span,.openjobslots-seo-footer span{display:block;color:#64748b;font-size:13px;line-height:1.45}@media(max-width:760px){#openjobslots-static-seo-content{margin:28px auto 40px;padding:0 18px}.openjobslots-seo-band,.openjobslots-seo-faq dl{grid-template-columns:1fr;gap:20px}}</style>',
      '<meta name="description" content="' + description + '" />',
      '<link rel="canonical" href="' + canonical + '" />',
      alternateTags,
      '<meta name="robots" content="index, follow" />',
      '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="OpenJobSlots" />',
      '<meta property="og:title" content="' + title + '" />',
      '<meta property="og:description" content="' + description + '" />',
      '<meta property="og:url" content="' + canonical + '" />',
      '<meta name="twitter:card" content="summary" />',
      '<meta name="twitter:title" content="' + title + '" />',
      '<meta name="twitter:description" content="' + description + '" />'
    ].filter(Boolean).join("\n    ");
    const structuredDataTags = buildStructuredDataTags(req);
    const managedAnalyticsTags = analyticsTags
      ? [
        "<!-- OpenJobSlots public analytics start -->",
        analyticsTags,
        "<!-- OpenJobSlots public analytics end -->"
      ].join("\n    ")
      : "";

    let html = setHtmlLanguage(stripPublicWebAnalyticsHeadTags(removeExistingSeoTags(indexHtml)), seoMeta.languageCode || "en")
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
    html = replaceStaticSeoFallback(html, req);
    html = replaceStaticSeoContent(html, req);
    if (!/<\/head>/i.test(html)) return html;
    const analyticsBlock = managedAnalyticsTags ? `\n    ${managedAnalyticsTags}` : "";
    return html.replace(
      /<\/head>/i,
      `    <!-- OpenJobSlots SEO metadata -->\n    ${tags}\n    ${structuredDataTags}${analyticsBlock}\n</head>`
    );
  }

  function buildLlmsTxt(req) {
    const siteOrigin = getPublicSiteOrigin(req);
    const description = normalizeInlineText(seoDescription || "Find fresh job openings from public employer ATS boards.");
    const byPath = new Map(PUBLIC_SEO_ROUTES.map((route) => [route.path, route]));
    const corePaths = [
      "/en",
      "/en/job-openings",
      "/en/remote-job-openings",
      "/en/software-engineer-jobs",
      "/en/product-manager-jobs",
      "/en/technical-support-engineer-jobs"
    ];
    const atsRoutes = PUBLIC_SEO_ROUTES.filter((route) => String(route.path || "").startsWith("/ats/"));

    function markdownRoute(route) {
      const title = escapeMarkdownLinkText(stripOpenJobSlotsTitleSuffix(route.title) || route.searchQuery || route.path);
      const summary = normalizeInlineText(route.description || `OpenJobSlots landing page for ${route.searchQuery || route.path}.`);
      return `- [${title}](${siteOrigin}${route.path}): ${summary}`;
    }

    const coreLinks = corePaths.map((routePath) => byPath.get(routePath)).filter(Boolean).map(markdownRoute);
    const atsLinks = atsRoutes.map(markdownRoute);

    return [
      "# OpenJobSlots",
      "",
      `> ${description}`,
      "",
      "OpenJobSlots is a public job search product for discovering fresh job slots from employer ATS boards. Public pages focus on crawlable search entry points; app endpoints return structured public posting data.",
      "",
      "## Core pages",
      "",
      ...coreLinks,
      "",
      "## ATS source pages",
      "",
      ...atsLinks,
      "",
      "## Optional",
      "",
      `- [Sitemap](${siteOrigin}/sitemap.xml): XML sitemap for curated public landing pages.`,
      `- [Robots policy](${siteOrigin}/robots.txt): Crawl policy for public and internal routes.`,
      ""
    ].join("\n");
  }

  function buildRobotsTxt(req) {
    return [
      "User-agent: *",
      "Allow: /",
      "Disallow: /applications",
      "Disallow: /settings",
      "Disallow: /sync",
      "Disallow: /ingestion",
      "Disallow: /mcp",
      "Disallow: /frontend",
      "Disallow: /postings",
      `Sitemap: ${getPublicSiteOrigin(req)}/sitemap.xml`
    ].join("\n") + "\n";
  }

  function buildSitemapXml(req) {
    const siteOrigin = getPublicSiteOrigin(req);
    const urls = [
      {
        loc: `${siteOrigin}/`,
        changefreq: "daily",
        priority: "1.0",
        alternateGroup: "home"
      },
      ...PUBLIC_SEO_ROUTES.map((route) => ({
        loc: `${siteOrigin}${route.path}`,
        changefreq: route.changefreq || "daily",
        priority: route.priority || "0.8",
        alternateGroup: route.alternateGroup || ""
      }))
    ];
    const urlEntries = urls.map((item) => {
      const alternateEntries = getPublicSeoAlternateLinksForGroup(siteOrigin, item.alternateGroup)
        .map((alternate) =>
          `    <xhtml:link rel="alternate" hreflang="${escapeHtmlAttribute(alternate.hreflang)}" href="${escapeHtmlAttribute(alternate.href)}" />`
        );
      return [
        "  <url>",
        `    <loc>${escapeHtmlAttribute(item.loc)}</loc>`,
        ...alternateEntries,
        `    <changefreq>${escapeHtmlAttribute(item.changefreq)}</changefreq>`,
        `    <priority>${escapeHtmlAttribute(item.priority)}</priority>`,
        "  </url>"
      ].join("\n");
    });

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      ...urlEntries,
      "</urlset>"
    ].join("\n") + "\n";
  }

  return {
    buildLlmsTxt,
    buildRobotsTxt,
    buildSitemapXml,
    buildStructuredDataTags,
    getPublicSearchLandingUrl,
    getPublicSiteCanonicalUrl,
    getPublicSiteOrigin,
    renderSeoIndexHtml
  };
}

module.exports = {
  createPublicSeoHelpers,
  escapeHtmlAttribute,
  normalizeOrigin,
  removeExistingSeoTags,
  stringifyJsonLd
};
