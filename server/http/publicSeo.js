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

function createAdditionalSeoFallbackCopy(copy) {
  return {
    relatedLabel: copy.relatedLabel,
    paragraphIntro: ({ heading, description }) =>
      `${heading} ${copy.intro} ${description}`,
    paragraphCoverage: ({ searchQuery }) =>
      `${copy.coverageStart} ${searchQuery || copy.defaultSearch}. ${copy.coverageDetail}`,
    paragraphQuality: () => copy.quality,
    paragraphNavigation: () => copy.navigation,
    faqLabel: copy.faqLabel,
    faqItems: ({ searchQuery }) => [
      {
        question: copy.faqWhat.replace("{search}", searchQuery || copy.defaultSearch),
        answer: copy.faqWhatAnswer.replace("{search}", searchQuery || copy.defaultSearch)
      },
      {
        question: copy.faqSources,
        answer: copy.faqSourcesAnswer
      },
      {
        question: copy.faqQuality,
        answer: copy.faqQualityAnswer
      }
    ]
  };
}

const SEO_ADDITIONAL_FALLBACK_COPY_BY_LANGUAGE = Object.freeze({
  "pt-BR": createAdditionalSeoFallbackCopy({
    relatedLabel: "Páginas públicas relacionadas de busca de vagas",
    intro: "é uma página rastreável da OpenJobSlots para pessoas e buscadores antes do app interativo carregar.",
    coverageStart: "A OpenJobSlots ajuda a começar por",
    defaultSearch: "vagas abertas",
    coverageDetail: "Depois o visitante pode filtrar por cargo, empresa, localidade, país, região, modo remoto, plataforma de origem e atualidade da publicação, sempre usando campos públicos de vagas.",
    quality: "O índice mantém os links do empregador como fonte canônica e usa Meilisearch como camada derivada, enquanto Postgres permanece como fonte de verdade. Dados ambíguos não são publicados como localização, data, empresa ou modo remoto inventado.",
    navigation: "Os links abaixo conectam intenções de busca localizadas e páginas de fontes ATS importantes em HTML simples para crawler e usuário. Com JavaScript ativo, a interface adiciona sugestões, filtros, contagens e cards atuais.",
    faqLabel: "Perguntas de busca",
    faqWhat: "O que encontro nesta página de {search}?",
    faqWhatAnswer: "Esta é uma entrada estável para buscar {search} em quadros ATS públicos de empregadores e refinar por título, empresa, localidade, país, região, modo remoto e atualidade.",
    faqSources: "De onde vêm as vagas?",
    faqSourcesAnswer: "A OpenJobSlots indexa páginas públicas de carreira e quadros ATS públicos, normalizando campos públicos em um esquema pesquisável.",
    faqQuality: "Como dados incertos são tratados?",
    faqQualityAnswer: "Evidência incerta de localidade, data, remoto ou source-id fica conservadora até haver prova de parser suficiente."
  }),
  "pt-PT": createAdditionalSeoFallbackCopy({
    relatedLabel: "Páginas públicas relacionadas de pesquisa de vagas",
    intro: "é uma página rastreável da OpenJobSlots para visitantes e motores de busca antes da aplicação interativa carregar.",
    coverageStart: "A OpenJobSlots ajuda a começar por",
    defaultSearch: "vagas abertas",
    coverageDetail: "Depois é possível filtrar por cargo, empresa, localidade, país, região, modo remoto, plataforma de origem e atualidade da publicação, usando apenas campos públicos.",
    quality: "O índice mantém os links do empregador como fonte canónica e usa Meilisearch como camada derivada, enquanto Postgres continua a fonte de verdade. Dados ambíguos não são publicados como localização, data, empresa ou modo remoto inventado.",
    navigation: "Os links abaixo ligam intenções localizadas e páginas ATS importantes em HTML simples para crawlers e utilizadores. Com JavaScript, a interface adiciona sugestões, filtros, contagens e cartões atuais.",
    faqLabel: "Perguntas de pesquisa",
    faqWhat: "O que encontro nesta página de {search}?",
    faqWhatAnswer: "Esta é uma entrada estável para pesquisar {search} em quadros ATS públicos e refinar por título, empresa, localidade, país, região, modo remoto e atualidade.",
    faqSources: "De onde vêm as vagas?",
    faqSourcesAnswer: "A OpenJobSlots indexa páginas públicas de carreira e quadros ATS públicos, normalizando campos públicos num esquema pesquisável.",
    faqQuality: "Como são tratados dados incertos?",
    faqQualityAnswer: "Evidência incerta de localidade, data, remoto ou source-id fica conservadora até haver prova de parser suficiente."
  }),
  it: createAdditionalSeoFallbackCopy({
    relatedLabel: "Pagine pubbliche correlate per la ricerca lavoro",
    intro: "è una pagina OpenJobSlots indicizzabile per utenti e motori di ricerca prima del caricamento dell'app interattiva.",
    coverageStart: "OpenJobSlots aiuta a iniziare con",
    defaultSearch: "offerte di lavoro",
    coverageDetail: "Poi si possono filtrare i risultati per ruolo, azienda, località, paese, regione, modalità remota, piattaforma di origine e freschezza della pubblicazione, usando solo campi pubblici.",
    quality: "L'indice mantiene i link del datore di lavoro come fonte canonica e usa Meilisearch come livello derivato, mentre Postgres resta la fonte di verità. I dati ambigui non diventano posizione, data, azienda o modalità remota inventata.",
    navigation: "I link sotto collegano intenti localizzati e pagine ATS importanti in HTML semplice per crawler e utenti. Con JavaScript l'interfaccia aggiunge suggerimenti, filtri, conteggi e schede aggiornate.",
    faqLabel: "Domande sulla ricerca",
    faqWhat: "Cosa trovo in questa pagina per {search}?",
    faqWhatAnswer: "È un punto di ingresso stabile per cercare {search} su job board ATS pubblici e filtrare per titolo, azienda, località, paese, regione, remote mode e freschezza.",
    faqSources: "Da dove arrivano le offerte?",
    faqSourcesAnswer: "OpenJobSlots indicizza pagine carriere pubbliche e job board ATS pubblici, normalizzando campi pubblici in uno schema ricercabile.",
    faqQuality: "Come vengono trattati i dati incerti?",
    faqQualityAnswer: "Evidenze incerte su località, data, remote o source-id restano conservative finché il parser non fornisce prova sufficiente."
  }),
  nl: createAdditionalSeoFallbackCopy({
    relatedLabel: "Gerelateerde publieke vacaturezoekpagina's",
    intro: "is een crawlbare OpenJobSlots-pagina voor bezoekers en zoekmachines voordat de interactieve app laadt.",
    coverageStart: "OpenJobSlots helpt starten met",
    defaultSearch: "openstaande vacatures",
    coverageDetail: "Daarna kunnen resultaten worden verfijnd op titel, bedrijf, locatie, land, regio, remote-modus, bronplatform en actualiteit, met alleen publieke vacaturevelden.",
    quality: "De index bewaart werkgeverslinks als canonieke bron en gebruikt Meilisearch als afgeleide zoeklaag, terwijl Postgres de bron van waarheid blijft. Ambigue data wordt niet gepubliceerd als verzonnen locatie, datum, bedrijf of remote-status.",
    navigation: "De links hieronder verbinden gelokaliseerde zoekintenties en belangrijke ATS-bronpagina's in eenvoudige HTML. Met JavaScript voegt de interface suggesties, filters, aantallen en actuele kaarten toe.",
    faqLabel: "Zoekvragen",
    faqWhat: "Wat vind ik op deze pagina voor {search}?",
    faqWhatAnswer: "Dit is een stabiele ingang om {search} op publieke ATS-boards te zoeken en te verfijnen op titel, bedrijf, locatie, land, regio, remote mode en actualiteit.",
    faqSources: "Waar komen de vacatures vandaan?",
    faqSourcesAnswer: "OpenJobSlots indexeert publieke carrièrepagina's en publieke ATS-boards en normaliseert publieke velden naar één doorzoekbaar schema.",
    faqQuality: "Hoe gaat OpenJobSlots om met onzekere data?",
    faqQualityAnswer: "Onzekere locatie-, datum-, remote- of source-id-bewijzen blijven conservatief totdat parserbewijs voldoende is."
  }),
  pl: createAdditionalSeoFallbackCopy({
    relatedLabel: "Powiązane publiczne strony wyszukiwania pracy",
    intro: "to indeksowalna strona OpenJobSlots dla użytkowników i wyszukiwarek przed załadowaniem interaktywnej aplikacji.",
    coverageStart: "OpenJobSlots pomaga zacząć od",
    defaultSearch: "ofert pracy",
    coverageDetail: "Następnie wyniki można zawęzić według stanowiska, firmy, lokalizacji, kraju, regionu, trybu zdalnego, platformy źródłowej i świeżości publikacji, używając tylko publicznych pól.",
    quality: "Indeks traktuje linki pracodawców jako kanoniczne źródło i używa Meilisearch jako warstwy pochodnej, a Postgres pozostaje źródłem prawdy. Dane niepewne nie są publikowane jako wymyślona lokalizacja, data, firma ani tryb pracy.",
    navigation: "Linki poniżej łączą lokalne intencje wyszukiwania i ważne strony ATS w prostym HTML. Gdy działa JavaScript, interfejs dodaje sugestie, filtry, liczniki i aktualne karty.",
    faqLabel: "Pytania o wyszukiwanie",
    faqWhat: "Co znajdę na stronie {search}?",
    faqWhatAnswer: "To stabilne wejście do wyszukiwania {search} na publicznych tablicach ATS i filtrowania według stanowiska, firmy, lokalizacji, kraju, regionu, trybu zdalnego i świeżości.",
    faqSources: "Skąd pochodzą oferty?",
    faqSourcesAnswer: "OpenJobSlots indeksuje publiczne strony karier i publiczne tablice ATS, normalizując publiczne pola do jednego schematu.",
    faqQuality: "Jak traktowane są niepewne dane?",
    faqQualityAnswer: "Niepewna lokalizacja, data, remote lub source-id pozostają konserwatywne do czasu wystarczających dowodów parsera."
  }),
  ja: createAdditionalSeoFallbackCopy({
    relatedLabel: "関連する公開求人検索ページ",
    intro: "は、インタラクティブな検索アプリが読み込まれる前に使える OpenJobSlots のクロール可能な入口です。",
    coverageStart: "OpenJobSlots は次の検索から始められます:",
    defaultSearch: "公開求人",
    coverageDetail: "その後、職種、会社、地域、国、リージョン、リモート条件、ソースプラットフォーム、掲載の新しさで結果を絞り込めます。公開求人フィールドだけを使います。",
    quality: "インデックスは雇用主リンクを正規ソースとして扱い、Meilisearch を派生検索レイヤーとして使い、Postgres を真実のソースにします。不明確なデータを架空の場所、日付、会社、リモート状態として公開しません。",
    navigation: "下のリンクは、ローカライズされた検索意図と重要な ATS ソースページをシンプルな HTML でつなぎます。JavaScript が使える場合、UI は提案、フィルター、件数、最新カードを追加します。",
    faqLabel: "検索 FAQ",
    faqWhat: "{search} ページでは何が見つかりますか?",
    faqWhatAnswer: "公開 ATS ボードの {search} を安定して検索し、職種、会社、地域、国、リモート条件、新しさで絞り込む入口です。",
    faqSources: "求人はどこから来ますか?",
    faqSourcesAnswer: "OpenJobSlots は公開キャリアページと公開 ATS ボードをインデックスし、公開フィールドを検索スキーマに正規化します。",
    faqQuality: "不確実なデータはどう扱いますか?",
    faqQualityAnswer: "場所、日付、リモート、source-id が不確実な場合、parser の証拠が十分になるまで保守的に扱います。"
  }),
  ko: createAdditionalSeoFallbackCopy({
    relatedLabel: "관련 공개 채용 검색 페이지",
    intro: "는 인터랙티브 검색 앱이 로드되기 전에 사람과 검색 엔진이 사용할 수 있는 OpenJobSlots 진입점입니다.",
    coverageStart: "OpenJobSlots는 다음 검색으로 시작할 수 있습니다:",
    defaultSearch: "공개 채용 공고",
    coverageDetail: "이후 직무, 회사, 위치, 국가, 지역, 원격 방식, 출처 플랫폼, 게시 신선도로 결과를 좁힐 수 있으며 공개 채용 필드만 사용합니다.",
    quality: "인덱스는 고용주 링크를 정식 출처로 유지하고 Meilisearch를 파생 검색 계층으로 사용하며 Postgres를 source of truth로 둡니다. 불명확한 데이터는 가짜 위치, 날짜, 회사 또는 원격 상태로 공개하지 않습니다.",
    navigation: "아래 링크는 현지화된 검색 의도와 주요 ATS 출처 페이지를 단순 HTML로 연결합니다. JavaScript가 있으면 UI가 제안, 필터, 개수, 최신 카드를 추가합니다.",
    faqLabel: "검색 FAQ",
    faqWhat: "{search} 페이지에서 무엇을 찾을 수 있나요?",
    faqWhatAnswer: "공개 ATS 보드의 {search}를 안정적으로 검색하고 직무, 회사, 위치, 국가, 원격 방식, 최신순으로 좁히는 진입점입니다.",
    faqSources: "공고는 어디에서 오나요?",
    faqSourcesAnswer: "OpenJobSlots는 공개 커리어 페이지와 공개 ATS 보드를 인덱싱하고 공개 필드를 하나의 검색 스키마로 정규화합니다.",
    faqQuality: "불확실한 데이터는 어떻게 처리하나요?",
    faqQualityAnswer: "위치, 날짜, 원격, source-id 증거가 불확실하면 parser 증거가 충분해질 때까지 보수적으로 유지합니다."
  }),
  "zh-CN": createAdditionalSeoFallbackCopy({
    relatedLabel: "相关公开职位搜索页面",
    intro: "是 OpenJobSlots 的可抓取入口，供用户和搜索引擎在交互式搜索应用加载前使用。",
    coverageStart: "OpenJobSlots 可以从以下搜索开始:",
    defaultSearch: "开放职位",
    coverageDetail: "之后可按职位、公司、地点、国家、地区、远程方式、来源平台和发布时间新鲜度筛选结果，并且只使用公开职位字段。",
    quality: "索引将雇主链接保留为规范来源，Meilisearch 是派生搜索层，Postgres 仍是事实来源。不明确数据不会被发布为虚构地点、日期、公司或远程状态。",
    navigation: "下面的链接用简单 HTML 连接本地化搜索意图和重要 ATS 来源页面。启用 JavaScript 后，界面会添加建议、筛选、数量和最新职位卡片。",
    faqLabel: "搜索 FAQ",
    faqWhat: "这个 {search} 页面可以找到什么?",
    faqWhatAnswer: "这是搜索公开 ATS 招聘板中 {search} 的稳定入口，并可按职位、公司、地点、国家、远程方式和新鲜度筛选。",
    faqSources: "职位来自哪里?",
    faqSourcesAnswer: "OpenJobSlots 索引公开职业页面和公开 ATS 招聘板，并将公开字段规范化到一个可搜索 schema。",
    faqQuality: "不确定数据如何处理?",
    faqQualityAnswer: "地点、日期、远程或 source-id 证据不确定时，会保持保守，直到 parser 证据足够。"
  }),
  hi: createAdditionalSeoFallbackCopy({
    relatedLabel: "संबंधित public job search pages",
    intro: "OpenJobSlots का crawlable entry point है, जो interactive search app load होने से पहले users और search engines के लिए काम करता है.",
    coverageStart: "OpenJobSlots शुरुआत करने में मदद करता है:",
    defaultSearch: "open jobs",
    coverageDetail: "इसके बाद results को title, company, location, country, region, remote mode, source platform और posting freshness से refine किया जा सकता है, और सिर्फ public posting fields का उपयोग होता है.",
    quality: "Index employer links को canonical source evidence रखता है, Meilisearch को derived search layer की तरह चलाता है, और Postgres source of truth रहता है. Ambiguous data को fake location, date, company या remote value की तरह publish नहीं किया जाता.",
    navigation: "नीचे links localized search intents और important ATS source pages को plain HTML में जोड़ते हैं. JavaScript उपलब्ध होने पर interface suggestions, filters, counts और current posting cards जोड़ता है.",
    faqLabel: "Search FAQ",
    faqWhat: "{search} page पर क्या मिलेगा?",
    faqWhatAnswer: "यह public ATS boards में {search} खोजने और title, company, location, country, remote mode और freshness से refine करने का stable entry point है.",
    faqSources: "Listings कहां से आते हैं?",
    faqSourcesAnswer: "OpenJobSlots public career pages और public ATS boards index करता है, फिर public fields को searchable schema में normalize करता है.",
    faqQuality: "Uncertain data कैसे handle होता है?",
    faqQualityAnswer: "Location, date, remote या source-id evidence unclear हो तो parser proof पर्याप्त होने तक value conservative रहती है."
  }),
  ar: createAdditionalSeoFallbackCopy({
    relatedLabel: "صفحات بحث وظائف عامة ذات صلة",
    intro: "هي صفحة OpenJobSlots قابلة للزحف للزوار ومحركات البحث قبل تحميل تطبيق البحث التفاعلي.",
    coverageStart: "تساعد OpenJobSlots على البدء بـ",
    defaultSearch: "الوظائف المفتوحة",
    coverageDetail: "بعد ذلك يمكن تضييق النتائج حسب المسمى والشركة والموقع والدولة والمنطقة ونمط العمل عن بعد ومنصة المصدر وحداثة النشر، باستخدام حقول عامة فقط.",
    quality: "يحافظ الفهرس على روابط صاحب العمل كمصدر قانوني ويستخدم Meilisearch كطبقة بحث مشتقة بينما يبقى Postgres مصدر الحقيقة. البيانات غير الواضحة لا تنشر كموقع أو تاريخ أو شركة أو حالة عمل عن بعد مخترعة.",
    navigation: "الروابط أدناه تصل نوايا البحث المحلية وصفحات ATS المهمة عبر HTML بسيط. عند توفر JavaScript تضيف الواجهة الاقتراحات والفلاتر والعدادات وبطاقات الوظائف الحالية.",
    faqLabel: "أسئلة البحث",
    faqWhat: "ماذا أجد في صفحة {search}؟",
    faqWhatAnswer: "هذه نقطة دخول مستقرة للبحث عن {search} في لوحات ATS العامة والتصفية حسب المسمى والشركة والموقع والدولة والعمل عن بعد والحداثة.",
    faqSources: "من أين تأتي الوظائف؟",
    faqSourcesAnswer: "تفهرس OpenJobSlots صفحات وظائف عامة ولوحات ATS عامة، ثم توحد الحقول العامة في schema قابل للبحث.",
    faqQuality: "كيف يتم التعامل مع البيانات غير المؤكدة؟",
    faqQualityAnswer: "إذا كان دليل الموقع أو التاريخ أو العمل عن بعد أو source-id غير واضح، يبقى محافظا حتى يتوفر دليل parser كاف."
  }),
  id: createAdditionalSeoFallbackCopy({
    relatedLabel: "Halaman pencarian lowongan publik terkait",
    intro: "adalah halaman OpenJobSlots yang dapat dirayapi untuk pengguna dan mesin pencari sebelum aplikasi interaktif dimuat.",
    coverageStart: "OpenJobSlots membantu memulai dengan",
    defaultSearch: "lowongan terbuka",
    coverageDetail: "Setelah itu hasil dapat difilter berdasarkan jabatan, perusahaan, lokasi, negara, wilayah, mode remote, platform sumber, dan kesegaran posting, hanya memakai field publik.",
    quality: "Indeks mempertahankan link pemberi kerja sebagai sumber kanonis dan memakai Meilisearch sebagai lapisan pencarian turunan, sementara Postgres tetap menjadi source of truth. Data ambigu tidak diterbitkan sebagai lokasi, tanggal, perusahaan, atau remote status palsu.",
    navigation: "Link di bawah menghubungkan intent lokal dan halaman sumber ATS penting dalam HTML sederhana. Saat JavaScript tersedia, antarmuka menambah saran, filter, hitungan, dan kartu lowongan terbaru.",
    faqLabel: "FAQ pencarian",
    faqWhat: "Apa yang ada di halaman {search} ini?",
    faqWhatAnswer: "Ini adalah titik masuk stabil untuk mencari {search} di papan ATS publik dan memfilter berdasarkan jabatan, perusahaan, lokasi, negara, remote mode, dan kesegaran.",
    faqSources: "Dari mana lowongan berasal?",
    faqSourcesAnswer: "OpenJobSlots mengindeks halaman karier publik dan papan ATS publik, lalu menormalkan field publik ke schema yang dapat dicari.",
    faqQuality: "Bagaimana data yang tidak pasti ditangani?",
    faqQualityAnswer: "Bukti lokasi, tanggal, remote, atau source-id yang tidak jelas tetap konservatif sampai bukti parser cukup."
  }),
  sv: createAdditionalSeoFallbackCopy({
    relatedLabel: "Relaterade publika jobbsöksidor",
    intro: "är en crawlbar OpenJobSlots-sida för besökare och sökmotorer innan den interaktiva appen laddas.",
    coverageStart: "OpenJobSlots hjälper dig börja med",
    defaultSearch: "öppna jobb",
    coverageDetail: "Därefter kan resultat filtreras efter titel, företag, plats, land, region, remote-läge, källplattform och publiceringsfräschör, med endast publika jobbfält.",
    quality: "Indexet behåller arbetsgivarlänkar som kanonisk källa och använder Meilisearch som härledd söklager, medan Postgres är source of truth. Oklar data publiceras inte som påhittad plats, datum, företag eller remote-status.",
    navigation: "Länkarna nedan kopplar lokala sökintentioner och viktiga ATS-källsidor i enkel HTML. Med JavaScript lägger gränssnittet till förslag, filter, antal och aktuella jobbkort.",
    faqLabel: "Sökfrågor",
    faqWhat: "Vad finns på sidan för {search}?",
    faqWhatAnswer: "Detta är en stabil ingång för att söka {search} på publika ATS-tavlor och filtrera efter titel, företag, plats, land, remote-läge och fräschör.",
    faqSources: "Varifrån kommer jobben?",
    faqSourcesAnswer: "OpenJobSlots indexerar publika karriärsidor och publika ATS-tavlor och normaliserar publika fält till ett sökbart schema.",
    faqQuality: "Hur hanteras osäker data?",
    faqQualityAnswer: "Osäker plats, datum, remote eller source-id hålls konservativ tills parserbevis räcker."
  }),
  da: createAdditionalSeoFallbackCopy({
    relatedLabel: "Relaterede offentlige jobsøgningssider",
    intro: "er en crawlbar OpenJobSlots-side for brugere og søgemaskiner før den interaktive app indlæses.",
    coverageStart: "OpenJobSlots hjælper med at starte med",
    defaultSearch: "ledige job",
    coverageDetail: "Derefter kan resultater filtreres efter titel, virksomhed, sted, land, region, remote-form, kildeplatform og friskhed, kun med offentlige jobfelter.",
    quality: "Indekset bevarer arbejdsgiverlinks som kanonisk kilde og bruger Meilisearch som afledt søgelag, mens Postgres er source of truth. Usikre data publiceres ikke som opfundet sted, dato, virksomhed eller remote-status.",
    navigation: "Links nedenfor forbinder lokale søgeintentioner og vigtige ATS-kildesider i enkel HTML. Med JavaScript tilføjer grænsefladen forslag, filtre, tællinger og aktuelle jobkort.",
    faqLabel: "Søgespørgsmål",
    faqWhat: "Hvad findes på siden for {search}?",
    faqWhatAnswer: "Det er en stabil indgang til at søge {search} på offentlige ATS-boards og filtrere efter titel, virksomhed, sted, land, remote-form og friskhed.",
    faqSources: "Hvor kommer jobbene fra?",
    faqSourcesAnswer: "OpenJobSlots indekserer offentlige karrieresider og ATS-boards og normaliserer offentlige felter til et søgbart schema.",
    faqQuality: "Hvordan håndteres usikre data?",
    faqQualityAnswer: "Usikker lokation, dato, remote eller source-id holdes konservativt, indtil parserbevis er tilstrækkeligt."
  }),
  no: createAdditionalSeoFallbackCopy({
    relatedLabel: "Relaterte offentlige jobbsøksider",
    intro: "er en crawlbar OpenJobSlots-side for brukere og søkemotorer før den interaktive appen lastes.",
    coverageStart: "OpenJobSlots hjelper deg å starte med",
    defaultSearch: "åpne jobber",
    coverageDetail: "Deretter kan resultater filtreres etter tittel, selskap, sted, land, region, remote-form, kildeplattform og ferskhet, bare med offentlige jobbfelt.",
    quality: "Indeksen beholder arbeidsgiverlenker som kanonisk kilde og bruker Meilisearch som avledet søkelag, mens Postgres er source of truth. Uklar data publiseres ikke som oppdiktet sted, dato, selskap eller remote-status.",
    navigation: "Lenkene under kobler lokale søkeintensjoner og viktige ATS-kildesider i enkel HTML. Med JavaScript legger grensesnittet til forslag, filtre, tellinger og aktuelle jobbkort.",
    faqLabel: "Søkespørsmål",
    faqWhat: "Hva finnes på siden for {search}?",
    faqWhatAnswer: "Dette er en stabil inngang for å søke {search} på offentlige ATS-tavler og filtrere etter tittel, selskap, sted, land, remote-form og ferskhet.",
    faqSources: "Hvor kommer jobbene fra?",
    faqSourcesAnswer: "OpenJobSlots indekserer offentlige karrieresider og offentlige ATS-tavler og normaliserer offentlige felter til et søkbart schema.",
    faqQuality: "Hvordan håndteres usikker data?",
    faqQualityAnswer: "Usikker lokasjon, dato, remote eller source-id holdes konservativt til parserbevis er nok."
  }),
  fi: createAdditionalSeoFallbackCopy({
    relatedLabel: "Aiheeseen liittyvät julkiset työnhakusivut",
    intro: "on indeksoitava OpenJobSlots-sivu käyttäjille ja hakukoneille ennen interaktiivisen sovelluksen latautumista.",
    coverageStart: "OpenJobSlots auttaa aloittamaan haulla",
    defaultSearch: "avoimet työpaikat",
    coverageDetail: "Sen jälkeen tuloksia voi rajata nimikkeen, yrityksen, sijainnin, maan, alueen, etätyömuodon, lähdealustan ja julkaisun tuoreuden mukaan, käyttäen vain julkisia kenttiä.",
    quality: "Indeksi säilyttää työnantajalinkit kanonisena lähteenä ja käyttää Meilisearchia johdettuna hakukerroksena, kun Postgres on source of truth. Epäselvää dataa ei julkaista keksittynä sijaintina, päivänä, yrityksenä tai etätyötilana.",
    navigation: "Alla olevat linkit yhdistävät paikalliset hakuaikeet ja tärkeät ATS-lähdesivut yksinkertaisessa HTML:ssä. JavaScript lisää käyttöliittymään ehdotukset, suodattimet, määrät ja ajantasaiset kortit.",
    faqLabel: "Hakukysymykset",
    faqWhat: "Mitä {search} -sivulta löytyy?",
    faqWhatAnswer: "Se on vakaa aloituspaikka hakea {search} julkisilta ATS-sivuilta ja rajata nimikkeen, yrityksen, sijainnin, maan, etätyön ja tuoreuden mukaan.",
    faqSources: "Mistä työpaikat tulevat?",
    faqSourcesAnswer: "OpenJobSlots indeksoi julkisia urasivuja ja ATS-sivuja ja normalisoi julkiset kentät haettavaan schemaan.",
    faqQuality: "Miten epävarmaa dataa käsitellään?",
    faqQualityAnswer: "Epävarma sijainti, päivämäärä, etätyö tai source-id pidetään konservatiivisena, kunnes parser-todiste riittää."
  })
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
    return SEO_FALLBACK_COPY_BY_LANGUAGE[languageCode] ||
      SEO_ADDITIONAL_FALLBACK_COPY_BY_LANGUAGE[languageCode] ||
      SEO_FALLBACK_COPY_BY_LANGUAGE.en;
  }

  function getRouteSpecificSeoParagraphs(seoRoute) {
    return (Array.isArray(seoRoute?.contentParagraphs) ? seoRoute.contentParagraphs : [])
      .map(normalizeInlineText)
      .filter(Boolean);
  }

  function getRouteSpecificSeoFaqItems(seoRoute) {
    return (Array.isArray(seoRoute?.faqItems) ? seoRoute.faqItems : [])
      .map((item) => ({
        question: normalizeInlineText(item?.question || ""),
        answer: normalizeInlineText(item?.answer || "")
      }))
      .filter((item) => item.question && item.answer);
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
    const contentRoutes = PUBLIC_SEO_ROUTES.filter(
      (route) => route.languageCode === languageCode && route.contentCluster
    );
    const remainingRoutes = PUBLIC_SEO_ROUTES.filter((route) => ![
      ...currentLanguageRoutes,
      ...homeRoutes,
      ...atsRoutes,
      ...contentRoutes
    ].some((item) => item.path === route.path));
    const orderedRoutes = [
      ...currentLanguageRoutes,
      ...contentRoutes,
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
      ...getRouteSpecificSeoParagraphs(seoRoute),
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
    const routeItems = getRouteSpecificSeoFaqItems(seoRoute);
    const genericItems = typeof copy.faqItems === "function" ? copy.faqItems(values) : SEO_FALLBACK_COPY_BY_LANGUAGE.en.faqItems(values);
    const items = [...routeItems, ...(Array.isArray(genericItems) ? genericItems : [])];
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
      "/en/technical-support-engineer-jobs",
      "/en/data-analyst-jobs",
      "/en/customer-success-manager-jobs",
      "/en/devops-engineer-jobs"
    ];
    const contentPaths = [
      "/en/ats-job-boards",
      "/en/company-career-page-jobs",
      "/en/direct-apply-jobs",
      "/en/hidden-jobs",
      "/en/jobs-not-on-linkedin"
    ];
    const atsRoutes = PUBLIC_SEO_ROUTES.filter((route) => String(route.path || "").startsWith("/ats/"));

    function markdownRoute(route) {
      const title = escapeMarkdownLinkText(stripOpenJobSlotsTitleSuffix(route.title) || route.searchQuery || route.path);
      const summary = normalizeInlineText(route.description || `OpenJobSlots landing page for ${route.searchQuery || route.path}.`);
      return `- [${title}](${siteOrigin}${route.path}): ${summary}`;
    }

    const coreLinks = corePaths.map((routePath) => byPath.get(routePath)).filter(Boolean).map(markdownRoute);
    const contentLinks = contentPaths.map((routePath) => byPath.get(routePath)).filter(Boolean).map(markdownRoute);
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
      "## Source-first content pages",
      "",
      ...contentLinks,
      "",
      "## ATS source pages",
      "",
      ...atsLinks,
      "",
      "## Optional",
      "",
      `- [Sitemap](${siteOrigin}/sitemap.xml): XML sitemap index for curated public landing pages and ATS source pages.`,
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

  const PUBLIC_SEO_SITEMAP_SECTIONS = Object.freeze([
    {
      key: "static",
      path: "/sitemaps/static.xml",
      routes: (siteOrigin) => [
        {
          loc: `${siteOrigin}/`,
          changefreq: "daily",
          priority: "1.0",
          alternateGroup: "home"
        },
        ...PUBLIC_SEO_ROUTES
          .filter((route) => route.sitemapSection !== "ats-sources")
          .map((route) => ({
            loc: `${siteOrigin}${route.path}`,
            changefreq: route.changefreq || "daily",
            priority: route.priority || "0.8",
            alternateGroup: route.alternateGroup || ""
          }))
      ]
    },
    {
      key: "ats-sources",
      path: "/sitemaps/ats-sources.xml",
      routes: (siteOrigin) => PUBLIC_SEO_ROUTES
        .filter((route) => route.sitemapSection === "ats-sources")
        .map((route) => ({
          loc: `${siteOrigin}${route.path}`,
          changefreq: route.changefreq || "daily",
          priority: route.priority || "0.7",
          alternateGroup: route.alternateGroup || ""
        }))
    }
  ]);

  function buildSitemapUrlsetXml(req, routes) {
    const siteOrigin = getPublicSiteOrigin(req);
    const urlEntries = routes.map((item) => {
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

  function buildSitemapIndexXml(req) {
    const siteOrigin = getPublicSiteOrigin(req);
    const entries = PUBLIC_SEO_SITEMAP_SECTIONS.map((section) => [
      "  <sitemap>",
      `    <loc>${escapeHtmlAttribute(`${siteOrigin}${section.path}`)}</loc>`,
      "  </sitemap>"
    ].join("\n"));
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries,
      "</sitemapindex>"
    ].join("\n") + "\n";
  }

  function getPublicSeoSitemapSection(sectionPathOrKey) {
    const value = String(sectionPathOrKey || "").split("?")[0].split("#")[0].trim();
    return PUBLIC_SEO_SITEMAP_SECTIONS.find(
      (section) => section.key === value || section.path === value
    ) || null;
  }

  function buildSitemapSectionXml(req, sectionPathOrKey) {
    const section = getPublicSeoSitemapSection(sectionPathOrKey);
    if (!section) return "";
    return buildSitemapUrlsetXml(req, section.routes(getPublicSiteOrigin(req)));
  }

  function buildSitemapXml(req) {
    return buildSitemapIndexXml(req);
  }

  return {
    buildLlmsTxt,
    buildRobotsTxt,
    buildSitemapIndexXml,
    buildSitemapSectionXml,
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
