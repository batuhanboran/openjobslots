function normalizePublicSeoPath(value) {
  const raw = String(value || "/").split("?")[0].split("#")[0].trim();
  const withLeadingSlash = `/${raw.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  const normalized = withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
  return normalized.toLowerCase() || "/";
}

const PUBLIC_SEO_BASE_HOME_PAGES = Object.freeze([
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

const PUBLIC_SEO_ADDITIONAL_LANGUAGE_CONFIGS = Object.freeze([
  {
    languageCode: "pt-BR",
    pathPrefix: "pt-br",
    homeTitle: "Buscar vagas abertas | OpenJobSlots",
    homeDescription: "Encontre vagas recentes em quadros ATS públicos por cargo, empresa, local, modo remoto e atualidade.",
    landingDescription: "Pesquise vagas recentes em quadros ATS públicos por empresa, localidade, modo remoto e atualidade.",
    landingLabels: {
      "job-search": "Vagas abertas",
      remote: "Vagas remotas",
      "software-engineer": "Vagas de software engineer",
      "product-manager": "Vagas de product manager",
      "technical-support": "Vagas de suporte técnico",
      "data-analyst": "Vagas de data analyst",
      "customer-success": "Vagas de customer success manager",
      "devops-engineer": "Vagas de DevOps engineer"
    }
  },
  {
    languageCode: "pt-PT",
    pathPrefix: "pt-pt",
    homeTitle: "Pesquisar vagas abertas | OpenJobSlots",
    homeDescription: "Encontra vagas recentes em quadros ATS públicos por cargo, empresa, local, modo remoto e atualidade.",
    landingDescription: "Pesquisa vagas recentes em quadros ATS públicos por empresa, localidade, modo remoto e atualidade.",
    landingLabels: {
      "job-search": "Ofertas de emprego",
      remote: "Empregos remotos",
      "software-engineer": "Empregos de software engineer",
      "product-manager": "Empregos de product manager",
      "technical-support": "Empregos de suporte técnico",
      "data-analyst": "Empregos de data analyst",
      "customer-success": "Empregos de customer success manager",
      "devops-engineer": "Empregos de DevOps engineer"
    }
  },
  {
    languageCode: "it",
    pathPrefix: "it",
    homeTitle: "Cerca posizioni aperte | OpenJobSlots",
    homeDescription: "Trova offerte recenti nei job board ATS pubblici per ruolo, azienda, località, modalità remota e freschezza.",
    landingDescription: "Cerca offerte recenti nei job board ATS pubblici per azienda, località, modalità remota e freschezza.",
    landingLabels: {
      "job-search": "Offerte di lavoro",
      remote: "Lavori remoti",
      "software-engineer": "Lavori software engineer",
      "product-manager": "Lavori product manager",
      "technical-support": "Lavori technical support",
      "data-analyst": "Lavori data analyst",
      "customer-success": "Lavori customer success manager",
      "devops-engineer": "Lavori DevOps engineer"
    }
  },
  {
    languageCode: "nl",
    pathPrefix: "nl",
    homeTitle: "Zoek openstaande vacatures | OpenJobSlots",
    homeDescription: "Vind recente vacatures op publieke ATS-jobboards op titel, bedrijf, locatie, remote-modus en actualiteit.",
    landingDescription: "Zoek recente vacatures op publieke ATS-jobboards op bedrijf, locatie, remote-modus en actualiteit.",
    landingLabels: {
      "job-search": "Openstaande vacatures",
      remote: "Remote vacatures",
      "software-engineer": "Software engineer vacatures",
      "product-manager": "Product manager vacatures",
      "technical-support": "Technical support vacatures",
      "data-analyst": "Data analyst vacatures",
      "customer-success": "Customer success manager vacatures",
      "devops-engineer": "DevOps engineer vacatures"
    }
  },
  {
    languageCode: "pl",
    pathPrefix: "pl",
    homeTitle: "Szukaj otwartych ofert pracy | OpenJobSlots",
    homeDescription: "Znajdź świeże oferty z publicznych tablic ATS według stanowiska, firmy, lokalizacji, trybu zdalnego i daty.",
    landingDescription: "Szukaj świeżych ofert z publicznych tablic ATS według firmy, lokalizacji, trybu zdalnego i daty.",
    landingLabels: {
      "job-search": "Oferty pracy",
      remote: "Praca zdalna",
      "software-engineer": "Oferty software engineer",
      "product-manager": "Oferty product manager",
      "technical-support": "Oferty technical support",
      "data-analyst": "Oferty data analyst",
      "customer-success": "Oferty customer success manager",
      "devops-engineer": "Oferty DevOps engineer"
    }
  },
  {
    languageCode: "ja",
    pathPrefix: "ja",
    homeTitle: "公開求人を検索 | OpenJobSlots",
    homeDescription: "公開ATS求人ボードから職種、会社、地域、リモート条件、新しさで求人を検索します。",
    landingDescription: "公開ATS求人ボードから会社、地域、リモート条件、新しさで求人を検索します。",
    landingLabels: {
      "job-search": "公開求人",
      remote: "リモート求人",
      "software-engineer": "Software engineer 求人",
      "product-manager": "Product manager 求人",
      "technical-support": "Technical support 求人",
      "data-analyst": "Data analyst 求人",
      "customer-success": "Customer success manager 求人",
      "devops-engineer": "DevOps engineer 求人"
    }
  },
  {
    languageCode: "ko",
    pathPrefix: "ko",
    homeTitle: "공개 채용 공고 검색 | OpenJobSlots",
    homeDescription: "공개 ATS 채용 보드에서 직무, 회사, 위치, 원격 조건, 최신순으로 공고를 찾습니다.",
    landingDescription: "공개 ATS 채용 보드에서 회사, 위치, 원격 조건, 최신순으로 공고를 검색합니다.",
    landingLabels: {
      "job-search": "공개 채용 공고",
      remote: "원격 채용 공고",
      "software-engineer": "Software engineer 채용",
      "product-manager": "Product manager 채용",
      "technical-support": "Technical support 채용",
      "data-analyst": "Data analyst 채용",
      "customer-success": "Customer success manager 채용",
      "devops-engineer": "DevOps engineer 채용"
    }
  },
  {
    languageCode: "zh-CN",
    pathPrefix: "zh-cn",
    homeTitle: "搜索开放职位 | OpenJobSlots",
    homeDescription: "从公开 ATS 招聘板按职位、公司、地点、远程方式和新鲜度搜索最新职位。",
    landingDescription: "从公开 ATS 招聘板按公司、地点、远程方式和新鲜度搜索最新职位。",
    landingLabels: {
      "job-search": "开放职位",
      remote: "远程职位",
      "software-engineer": "Software engineer 职位",
      "product-manager": "Product manager 职位",
      "technical-support": "Technical support 职位",
      "data-analyst": "Data analyst 职位",
      "customer-success": "Customer success manager 职位",
      "devops-engineer": "DevOps engineer 职位"
    }
  },
  {
    languageCode: "hi",
    pathPrefix: "hi",
    homeTitle: "खुली नौकरियां खोजें | OpenJobSlots",
    homeDescription: "सार्वजनिक ATS job boards से पद, कंपनी, स्थान, remote mode और freshness के आधार पर jobs खोजें।",
    landingDescription: "सार्वजनिक ATS job boards से कंपनी, स्थान, remote mode और freshness के आधार पर jobs खोजें।",
    landingLabels: {
      "job-search": "खुली नौकरियां",
      remote: "रिमोट नौकरियां",
      "software-engineer": "software engineer नौकरियां",
      "product-manager": "product manager नौकरियां",
      "technical-support": "technical support नौकरियां",
      "data-analyst": "data analyst नौकरियां",
      "customer-success": "customer success manager नौकरियां",
      "devops-engineer": "DevOps engineer नौकरियां"
    }
  },
  {
    languageCode: "ar",
    pathPrefix: "ar",
    homeTitle: "ابحث عن الوظائف المفتوحة | OpenJobSlots",
    homeDescription: "ابحث في لوحات ATS العامة حسب المسمى والشركة والموقع والعمل عن بعد والحداثة.",
    landingDescription: "ابحث في لوحات ATS العامة حسب الشركة والموقع والعمل عن بعد والحداثة.",
    landingLabels: {
      "job-search": "وظائف مفتوحة",
      remote: "وظائف عن بعد",
      "software-engineer": "وظائف software engineer",
      "product-manager": "وظائف product manager",
      "technical-support": "وظائف technical support",
      "data-analyst": "وظائف data analyst",
      "customer-success": "وظائف customer success manager",
      "devops-engineer": "وظائف DevOps engineer"
    }
  },
  {
    languageCode: "id",
    pathPrefix: "id",
    homeTitle: "Cari lowongan terbuka | OpenJobSlots",
    homeDescription: "Temukan lowongan terbaru dari papan ATS publik berdasarkan jabatan, perusahaan, lokasi, mode remote, dan kesegaran.",
    landingDescription: "Cari lowongan terbaru dari papan ATS publik berdasarkan perusahaan, lokasi, mode remote, dan kesegaran.",
    landingLabels: {
      "job-search": "Lowongan terbuka",
      remote: "Lowongan remote",
      "software-engineer": "Lowongan software engineer",
      "product-manager": "Lowongan product manager",
      "technical-support": "Lowongan technical support",
      "data-analyst": "Lowongan data analyst",
      "customer-success": "Lowongan customer success manager",
      "devops-engineer": "Lowongan DevOps engineer"
    }
  },
  {
    languageCode: "sv",
    pathPrefix: "sv",
    homeTitle: "Sök öppna jobb | OpenJobSlots",
    homeDescription: "Hitta färska jobb från publika ATS-jobbtavlor efter titel, företag, plats, remote-läge och aktualitet.",
    landingDescription: "Sök färska jobb från publika ATS-jobbtavlor efter företag, plats, remote-läge och aktualitet.",
    landingLabels: {
      "job-search": "Öppna jobb",
      remote: "Remotejobb",
      "software-engineer": "Software engineer jobb",
      "product-manager": "Product manager jobb",
      "technical-support": "Technical support jobb",
      "data-analyst": "Data analyst jobb",
      "customer-success": "Customer success manager jobb",
      "devops-engineer": "DevOps engineer jobb"
    }
  },
  {
    languageCode: "da",
    pathPrefix: "da",
    homeTitle: "Søg ledige job | OpenJobSlots",
    homeDescription: "Find friske job fra offentlige ATS-jobboards efter titel, virksomhed, sted, remote-form og friskhed.",
    landingDescription: "Søg friske job fra offentlige ATS-jobboards efter virksomhed, sted, remote-form og friskhed.",
    landingLabels: {
      "job-search": "Ledige job",
      remote: "Remote job",
      "software-engineer": "Software engineer job",
      "product-manager": "Product manager job",
      "technical-support": "Technical support job",
      "data-analyst": "Data analyst job",
      "customer-success": "Customer success manager job",
      "devops-engineer": "DevOps engineer job"
    }
  },
  {
    languageCode: "no",
    pathPrefix: "no",
    homeTitle: "Søk åpne jobber | OpenJobSlots",
    homeDescription: "Finn ferske stillinger fra offentlige ATS-jobbtavler etter tittel, selskap, sted, remote-form og ferskhet.",
    landingDescription: "Søk ferske stillinger fra offentlige ATS-jobbtavler etter selskap, sted, remote-form og ferskhet.",
    landingLabels: {
      "job-search": "Åpne jobber",
      remote: "Remote jobber",
      "software-engineer": "Software engineer jobber",
      "product-manager": "Product manager jobber",
      "technical-support": "Technical support jobber",
      "data-analyst": "Data analyst jobber",
      "customer-success": "Customer success manager jobber",
      "devops-engineer": "DevOps engineer jobber"
    }
  },
  {
    languageCode: "fi",
    pathPrefix: "fi",
    homeTitle: "Etsi avoimia työpaikkoja | OpenJobSlots",
    homeDescription: "Löydä tuoreet ilmoitukset julkisilta ATS-työpaikkasivuilta nimikkeen, yrityksen, sijainnin, etätyön ja tuoreuden mukaan.",
    landingDescription: "Etsi tuoreita työpaikkoja julkisilta ATS-sivuilta yrityksen, sijainnin, etätyön ja tuoreuden mukaan.",
    landingLabels: {
      "job-search": "Avoimet työpaikat",
      remote: "Etätyöpaikat",
      "software-engineer": "Software engineer työpaikat",
      "product-manager": "Product manager työpaikat",
      "technical-support": "Technical support työpaikat",
      "data-analyst": "Data analyst työpaikat",
      "customer-success": "Customer success manager työpaikat",
      "devops-engineer": "DevOps engineer työpaikat"
    }
  }
]);

const PUBLIC_SEO_HOME_PAGES = Object.freeze([
  ...PUBLIC_SEO_BASE_HOME_PAGES,
  ...PUBLIC_SEO_ADDITIONAL_LANGUAGE_CONFIGS.map((config) => ({
    languageCode: config.languageCode,
    path: `/${config.pathPrefix}`,
    title: config.homeTitle,
    description: config.homeDescription
  }))
]);

const PUBLIC_SEO_BASE_LANDING_GROUPS = Object.freeze([
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
  },
  {
    key: "data-analyst",
    canonicalSearchQuery: "data analyst",
    pages: [
      {
        languageCode: "en",
        path: "/en/data-analyst-jobs",
        searchQuery: "data analyst jobs",
        title: "Data analyst jobs | OpenJobSlots",
        description: "Search fresh data analyst jobs from public ATS boards by company, location, remote mode, source, and posting freshness."
      },
      {
        languageCode: "tr",
        path: "/tr/data-analyst-is-ilanlari",
        searchQuery: "data analyst iş ilanları",
        title: "Data analyst iş ilanları | OpenJobSlots",
        description: "Güncel data analyst iş ilanlarını açık ATS kaynaklarından şirket, lokasyon, remote mod ve ilan tazeliğine göre ara."
      },
      {
        languageCode: "de",
        path: "/de/data-analyst-jobs",
        searchQuery: "data analyst jobs",
        title: "Data Analyst Jobs | OpenJobSlots",
        description: "Finde aktuelle Data Analyst Jobs aus öffentlichen ATS-Jobbörsen nach Unternehmen, Standort, Remote-Modus und Aktualität."
      },
      {
        languageCode: "fr",
        path: "/fr/emplois-data-analyst",
        searchQuery: "emplois data analyst",
        title: "Emplois Data Analyst | OpenJobSlots",
        description: "Recherchez des emplois Data Analyst récents sur des jobboards ATS publics par entreprise, lieu, mode remote et fraîcheur."
      },
      {
        languageCode: "es",
        path: "/es/empleos-data-analyst",
        searchQuery: "empleos data analyst",
        title: "Empleos Data Analyst | OpenJobSlots",
        description: "Busca empleos Data Analyst recientes en bolsas ATS públicas por empresa, ubicación, modalidad remota y frescura."
      }
    ]
  },
  {
    key: "customer-success",
    canonicalSearchQuery: "customer success manager",
    pages: [
      {
        languageCode: "en",
        path: "/en/customer-success-manager-jobs",
        searchQuery: "customer success manager jobs",
        title: "Customer success manager jobs | OpenJobSlots",
        description: "Search fresh customer success manager jobs from public ATS boards, including remote, hybrid, and local openings."
      },
      {
        languageCode: "tr",
        path: "/tr/customer-success-manager-is-ilanlari",
        searchQuery: "customer success manager iş ilanları",
        title: "Customer success manager iş ilanları | OpenJobSlots",
        description: "Güncel customer success manager iş ilanlarını açık ATS kaynaklarından remote, hibrit ve yerel seçeneklerle ara."
      },
      {
        languageCode: "de",
        path: "/de/customer-success-manager-jobs",
        searchQuery: "customer success manager jobs",
        title: "Customer Success Manager Jobs | OpenJobSlots",
        description: "Finde aktuelle Customer Success Manager Jobs aus öffentlichen ATS-Jobbörsen, inklusive Remote-, Hybrid- und lokalen Rollen."
      },
      {
        languageCode: "fr",
        path: "/fr/emplois-customer-success-manager",
        searchQuery: "emplois customer success manager",
        title: "Emplois Customer Success Manager | OpenJobSlots",
        description: "Recherchez des emplois Customer Success Manager récents sur des jobboards ATS publics, avec filtres remote, hybride et lieu."
      },
      {
        languageCode: "es",
        path: "/es/empleos-customer-success-manager",
        searchQuery: "empleos customer success manager",
        title: "Empleos Customer Success Manager | OpenJobSlots",
        description: "Busca empleos Customer Success Manager recientes en bolsas ATS públicas con filtros de remoto, híbrido y ubicación."
      }
    ]
  },
  {
    key: "devops-engineer",
    canonicalSearchQuery: "devops engineer",
    pages: [
      {
        languageCode: "en",
        path: "/en/devops-engineer-jobs",
        searchQuery: "devops engineer jobs",
        title: "DevOps engineer jobs | OpenJobSlots",
        description: "Search fresh DevOps engineer jobs from public ATS boards by cloud, platform, infrastructure, remote mode, and freshness."
      },
      {
        languageCode: "tr",
        path: "/tr/devops-engineer-is-ilanlari",
        searchQuery: "devops engineer iş ilanları",
        title: "DevOps engineer iş ilanları | OpenJobSlots",
        description: "Güncel DevOps engineer iş ilanlarını açık ATS kaynaklarından cloud, platform, altyapı, remote mod ve tazelikle ara."
      },
      {
        languageCode: "de",
        path: "/de/devops-engineer-jobs",
        searchQuery: "devops engineer jobs",
        title: "DevOps Engineer Jobs | OpenJobSlots",
        description: "Finde aktuelle DevOps Engineer Jobs aus öffentlichen ATS-Jobbörsen nach Cloud, Plattform, Infrastruktur und Remote-Modus."
      },
      {
        languageCode: "fr",
        path: "/fr/emplois-devops-engineer",
        searchQuery: "emplois devops engineer",
        title: "Emplois DevOps Engineer | OpenJobSlots",
        description: "Recherchez des emplois DevOps Engineer récents sur des jobboards ATS publics par cloud, plateforme, infrastructure et remote."
      },
      {
        languageCode: "es",
        path: "/es/empleos-devops-engineer",
        searchQuery: "empleos devops engineer",
        title: "Empleos DevOps Engineer | OpenJobSlots",
        description: "Busca empleos DevOps Engineer recientes en bolsas ATS públicas por cloud, plataforma, infraestructura y modalidad remota."
      }
    ]
  }
]);

const PUBLIC_SEO_GENERATED_LANDING_SLUG_BY_KEY = Object.freeze({
  "job-search": "job-openings",
  remote: "remote-job-openings",
  "software-engineer": "software-engineer-jobs",
  "product-manager": "product-manager-jobs",
  "technical-support": "technical-support-engineer-jobs",
  "data-analyst": "data-analyst-jobs",
  "customer-success": "customer-success-manager-jobs",
  "devops-engineer": "devops-engineer-jobs"
});

function buildAdditionalSeoLandingPage(group, config) {
  const slug = PUBLIC_SEO_GENERATED_LANDING_SLUG_BY_KEY[group.key] || String(group.key || "jobs").replace(/[^a-z0-9]+/gi, "-");
  const label = config.landingLabels?.[group.key] || group.canonicalSearchQuery || group.key;
  return {
    languageCode: config.languageCode,
    path: `/${config.pathPrefix}/${slug}`,
    searchQuery: group.canonicalSearchQuery || label,
    canonicalSearchQuery: group.canonicalSearchQuery || label,
    title: `${label} | OpenJobSlots`,
    description: `${label}: ${config.landingDescription}`
  };
}

const PUBLIC_SEO_LANDING_GROUPS = Object.freeze(
  PUBLIC_SEO_BASE_LANDING_GROUPS.map((group) => ({
    ...group,
    pages: [
      ...group.pages,
      ...PUBLIC_SEO_ADDITIONAL_LANGUAGE_CONFIGS.map((config) => buildAdditionalSeoLandingPage(group, config))
    ]
  }))
);

function createAtsSourcePage(config) {
  const label = String(config.label || config.key || "").trim();
  const searchLabel = String(config.searchLabel || label).trim();
  const publicPattern = String(config.publicPattern || `public ${label} employer career pages`).trim();
  const lowerSearchLabel = searchLabel.toLowerCase();
  return {
    path: `/ats/${config.slug}-jobs`,
    atsSourceKey: config.key,
    searchQuery: `${lowerSearchLabel} jobs`,
    canonicalSearchQuery: config.canonicalSearchQuery || config.key,
    title: `${label} jobs | OpenJobSlots`,
    description: `Search fresh public ${label} job openings indexed by OpenJobSlots.`,
    contentParagraphs: config.contentParagraphs || [
      `${label} jobs often appear on ${publicPattern} before they are copied into broad job boards. OpenJobSlots gives this source a stable public search entry while keeping the employer apply URL as the canonical destination.`,
      `This page is part of the ATS source sitemap pilot for public job discovery across ${label}-backed employers. It keeps source evidence conservative for location, remote mode, posting date, source identity, and company names instead of inventing missing fields.`
    ],
    faqItems: config.faqItems || [
      {
        question: `Is OpenJobSlots affiliated with ${label}?`,
        answer: `No. This is an independent search entry for public employer job postings that use ${label}-style public hiring pages.`
      },
      {
        question: `Why search ${label} jobs here?`,
        answer: `OpenJobSlots connects ${label}-backed public postings with role, company, location, remote-mode, source, and freshness filters across the wider public ATS index.`
      }
    ]
  };
}

const PUBLIC_SEO_ATS_SOURCE_CONFIGS = Object.freeze([
  {
    key: "greenhouse",
    slug: "greenhouse",
    label: "Greenhouse",
    publicPattern: "public Greenhouse boards and employer career pages",
    contentParagraphs: [
      "Greenhouse jobs often live on employer career pages before they are copied into broad job boards. OpenJobSlots uses public Greenhouse posting pages as source evidence, keeps the employer apply URL as the canonical destination, and lets job seekers search those openings alongside other ATS-backed sources.",
      "Use this page when you want a Greenhouse-focused entry point without depending on one employer board at a time. It is built for public job discovery, not partnership claims, scraping private systems, or exposing internal diagnostics."
    ],
    faqItems: [
      {
        question: "Is OpenJobSlots affiliated with Greenhouse?",
        answer: "No. This page is an independent search entry for public employer job postings that use Greenhouse-style public boards."
      },
      {
        question: "Why search Greenhouse jobs here?",
        answer: "OpenJobSlots can connect Greenhouse postings with role, company, location, remote-mode, source, and freshness filters across the wider public ATS index."
      }
    ]
  },
  {
    key: "lever",
    slug: "lever",
    label: "Lever",
    publicPattern: "jobs.lever.co and employer-hosted Lever pages",
    contentParagraphs: [
      "Lever job posts are frequently hosted on public employer career pages and jobs.lever.co style URLs. OpenJobSlots treats the public employer posting as the source of truth and links users back to the original apply page instead of replacing the employer workflow.",
      "This page is designed as an independent search entry for people searching across many Lever-backed companies at once. It also gives crawlers a stable explanation of how Lever source intent fits into the broader OpenJobSlots public job index."
    ],
    faqItems: [
      {
        question: "What does jobs.lever.co mean?",
        answer: "It usually indicates a public employer job page powered by Lever. OpenJobSlots indexes public posting fields and keeps the employer apply link canonical."
      },
      {
        question: "Are Lever jobs private listings?",
        answer: "No. OpenJobSlots only uses public employer postings and does not claim access to private or internal Lever data."
      }
    ]
  },
  {
    key: "ashby",
    slug: "ashby",
    label: "Ashby",
    publicPattern: "public Ashby boards and company career pages",
    contentParagraphs: [
      "Ashby boards are common with fast-growing teams, startups, and modern hiring workflows. OpenJobSlots gives Ashby jobs a public search entry that can be discovered by role, company, location, remote mode, source, and freshness.",
      "The goal is direct employer discovery. OpenJobSlots does not invent missing posting data, and it keeps ambiguous source evidence conservative while parser-backed coverage improves."
    ],
    faqItems: [
      {
        question: "Can I search Ashby jobs by role?",
        answer: "Yes. Use the interactive search page after this landing page loads to filter Ashby-backed postings by role, company, location, remote mode, and freshness."
      },
      {
        question: "Does OpenJobSlots change the apply flow?",
        answer: "No. Employer apply links remain the canonical destination for each public Ashby posting."
      }
    ]
  },
  {
    key: "workday",
    slug: "workday",
    label: "Workday",
    publicPattern: "public Workday candidate experience pages",
    contentParagraphs: [
      "Workday jobs are a high-demand source intent because many large employers publish openings through Workday candidate experience pages. OpenJobSlots presents this as a public search entry and avoids claiming official access or partnership.",
      "Workday source coverage should stay conservative: public fields are indexed when source evidence is clear, while uncertain location, date, remote, or source-id data is not promoted into fake public values."
    ],
    faqItems: [
      {
        question: "Are Workday jobs official employer postings?",
        answer: "OpenJobSlots links back to public employer apply pages. The employer page remains the canonical source for the posting."
      },
      {
        question: "Why is Workday search harder than smaller ATS sources?",
        answer: "Large employers, regional variants, and candidate-experience routes make source evidence important. OpenJobSlots keeps the public page conservative while indexing clear public posting data."
      }
    ]
  },
  {
    key: "bamboohr",
    slug: "bamboohr",
    label: "BambooHR",
    publicPattern: "public BambooHR career pages",
    contentParagraphs: [
      "BambooHR job openings are often published by smaller and mid-sized employers that may not get broad distribution on larger job boards. OpenJobSlots uses public BambooHR career pages as part of a wider direct-employer search surface.",
      "This route gives users and crawlers a stable page for BambooHR source intent while preserving the OpenJobSlots quality rule: public source evidence first, no invented data, and direct employer apply links kept canonical."
    ],
    faqItems: [
      {
        question: "Can BambooHR openings be searched with other ATS jobs?",
        answer: "Yes. OpenJobSlots combines BambooHR-backed public postings with other supported public ATS sources in one searchable interface."
      },
      {
        question: "Does this page list private BambooHR data?",
        answer: "No. It is limited to public employer job postings and public-safe posting fields."
      }
    ]
  },
  { key: "applytojob", slug: "applytojob", label: "ApplyToJob", publicPattern: "public ApplyToJob employer boards" },
  { key: "breezy", slug: "breezy", label: "Breezy", publicPattern: "public Breezy HR career pages" },
  { key: "icims", slug: "icims", label: "iCIMS", publicPattern: "public iCIMS career portals" },
  { key: "hrmdirect", slug: "hrmdirect", label: "HRMDirect", publicPattern: "public HRMDirect openings pages" },
  { key: "recruitee", slug: "recruitee", label: "Recruitee", publicPattern: "public Recruitee company career pages" },
  { key: "teamtailor", slug: "teamtailor", label: "Teamtailor", publicPattern: "public Teamtailor career sites" },
  { key: "jobvite", slug: "jobvite", label: "Jobvite", publicPattern: "public Jobvite employer portals" },
  { key: "rippling", slug: "rippling", label: "Rippling", publicPattern: "public Rippling jobs pages" },
  { key: "zoho", slug: "zoho", label: "Zoho Recruit", searchLabel: "zoho recruit", publicPattern: "public Zoho Recruit career pages" },
  { key: "applicantpro", slug: "applicantpro", label: "ApplicantPro", publicPattern: "public ApplicantPro employer boards" },
  { key: "applitrack", slug: "applitrack", label: "AppliTrack", publicPattern: "public AppliTrack school and district pages" },
  { key: "freshteam", slug: "freshteam", label: "Freshteam", publicPattern: "public Freshteam career pages" },
  { key: "ultipro", slug: "ultipro", label: "UKG Pro", searchLabel: "ukg pro", publicPattern: "public UKG Pro and UltiPro career pages" },
  { key: "adpmyjobs", slug: "adp-myjobs", label: "ADP MyJobs", publicPattern: "public ADP MyJobs employer pages" },
  { key: "adpworkforcenow", slug: "adp-workforce-now", label: "ADP Workforce Now", publicPattern: "public ADP Workforce Now career pages" },
  { key: "paylocity", slug: "paylocity", label: "Paylocity", publicPattern: "public Paylocity career portals" },
  { key: "careerplug", slug: "careerplug", label: "CareerPlug", publicPattern: "public CareerPlug employer job pages" },
  { key: "pinpointhq", slug: "pinpointhq", label: "Pinpoint", searchLabel: "pinpoint", publicPattern: "public PinpointHQ career pages" },
  { key: "join", slug: "join", label: "JOIN", publicPattern: "public JOIN employer job pages" },
  { key: "manatal", slug: "manatal", label: "Manatal", publicPattern: "public Manatal career pages" },
  { key: "isolvisolvedhire", slug: "isolved-hire", label: "isolved Hire", searchLabel: "isolved hire", publicPattern: "public isolved Hire career pages" },
  { key: "taleo", slug: "taleo", label: "Taleo", publicPattern: "public Taleo career-section pages" },
  { key: "dayforcehcm", slug: "dayforce", label: "Dayforce", publicPattern: "public Dayforce HCM career pages" },
  { key: "hibob", slug: "hibob", label: "HiBob", publicPattern: "public HiBob jobs pages" },
  { key: "applicantai", slug: "applicantai", label: "ApplicantAI", publicPattern: "public ApplicantAI career pages" },
  { key: "brassring", slug: "brassring", label: "BrassRing", publicPattern: "public BrassRing employer portals" },
  { key: "hirebridge", slug: "hirebridge", label: "Hirebridge", publicPattern: "public Hirebridge job boards" },
  { key: "pageup", slug: "pageup", label: "PageUp", publicPattern: "public PageUp career pages" },
  { key: "talentlyft", slug: "talentlyft", label: "TalentLyft", publicPattern: "public TalentLyft career pages" },
  { key: "talentreef", slug: "talentreef", label: "TalentReef", publicPattern: "public TalentReef employer pages" },
  { key: "theapplicantmanager", slug: "the-applicant-manager", label: "The Applicant Manager", publicPattern: "public The Applicant Manager career pages" },
  { key: "careerspage", slug: "careerspage", label: "CareersPage", publicPattern: "public CareersPage employer sites" },
  { key: "oracle", slug: "oracle", label: "Oracle Recruiting", searchLabel: "oracle recruiting", publicPattern: "public Oracle Recruiting career pages" },
  { key: "sagehr", slug: "sagehr", label: "Sage HR", publicPattern: "public Sage HR career pages" },
  { key: "loxo", slug: "loxo", label: "Loxo", publicPattern: "public Loxo career and recruiter pages" },
  { key: "peopleforce", slug: "peopleforce", label: "PeopleForce", publicPattern: "public PeopleForce career pages" },
  { key: "getro", slug: "getro", label: "Getro", publicPattern: "public Getro network job boards" },
  { key: "eightfold", slug: "eightfold", label: "Eightfold", publicPattern: "public Eightfold career pages" },
  { key: "careerpuck", slug: "careerpuck", label: "CareerPuck", publicPattern: "public CareerPuck employer pages" }
]);

const PUBLIC_SEO_ATS_PAGES = Object.freeze(PUBLIC_SEO_ATS_SOURCE_CONFIGS.map(createAtsSourcePage));

const PUBLIC_SEO_CONTENT_PAGES = Object.freeze([
  {
    path: "/en/ats-job-boards",
    languageCode: "en",
    searchQuery: "ats jobs",
    canonicalSearchQuery: "ats jobs",
    searchIntent: "ats-job-boards",
    contentCluster: "source-education",
    title: "ATS job boards | OpenJobSlots",
    description: "Find jobs from public ATS job boards and employer career pages, including Greenhouse, Lever, Ashby, Workday, BambooHR, and more.",
    contentParagraphs: [
      "ATS job boards are the public hiring pages employers use to publish openings before candidates apply. Instead of treating every job board repost as equal, OpenJobSlots focuses on public employer ATS sources where the original apply link, source platform, location, remote mode, and freshness can be tied back to source evidence.",
      "This page is the educational hub for ATS-backed job search. It connects broad ATS jobs intent with specific public source pages such as Greenhouse, Lever, Ashby, Workday, and BambooHR, giving crawlers and users a clearer path than a generic remote-jobs page."
    ],
    faqItems: [
      {
        question: "What is an ATS job board?",
        answer: "It is a public employer hiring page powered by an applicant tracking system. OpenJobSlots indexes public posting fields from those pages and links users back to the employer apply flow."
      },
      {
        question: "Why use ATS job boards for search?",
        answer: "They are closer to the employer source than reposted listings, so they can be better for freshness, direct apply links, and canonical posting evidence."
      }
    ]
  },
  {
    path: "/en/company-career-page-jobs",
    languageCode: "en",
    searchQuery: "company career pages jobs",
    canonicalSearchQuery: "company career pages jobs",
    searchIntent: "company-career-page-jobs",
    contentCluster: "direct-employer",
    title: "Company career page jobs | OpenJobSlots",
    description: "Search fresh jobs from public company career pages and employer ATS boards with direct apply links.",
    contentParagraphs: [
      "Company career page jobs are often the cleanest version of a posting because they come from the employer page that owns the apply flow. OpenJobSlots makes those public postings searchable across companies, roles, sources, remote modes, and locations without hiding the original employer destination.",
      "This is the long-tail SEO surface competitors often win with company pages. OpenJobSlots should compete by emphasizing public employer source evidence, canonical apply URLs, freshness, and broad ATS coverage instead of creating thin company pages before inventory is deep enough."
    ],
    faqItems: [
      {
        question: "Are company career page jobs different from job-board reposts?",
        answer: "Often yes. The company career page is closer to the employer source and usually contains the canonical apply destination."
      },
      {
        question: "Will OpenJobSlots create company pages for every employer?",
        answer: "Only when public posting inventory and canonical company data are strong enough. Thin company pages should stay out of the sitemap."
      }
    ]
  },
  {
    path: "/en/direct-apply-jobs",
    languageCode: "en",
    searchQuery: "direct apply jobs",
    canonicalSearchQuery: "direct apply jobs",
    searchIntent: "direct-apply-jobs",
    contentCluster: "direct-employer",
    title: "Direct apply jobs | OpenJobSlots",
    description: "Find direct apply jobs from public employer career pages and ATS boards, with canonical links back to the source posting.",
    contentParagraphs: [
      "Direct apply jobs are openings where the useful destination is the employer's own apply page, not a copied listing several layers away from the source. OpenJobSlots is built around that idea: discover the public posting, normalize public-safe fields, and send candidates back to the canonical employer apply URL.",
      "This page should become a backlink asset because it explains the product difference in plain language. The promise is not exclusive access; the promise is fresher public employer discovery, better source transparency, and a cleaner path from search result to original apply flow."
    ],
    faqItems: [
      {
        question: "What does direct apply mean?",
        answer: "It means the job result points back to the employer's own public apply page or ATS posting instead of making the candidate apply through a third-party repost."
      },
      {
        question: "Does OpenJobSlots guarantee every result is still open?",
        answer: "No job search product can guarantee that after an employer changes a posting, but OpenJobSlots prioritizes public source freshness and canonical employer links."
      }
    ]
  },
  {
    path: "/en/hidden-jobs",
    languageCode: "en",
    searchQuery: "hidden jobs",
    canonicalSearchQuery: "hidden jobs",
    searchIntent: "hidden-jobs",
    contentCluster: "direct-employer",
    title: "Hidden jobs from public employer career pages | OpenJobSlots",
    description: "Find hidden jobs in the practical sense: public employer career-page openings that may not be easy to discover on broad job boards yet.",
    contentParagraphs: [
      "Hidden jobs should not mean private, leaked, or internal roles. For OpenJobSlots, the phrase means public employer career-page openings that are easy to miss because they live across thousands of ATS boards, company pages, regional portals, and source-specific routes.",
      "Hidden Jobs and similar competitors prove that the positioning has search demand. OpenJobSlots can be stronger by pairing the phrase with transparent source rules: public pages only, canonical employer apply links, conservative parser evidence, and no claim of exclusive or non-public access."
    ],
    faqItems: [
      {
        question: "Are these hidden jobs private?",
        answer: "No. OpenJobSlots only indexes public employer postings. Hidden means hard to discover across scattered career pages, not private or leaked."
      },
      {
        question: "Why can public jobs be hard to find?",
        answer: "Many employers publish openings on separate ATS boards or company pages before those jobs appear consistently across broad aggregators."
      }
    ]
  },
  {
    path: "/en/jobs-not-on-linkedin",
    languageCode: "en",
    searchQuery: "jobs not on linkedin",
    canonicalSearchQuery: "jobs not on linkedin",
    searchIntent: "jobs-not-on-linkedin",
    contentCluster: "direct-employer",
    title: "Jobs not on LinkedIn | OpenJobSlots",
    description: "Search public employer career-page jobs that may not be visible on LinkedIn or broad reposting sites yet.",
    contentParagraphs: [
      "Jobs not on LinkedIn is a real search intent, but the page needs careful wording. OpenJobSlots should not promise that a posting is absent from LinkedIn; it should explain that many public employer ATS postings can be discovered directly from company career pages before or outside broad reposting channels.",
      "This page gives OpenJobSlots a defensible content angle against large boards: source-first discovery, direct employer apply links, and structured public search across many ATS families. It should link into ATS job boards, direct apply jobs, hidden jobs, and role pages so crawlers see the full topic cluster."
    ],
    faqItems: [
      {
        question: "Can OpenJobSlots prove a job is not on LinkedIn?",
        answer: "No. The safer claim is that OpenJobSlots searches public employer career pages and ATS boards directly, including openings candidates may not find on broad reposting sites."
      },
      {
        question: "Why search beyond LinkedIn?",
        answer: "Employer career pages can expose fresh, direct-apply postings with source context before a role is broadly redistributed."
      }
    ]
  }
]);

const PUBLIC_SEO_ROUTES = Object.freeze([
  ...PUBLIC_SEO_HOME_PAGES.map((page) => ({
    ...page,
    alternateGroup: "home",
    pageType: "home",
    sitemapSection: "static",
    changefreq: "daily",
    priority: "0.9"
  })),
  ...PUBLIC_SEO_LANDING_GROUPS.flatMap((group) =>
    group.pages.map((page) => ({
      ...page,
      alternateGroup: group.key,
      searchIntent: group.key,
      canonicalSearchQuery: page.canonicalSearchQuery || group.canonicalSearchQuery || page.searchQuery,
      pageType: "landing",
      sitemapSection: "static",
      changefreq: "daily",
      priority: "0.8"
    }))
  ),
  ...PUBLIC_SEO_CONTENT_PAGES.map((page) => ({
    ...page,
    canonicalSearchQuery: page.canonicalSearchQuery || page.searchQuery,
    pageType: "content",
    sitemapSection: "static",
    changefreq: "weekly",
    priority: "0.75"
  })),
  ...PUBLIC_SEO_ATS_PAGES.map((page) => ({
    ...page,
    languageCode: "en",
    pageType: "ats-source",
    sitemapSection: "ats-sources",
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
const PUBLIC_SEO_SUPPORTED_LANGUAGES = new Set(PUBLIC_SEO_HOME_PAGES.map((page) => page.languageCode));
const PUBLIC_SEO_LANGUAGE_CODE_BY_NORMALIZED = new Map(
  PUBLIC_SEO_HOME_PAGES.map((page) => [String(page.languageCode || "").toLowerCase(), page.languageCode])
);
const PUBLIC_SEO_PRIMARY_LANGUAGE_FALLBACKS = new Map([
  ["pt", "pt-BR"],
  ["zh", "zh-CN"],
  ...PUBLIC_SEO_HOME_PAGES
    .filter((page) => !String(page.languageCode || "").includes("-"))
    .map((page) => [String(page.languageCode || "").toLowerCase(), page.languageCode])
]);

const PUBLIC_SEO_COUNTRY_POPULAR_FALLBACKS = Object.freeze({
  US: [
    { query: "remote jobs US" },
    { query: "software engineer US" },
    { query: "data analyst US" },
    { query: "customer support US" },
    { query: "product manager US" },
    { query: "sales jobs US" },
    { query: "marketing jobs US" },
    { query: "internship US" }
  ],
  GB: [
    { query: "remote jobs UK" },
    { query: "London jobs", labels: { en: "London jobs" } },
    { query: "software engineer UK" },
    { query: "data analyst UK" },
    { query: "customer support UK" },
    { query: "product manager UK" },
    { query: "sales jobs UK" },
    { query: "marketing jobs UK" }
  ],
  TR: [
    { query: "remote Turkiye", labels: { tr: "Uzaktan i\u015f ilanlar\u0131" } },
    { query: "Istanbul jobs", labels: { tr: "\u0130stanbul i\u015f ilanlar\u0131" } },
    { query: "Ankara jobs", labels: { tr: "Ankara i\u015f ilanlar\u0131" } },
    { query: "Turkey software", labels: { tr: "Yaz\u0131l\u0131m i\u015f ilanlar\u0131" } },
    { query: "data analyst Turkey", labels: { tr: "Veri analisti ilanlar\u0131" } },
    { query: "customer support Turkey", labels: { tr: "M\u00fc\u015fteri destek ilanlar\u0131" } },
    { query: "product manager Turkey", labels: { tr: "\u00dcr\u00fcn y\u00f6neticisi ilanlar\u0131" } },
    { query: "sales Turkey", labels: { tr: "Sat\u0131\u015f ilanlar\u0131" } }
  ],
  DE: [
    { query: "remote Germany", labels: { de: "Remote-Jobs Deutschland" } },
    { query: "Berlin jobs", labels: { de: "Jobs in Berlin" } },
    { query: "Munich jobs", labels: { de: "Jobs in M\u00fcnchen" } },
    { query: "software engineer Germany", labels: { de: "Softwareentwickler-Jobs" } },
    { query: "data analyst Germany", labels: { de: "Datenanalyst-Jobs" } },
    { query: "customer support Germany", labels: { de: "Kundensupport-Jobs" } },
    { query: "product manager Germany", labels: { de: "Produktmanager-Jobs" } },
    { query: "marketing Germany", labels: { de: "Marketing-Jobs" } }
  ],
  FR: [
    { query: "remote France", labels: { fr: "Emplois \u00e0 distance" } },
    { query: "Paris jobs", labels: { fr: "Emplois \u00e0 Paris" } },
    { query: "Lyon jobs", labels: { fr: "Emplois \u00e0 Lyon" } },
    { query: "software engineer France", labels: { fr: "Emplois ing\u00e9nieur logiciel" } },
    { query: "data analyst France", labels: { fr: "Emplois analyste de donn\u00e9es" } },
    { query: "customer support France", labels: { fr: "Emplois support client" } },
    { query: "product manager France", labels: { fr: "Emplois chef de produit" } },
    { query: "marketing France", labels: { fr: "Emplois marketing" } }
  ],
  ES: [
    { query: "remote Spain", labels: { es: "Trabajos remotos en Espa\u00f1a" } },
    { query: "Madrid jobs", labels: { es: "Empleo en Madrid" } },
    { query: "Barcelona jobs", labels: { es: "Empleo en Barcelona" } },
    { query: "software engineer Spain", labels: { es: "Ingeniero de software en Espa\u00f1a" } },
    { query: "data analyst Spain", labels: { es: "Analista de datos en Espa\u00f1a" } },
    { query: "customer support Spain", labels: { es: "Atenci\u00f3n al cliente en Espa\u00f1a" } },
    { query: "product manager Spain", labels: { es: "Gerente de producto en Espa\u00f1a" } },
    { query: "intern Spain", labels: { es: "Pr\u00e1cticas en Espa\u00f1a" } }
  ],
  BR: [
    { query: "remote Brazil", labels: { "pt-BR": "Vagas remotas" } },
    { query: "Sao Paulo jobs", labels: { "pt-BR": "Vagas em S\u00e3o Paulo" } },
    { query: "Rio de Janeiro jobs", labels: { "pt-BR": "Vagas no Rio de Janeiro" } },
    { query: "software engineer Brazil", labels: { "pt-BR": "Engenheiro de software" } },
    { query: "data analyst Brazil", labels: { "pt-BR": "Analista de dados" } },
    { query: "customer support Brazil", labels: { "pt-BR": "Atendimento ao cliente" } },
    { query: "product manager Brazil", labels: { "pt-BR": "Gerente de produto" } },
    { query: "marketing Brazil", labels: { "pt-BR": "Vagas de marketing" } }
  ],
  PT: [
    { query: "remote Portugal", labels: { "pt-PT": "Empregos remotos" } },
    { query: "Lisbon jobs", labels: { "pt-PT": "Empregos em Lisboa" } },
    { query: "Porto jobs", labels: { "pt-PT": "Empregos no Porto" } },
    { query: "software engineer Portugal", labels: { "pt-PT": "Engenheiro de software" } },
    { query: "data analyst Portugal", labels: { "pt-PT": "Analista de dados" } },
    { query: "customer support Portugal", labels: { "pt-PT": "Apoio ao cliente" } },
    { query: "product manager Portugal", labels: { "pt-PT": "Gestor de produto" } },
    { query: "marketing Portugal", labels: { "pt-PT": "Empregos de marketing" } }
  ],
  IT: [
    { query: "remote Italy", labels: { it: "Lavoro da remoto" } },
    { query: "Milan jobs", labels: { it: "Offerte a Milano" } },
    { query: "Rome jobs", labels: { it: "Offerte a Roma" } },
    { query: "software engineer Italy", labels: { it: "Ingegnere software" } },
    { query: "data analyst Italy", labels: { it: "Analista dati" } },
    { query: "customer support Italy", labels: { it: "Assistenza clienti" } },
    { query: "product manager Italy", labels: { it: "Responsabile prodotto" } },
    { query: "marketing Italy", labels: { it: "Marketing" } }
  ],
  NL: [
    { query: "remote Netherlands", labels: { nl: "Remote vacatures" } },
    { query: "Amsterdam jobs", labels: { nl: "Vacatures Amsterdam" } },
    { query: "Rotterdam jobs", labels: { nl: "Vacatures Rotterdam" } },
    { query: "software engineer Netherlands", labels: { nl: "Softwareontwikkelaar vacatures" } },
    { query: "data analyst Netherlands", labels: { nl: "Data-analist vacatures" } },
    { query: "customer support Netherlands", labels: { nl: "Klantenservice vacatures" } },
    { query: "product manager Netherlands", labels: { nl: "Productmanager vacatures" } },
    { query: "marketing Netherlands", labels: { nl: "Marketing vacatures" } }
  ],
  PL: [
    { query: "remote Poland", labels: { pl: "Praca zdalna" } },
    { query: "Warsaw jobs", labels: { pl: "Praca Warszawa" } },
    { query: "Krakow jobs", labels: { pl: "Praca Krak\u00f3w" } },
    { query: "software engineer Poland", labels: { pl: "Programista" } },
    { query: "data analyst Poland", labels: { pl: "Analityk danych" } },
    { query: "customer support Poland", labels: { pl: "Obs\u0142uga klienta" } },
    { query: "product manager Poland", labels: { pl: "Mened\u017cer produktu" } },
    { query: "marketing Poland", labels: { pl: "Marketing pracy" } }
  ],
  JP: [
    { query: "remote Japan", labels: { ja: "\u30ea\u30e2\u30fc\u30c8\u6c42\u4eba" } },
    { query: "Tokyo jobs", labels: { ja: "\u6771\u4eac\u306e\u6c42\u4eba" } },
    { query: "Osaka jobs", labels: { ja: "\u5927\u962a\u306e\u6c42\u4eba" } },
    { query: "software engineer Japan", labels: { ja: "\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u30a8\u30f3\u30b8\u30cb\u30a2\u6c42\u4eba" } },
    { query: "data analyst Japan", labels: { ja: "\u30c7\u30fc\u30bf\u30a2\u30ca\u30ea\u30b9\u30c8\u6c42\u4eba" } },
    { query: "customer support Japan", labels: { ja: "\u30ab\u30b9\u30bf\u30de\u30fc\u30b5\u30dd\u30fc\u30c8\u6c42\u4eba" } },
    { query: "product manager Japan", labels: { ja: "\u30d7\u30ed\u30c0\u30af\u30c8\u30de\u30cd\u30fc\u30b8\u30e3\u30fc\u6c42\u4eba" } },
    { query: "english speaking Japan", labels: { ja: "\u82f1\u8a9e\u3092\u4f7f\u3046\u6c42\u4eba" } }
  ],
  KR: [
    { query: "remote Korea", labels: { ko: "\uc6d0\uaca9 \ucc44\uc6a9" } },
    { query: "Seoul jobs", labels: { ko: "\uc11c\uc6b8 \ucc44\uc6a9" } },
    { query: "software engineer Korea", labels: { ko: "\uc18c\ud504\ud2b8\uc6e8\uc5b4 \uc5d4\uc9c0\ub2c8\uc5b4 \ucc44\uc6a9" } },
    { query: "data analyst Korea", labels: { ko: "\ub370\uc774\ud130 \uc560\ub110\ub9ac\uc2a4\ud2b8 \ucc44\uc6a9" } },
    { query: "customer support Korea", labels: { ko: "\uace0\uac1d \uc9c0\uc6d0 \ucc44\uc6a9" } },
    { query: "product manager Korea", labels: { ko: "\ud504\ub85c\ub355\ud2b8 \ub9e4\ub2c8\uc800 \ucc44\uc6a9" } },
    { query: "marketing Korea", labels: { ko: "\ub9c8\ucf00\ud305 \ucc44\uc6a9" } },
    { query: "startup Korea", labels: { ko: "\uc2a4\ud0c0\ud2b8\uc5c5 \ucc44\uc6a9" } }
  ],
  CN: [
    { query: "remote China", labels: { "zh-CN": "\u8fdc\u7a0b\u804c\u4f4d" } },
    { query: "Shanghai jobs", labels: { "zh-CN": "\u4e0a\u6d77\u804c\u4f4d" } },
    { query: "Beijing jobs", labels: { "zh-CN": "\u5317\u4eac\u804c\u4f4d" } },
    { query: "software engineer China", labels: { "zh-CN": "\u8f6f\u4ef6\u5de5\u7a0b\u5e08\u804c\u4f4d" } },
    { query: "data analyst China", labels: { "zh-CN": "\u6570\u636e\u5206\u6790\u5e08\u804c\u4f4d" } },
    { query: "customer support China", labels: { "zh-CN": "\u5ba2\u6237\u652f\u6301\u804c\u4f4d" } },
    { query: "product manager China", labels: { "zh-CN": "\u4ea7\u54c1\u7ecf\u7406\u804c\u4f4d" } },
    { query: "Hong Kong jobs", labels: { "zh-CN": "\u9999\u6e2f\u804c\u4f4d" } }
  ],
  IN: [
    { query: "remote India", labels: { hi: "\u0930\u093f\u092e\u094b\u091f \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902" } },
    { query: "Bangalore jobs", labels: { hi: "\u092c\u0948\u0902\u0917\u0932\u094b\u0930 \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902" } },
    { query: "Delhi jobs", labels: { hi: "\u0926\u093f\u0932\u094d\u0932\u0940 \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902" } },
    { query: "Mumbai jobs", labels: { hi: "\u092e\u0941\u0902\u092c\u0908 \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902" } },
    { query: "software engineer India", labels: { hi: "\u0938\u0949\u092b\u094d\u091f\u0935\u0947\u092f\u0930 \u0907\u0902\u091c\u0940\u0928\u093f\u092f\u0930" } },
    { query: "data analyst India", labels: { hi: "\u0921\u0947\u091f\u093e \u090f\u0928\u093e\u0932\u093f\u0938\u094d\u091f" } },
    { query: "customer support India", labels: { hi: "\u0915\u0938\u094d\u091f\u092e\u0930 \u0938\u092a\u094b\u0930\u094d\u091f" } },
    { query: "product manager India", labels: { hi: "\u092a\u094d\u0930\u094b\u0921\u0915\u094d\u091f \u092e\u0948\u0928\u0947\u091c\u0930" } }
  ],
  AE: [
    { query: "remote Dubai", labels: { ar: "\u0648\u0638\u0627\u0626\u0641 \u0639\u0646 \u0628\u0639\u062f" } },
    { query: "Dubai jobs", labels: { ar: "\u0648\u0638\u0627\u0626\u0641 \u062f\u0628\u064a" } },
    { query: "Abu Dhabi jobs", labels: { ar: "\u0648\u0638\u0627\u0626\u0641 \u0623\u0628\u0648 \u0638\u0628\u064a" } },
    { query: "software engineer Dubai", labels: { ar: "\u0645\u0647\u0646\u062f\u0633 \u0628\u0631\u0645\u062c\u064a\u0627\u062a" } },
    { query: "data analyst Dubai", labels: { ar: "\u0645\u062d\u0644\u0644 \u0628\u064a\u0627\u0646\u0627\u062a" } },
    { query: "customer support Dubai", labels: { ar: "\u062f\u0639\u0645 \u0627\u0644\u0639\u0645\u0644\u0627\u0621" } },
    { query: "product manager Dubai", labels: { ar: "\u0645\u062f\u064a\u0631 \u0645\u0646\u062a\u062c" } },
    { query: "sales Dubai", labels: { ar: "\u0645\u0628\u064a\u0639\u0627\u062a" } }
  ],
  ID: [
    { query: "remote Indonesia", labels: { id: "Lowongan remote" } },
    { query: "Jakarta jobs", labels: { id: "Lowongan Jakarta" } },
    { query: "Bali jobs", labels: { id: "Lowongan Bali" } },
    { query: "software engineer Indonesia", labels: { id: "Insinyur software" } },
    { query: "data analyst Indonesia", labels: { id: "Analis data" } },
    { query: "customer support Indonesia", labels: { id: "Layanan pelanggan" } },
    { query: "product manager Indonesia", labels: { id: "Manajer produk" } },
    { query: "marketing Indonesia", labels: { id: "Lowongan pemasaran" } }
  ],
  SE: [
    { query: "remote Sweden", labels: { sv: "Remotejobb" } },
    { query: "Stockholm jobs", labels: { sv: "Jobb i Stockholm" } },
    { query: "Gothenburg jobs", labels: { sv: "Jobb i G\u00f6teborg" } },
    { query: "software engineer Sweden", labels: { sv: "Mjukvaruingenj\u00f6r" } },
    { query: "data analyst Sweden", labels: { sv: "Dataanalytiker" } },
    { query: "customer support Sweden", labels: { sv: "Kundsupport" } },
    { query: "product manager Sweden", labels: { sv: "Produktchef" } },
    { query: "marketing Sweden", labels: { sv: "Marknadsf\u00f6ringsjobb" } }
  ],
  DK: [
    { query: "remote Denmark", labels: { da: "Remote job" } },
    { query: "Copenhagen jobs", labels: { da: "Job i K\u00f8benhavn" } },
    { query: "Aarhus jobs", labels: { da: "Job i Aarhus" } },
    { query: "software engineer Denmark", labels: { da: "Softwareingeni\u00f8r" } },
    { query: "data analyst Denmark", labels: { da: "Dataanalytiker" } },
    { query: "customer support Denmark", labels: { da: "Kundesupport" } },
    { query: "product manager Denmark", labels: { da: "Produktchef" } },
    { query: "marketing Denmark", labels: { da: "Marketingjob" } }
  ],
  NO: [
    { query: "remote Norway", labels: { no: "Remotejobber" } },
    { query: "Oslo jobs", labels: { no: "Jobber i Oslo" } },
    { query: "Bergen jobs", labels: { no: "Jobber i Bergen" } },
    { query: "software engineer Norway", labels: { no: "Programvareingeni\u00f8r" } },
    { query: "data analyst Norway", labels: { no: "Dataanalytiker" } },
    { query: "customer support Norway", labels: { no: "Kundest\u00f8tte" } },
    { query: "product manager Norway", labels: { no: "Produktsjef" } },
    { query: "marketing Norway", labels: { no: "Markedsf\u00f8ringsjobber" } }
  ],
  FI: [
    { query: "remote Finland", labels: { fi: "Et\u00e4ty\u00f6paikat" } },
    { query: "Helsinki jobs", labels: { fi: "Ty\u00f6paikat Helsingiss\u00e4" } },
    { query: "Espoo jobs", labels: { fi: "Ty\u00f6paikat Espoossa" } },
    { query: "software engineer Finland", labels: { fi: "Ohjelmistoinsin\u00f6\u00f6ri" } },
    { query: "data analyst Finland", labels: { fi: "Data-analyytikko" } },
    { query: "customer support Finland", labels: { fi: "Asiakastuki" } },
    { query: "product manager Finland", labels: { fi: "Tuotep\u00e4\u00e4llikk\u00f6" } },
    { query: "marketing Finland", labels: { fi: "Markkinointity\u00f6t" } }
  ]
});

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

function normalizePublicSeoLanguageCode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!normalized) return "en";
  const exact = PUBLIC_SEO_LANGUAGE_CODE_BY_NORMALIZED.get(normalized);
  if (exact) return exact;
  const primary = normalized.split("-")[0];
  return PUBLIC_SEO_PRIMARY_LANGUAGE_FALLBACKS.get(primary) || "en";
}

function getPublicSeoLandingRoutesForLanguage(languageCode, limit = SEO_LANDING_LINK_LIMIT) {
  const normalizedLanguageCode = normalizePublicSeoLanguageCode(languageCode);
  const localizedRoutes = PUBLIC_SEO_ROUTES.filter(
    (route) => route.languageCode === normalizedLanguageCode && route.alternateGroup && route.alternateGroup !== "home"
  );
  const supplementalRoutes = normalizedLanguageCode === "en"
    ? PUBLIC_SEO_ROUTES.filter((route) => route.contentCluster || String(route.path || "").startsWith("/ats/"))
    : [];
  const seen = new Set();
  return [...localizedRoutes, ...supplementalRoutes]
    .filter((route) => {
      if (!route?.path || seen.has(route.path)) return false;
      seen.add(route.path);
      return true;
    })
    .slice(0, Math.max(1, Math.min(20, Number(limit || SEO_LANDING_LINK_LIMIT))));
}

function getPublicSeoHomePathForLanguage(languageCode) {
  const normalizedLanguageCode = normalizePublicSeoLanguageCode(languageCode);
  return PUBLIC_SEO_HOME_PAGES.find((page) => page.languageCode === normalizedLanguageCode)?.path || "/en";
}

function getPublicSeoQueryLandingPath(languageCode, query) {
  const normalizedQuery = String(query || "").replace(/\s+/g, " ").trim();
  if (!normalizedQuery) return getPublicSeoHomePathForLanguage(languageCode);
  return `${getPublicSeoHomePathForLanguage(languageCode)}?q=${encodeURIComponent(normalizedQuery)}`;
}

function getPublicSeoPopularQueryLabel(query) {
  const acronyms = new Set(["ai", "api", "qa", "ui", "uae", "uk", "us", "usa", "ux"]);
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

const PUBLIC_SEO_POPULAR_LABEL_COPY = Object.freeze({
  en: {
    jobsCountry: "{country} jobs",
    jobsPlace: "{place} jobs",
    remoteCountry: "Remote jobs {country}",
    remotePlace: "Remote jobs {place}",
    roleCountry: "{role} {country}",
    rolePlace: "{role} {place}",
    remoteGeneric: "Remote jobs",
    roleGeneric: "{role} jobs",
    roles: {
      softwareEngineer: "Software engineer",
      software: "Software",
      engineer: "Engineer",
      developer: "Developer",
      productManager: "Product manager",
      dataAnalyst: "Data analyst",
      devopsEngineer: "DevOps engineer",
      technicalSupport: "Technical support",
      customerSuccess: "Customer success"
    }
  },
  tr: {
    jobsCountry: "{country} i\u015f ilanlar\u0131",
    jobsPlace: "{place} i\u015f ilanlar\u0131",
    remoteCountry: "{country} uzaktan i\u015f ilanlar\u0131",
    remotePlace: "{place} uzaktan i\u015f ilanlar\u0131",
    roleCountry: "{country} {role} ilanlar\u0131",
    rolePlace: "{place} {role} ilanlar\u0131",
    remoteGeneric: "Uzaktan i\u015f ilanlar\u0131",
    roleGeneric: "{role} ilanlar\u0131",
    roles: {
      softwareEngineer: "yaz\u0131l\u0131m m\u00fchendisi",
      software: "yaz\u0131l\u0131m",
      engineer: "m\u00fchendis",
      developer: "geli\u015ftirici",
      productManager: "\u00fcr\u00fcn y\u00f6neticisi",
      dataAnalyst: "veri analisti",
      devopsEngineer: "DevOps m\u00fchendisi",
      technicalSupport: "teknik destek",
      customerSuccess: "m\u00fc\u015fteri ba\u015far\u0131s\u0131"
    }
  },
  de: {
    jobsCountry: "Jobs in {country}",
    jobsPlace: "Jobs in {place}",
    remoteCountry: "Remote-Jobs in {country}",
    remotePlace: "Remote-Jobs in {place}",
    roleCountry: "{role}-Jobs in {country}",
    rolePlace: "{role}-Jobs in {place}",
    remoteGeneric: "Remote-Jobs",
    roleGeneric: "{role}-Jobs",
    roles: {
      softwareEngineer: "Softwareentwickler",
      software: "Software",
      engineer: "Ingenieur",
      developer: "Entwickler",
      productManager: "Product Manager",
      dataAnalyst: "Data Analyst",
      devopsEngineer: "DevOps Engineer",
      technicalSupport: "Technischer Support",
      customerSuccess: "Customer Success"
    }
  },
  fr: {
    jobsCountry: "Emplois en {country}",
    jobsPlace: "Emplois \u00e0 {place}",
    remoteCountry: "Emplois \u00e0 distance en {country}",
    remotePlace: "Emplois \u00e0 distance \u00e0 {place}",
    roleCountry: "Emplois {role} en {country}",
    rolePlace: "Emplois {role} \u00e0 {place}",
    remoteGeneric: "Emplois \u00e0 distance",
    roleGeneric: "Emplois {role}",
    roles: {
      softwareEngineer: "ing\u00e9nieur logiciel",
      software: "logiciel",
      engineer: "ing\u00e9nieur",
      developer: "d\u00e9veloppeur",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps",
      technicalSupport: "support technique",
      customerSuccess: "customer success"
    }
  },
  es: {
    jobsCountry: "Empleos en {country}",
    jobsPlace: "Empleos en {place}",
    remoteCountry: "Empleos remotos en {country}",
    remotePlace: "Empleos remotos en {place}",
    roleCountry: "Empleos de {role} en {country}",
    rolePlace: "Empleos de {role} en {place}",
    remoteGeneric: "Empleos remotos",
    roleGeneric: "Empleos de {role}",
    roles: {
      softwareEngineer: "ingeniero de software",
      software: "software",
      engineer: "ingeniero",
      developer: "desarrollador",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps",
      technicalSupport: "soporte t\u00e9cnico",
      customerSuccess: "customer success"
    }
  },
  "pt-BR": {
    jobsCountry: "{country}: vagas",
    jobsPlace: "{place}: vagas",
    remoteCountry: "{country}: vagas remotas",
    remotePlace: "{place}: vagas remotas",
    roleCountry: "{country}: vagas de {role}",
    rolePlace: "{place}: vagas de {role}",
    remoteGeneric: "Vagas remotas",
    roleGeneric: "Vagas de {role}",
    roles: {
      softwareEngineer: "engenheiro de software",
      software: "software",
      engineer: "engenheiro",
      developer: "desenvolvedor",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps",
      technicalSupport: "suporte t\u00e9cnico",
      customerSuccess: "customer success"
    }
  },
  "pt-PT": {
    jobsCountry: "Empregos em {country}",
    jobsPlace: "Empregos em {place}",
    remoteCountry: "Empregos remotos em {country}",
    remotePlace: "Empregos remotos em {place}",
    roleCountry: "Empregos de {role} em {country}",
    rolePlace: "Empregos de {role} em {place}",
    remoteGeneric: "Empregos remotos",
    roleGeneric: "Empregos de {role}",
    roles: {
      softwareEngineer: "engenheiro de software",
      software: "software",
      engineer: "engenheiro",
      developer: "programador",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps",
      technicalSupport: "suporte t\u00e9cnico",
      customerSuccess: "customer success"
    }
  },
  it: {
    jobsCountry: "Offerte in {country}",
    jobsPlace: "Offerte a {place}",
    remoteCountry: "Offerte da remoto in {country}",
    remotePlace: "Offerte da remoto a {place}",
    roleCountry: "Offerte {role} in {country}",
    rolePlace: "Offerte {role} a {place}",
    remoteGeneric: "Offerte da remoto",
    roleGeneric: "Offerte {role}",
    roles: {
      softwareEngineer: "ingegnere software",
      software: "software",
      engineer: "ingegnere",
      developer: "sviluppatore",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps",
      technicalSupport: "supporto tecnico",
      customerSuccess: "customer success"
    }
  },
  nl: {
    jobsCountry: "Banen in {country}",
    jobsPlace: "Banen in {place}",
    remoteCountry: "Remote banen in {country}",
    remotePlace: "Remote banen in {place}",
    roleCountry: "{role}-banen in {country}",
    rolePlace: "{role}-banen in {place}",
    remoteGeneric: "Remote banen",
    roleGeneric: "{role}-banen",
    roles: {
      softwareEngineer: "software engineer",
      software: "software",
      engineer: "engineer",
      developer: "developer",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps engineer",
      technicalSupport: "technische support",
      customerSuccess: "customer success"
    }
  },
  pl: {
    jobsCountry: "Praca: {country}",
    jobsPlace: "Praca: {place}",
    remoteCountry: "Praca zdalna: {country}",
    remotePlace: "Praca zdalna: {place}",
    roleCountry: "Praca {role}: {country}",
    rolePlace: "Praca {role}: {place}",
    remoteGeneric: "Praca zdalna",
    roleGeneric: "Praca {role}",
    roles: {
      softwareEngineer: "in\u017cynier oprogramowania",
      software: "software",
      engineer: "in\u017cynier",
      developer: "developer",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps",
      technicalSupport: "wsparcie techniczne",
      customerSuccess: "customer success"
    }
  },
  ja: {
    jobsCountry: "{country}\u306e\u6c42\u4eba",
    jobsPlace: "{place}\u306e\u6c42\u4eba",
    remoteCountry: "{country}\u306e\u30ea\u30e2\u30fc\u30c8\u6c42\u4eba",
    remotePlace: "{place}\u306e\u30ea\u30e2\u30fc\u30c8\u6c42\u4eba",
    roleCountry: "{country}\u306e{role}\u6c42\u4eba",
    rolePlace: "{place}\u306e{role}\u6c42\u4eba",
    remoteGeneric: "\u30ea\u30e2\u30fc\u30c8\u6c42\u4eba",
    roleGeneric: "{role}\u6c42\u4eba",
    roles: {
      softwareEngineer: "\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u30a8\u30f3\u30b8\u30cb\u30a2",
      software: "\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2",
      engineer: "\u30a8\u30f3\u30b8\u30cb\u30a2",
      developer: "\u958b\u767a\u8005",
      productManager: "\u30d7\u30ed\u30c0\u30af\u30c8\u30de\u30cd\u30fc\u30b8\u30e3\u30fc",
      dataAnalyst: "\u30c7\u30fc\u30bf\u30a2\u30ca\u30ea\u30b9\u30c8",
      devopsEngineer: "DevOps\u30a8\u30f3\u30b8\u30cb\u30a2",
      technicalSupport: "\u30c6\u30af\u30cb\u30ab\u30eb\u30b5\u30dd\u30fc\u30c8",
      customerSuccess: "\u30ab\u30b9\u30bf\u30de\u30fc\u30b5\u30af\u30bb\u30b9"
    }
  },
  ko: {
    jobsCountry: "{country} \ucc44\uc6a9",
    jobsPlace: "{place} \ucc44\uc6a9",
    remoteCountry: "{country} \uc6d0\uaca9 \ucc44\uc6a9",
    remotePlace: "{place} \uc6d0\uaca9 \ucc44\uc6a9",
    roleCountry: "{country} {role} \ucc44\uc6a9",
    rolePlace: "{place} {role} \ucc44\uc6a9",
    remoteGeneric: "\uc6d0\uaca9 \ucc44\uc6a9",
    roleGeneric: "{role} \ucc44\uc6a9",
    roles: {
      softwareEngineer: "\uc18c\ud504\ud2b8\uc6e8\uc5b4 \uc5d4\uc9c0\ub2c8\uc5b4",
      software: "\uc18c\ud504\ud2b8\uc6e8\uc5b4",
      engineer: "\uc5d4\uc9c0\ub2c8\uc5b4",
      developer: "\uac1c\ubc1c\uc790",
      productManager: "\ud504\ub85c\ub355\ud2b8 \ub9e4\ub2c8\uc800",
      dataAnalyst: "\ub370\uc774\ud130 \uc560\ub110\ub9ac\uc2a4\ud2b8",
      devopsEngineer: "DevOps \uc5d4\uc9c0\ub2c8\uc5b4",
      technicalSupport: "\uae30\uc220 \uc9c0\uc6d0",
      customerSuccess: "\ucee4\uc2a4\ud130\uba38 \uc131\uacf5"
    }
  },
  "zh-CN": {
    jobsCountry: "{country}\u804c\u4f4d",
    jobsPlace: "{place}\u804c\u4f4d",
    remoteCountry: "{country}\u8fdc\u7a0b\u804c\u4f4d",
    remotePlace: "{place}\u8fdc\u7a0b\u804c\u4f4d",
    roleCountry: "{country}{role}\u804c\u4f4d",
    rolePlace: "{place}{role}\u804c\u4f4d",
    remoteGeneric: "\u8fdc\u7a0b\u804c\u4f4d",
    roleGeneric: "{role}\u804c\u4f4d",
    roles: {
      softwareEngineer: "\u8f6f\u4ef6\u5de5\u7a0b\u5e08",
      software: "\u8f6f\u4ef6",
      engineer: "\u5de5\u7a0b\u5e08",
      developer: "\u5f00\u53d1\u8005",
      productManager: "\u4ea7\u54c1\u7ecf\u7406",
      dataAnalyst: "\u6570\u636e\u5206\u6790\u5e08",
      devopsEngineer: "DevOps\u5de5\u7a0b\u5e08",
      technicalSupport: "\u6280\u672f\u652f\u6301",
      customerSuccess: "\u5ba2\u6237\u6210\u529f"
    }
  },
  hi: {
    jobsCountry: "{country} \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902",
    jobsPlace: "{place} \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902",
    remoteCountry: "{country} \u0930\u093f\u092e\u094b\u091f \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902",
    remotePlace: "{place} \u0930\u093f\u092e\u094b\u091f \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902",
    roleCountry: "{country} {role} \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902",
    rolePlace: "{place} {role} \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902",
    remoteGeneric: "\u0930\u093f\u092e\u094b\u091f \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902",
    roleGeneric: "{role} \u0928\u094c\u0915\u0930\u093f\u092f\u093e\u0902",
    roles: {
      softwareEngineer: "\u0938\u0949\u092b\u094d\u091f\u0935\u0947\u092f\u0930 \u0907\u0902\u091c\u0940\u0928\u093f\u092f\u0930",
      software: "\u0938\u0949\u092b\u094d\u091f\u0935\u0947\u092f\u0930",
      engineer: "\u0907\u0902\u091c\u0940\u0928\u093f\u092f\u0930",
      developer: "\u0921\u0947\u0935\u0932\u092a\u0930",
      productManager: "\u092a\u094d\u0930\u094b\u0921\u0915\u094d\u091f \u092e\u0948\u0928\u0947\u091c\u0930",
      dataAnalyst: "\u0921\u0947\u091f\u093e \u090f\u0928\u093e\u0932\u093f\u0938\u094d\u091f",
      devopsEngineer: "DevOps \u0907\u0902\u091c\u0940\u0928\u093f\u092f\u0930",
      technicalSupport: "\u091f\u0947\u0915\u094d\u0928\u093f\u0915\u0932 \u0938\u092a\u094b\u0930\u094d\u091f",
      customerSuccess: "\u0915\u0938\u094d\u091f\u092e\u0930 \u0938\u0915\u094d\u0938\u0947\u0938"
    }
  },
  ar: {
    jobsCountry: "\u0648\u0638\u0627\u0626\u0641 \u0641\u064a {country}",
    jobsPlace: "\u0648\u0638\u0627\u0626\u0641 \u0641\u064a {place}",
    remoteCountry: "\u0648\u0638\u0627\u0626\u0641 \u0639\u0646 \u0628\u0639\u062f \u0641\u064a {country}",
    remotePlace: "\u0648\u0638\u0627\u0626\u0641 \u0639\u0646 \u0628\u0639\u062f \u0641\u064a {place}",
    roleCountry: "\u0648\u0638\u0627\u0626\u0641 {role} \u0641\u064a {country}",
    rolePlace: "\u0648\u0638\u0627\u0626\u0641 {role} \u0641\u064a {place}",
    remoteGeneric: "\u0648\u0638\u0627\u0626\u0641 \u0639\u0646 \u0628\u0639\u062f",
    roleGeneric: "\u0648\u0638\u0627\u0626\u0641 {role}",
    roles: {
      softwareEngineer: "\u0645\u0647\u0646\u062f\u0633 \u0628\u0631\u0645\u062c\u064a\u0627\u062a",
      software: "\u0628\u0631\u0645\u062c\u064a\u0627\u062a",
      engineer: "\u0645\u0647\u0646\u062f\u0633",
      developer: "\u0645\u0637\u0648\u0631",
      productManager: "\u0645\u062f\u064a\u0631 \u0645\u0646\u062a\u062c",
      dataAnalyst: "\u0645\u062d\u0644\u0644 \u0628\u064a\u0627\u0646\u0627\u062a",
      devopsEngineer: "\u0645\u0647\u0646\u062f\u0633 DevOps",
      technicalSupport: "\u062f\u0639\u0645 \u0641\u0646\u064a",
      customerSuccess: "\u0646\u062c\u0627\u062d \u0627\u0644\u0639\u0645\u0644\u0627\u0621"
    }
  },
  id: {
    jobsCountry: "Lowongan di {country}",
    jobsPlace: "Lowongan di {place}",
    remoteCountry: "Lowongan remote di {country}",
    remotePlace: "Lowongan remote di {place}",
    roleCountry: "Lowongan {role} di {country}",
    rolePlace: "Lowongan {role} di {place}",
    remoteGeneric: "Lowongan remote",
    roleGeneric: "Lowongan {role}",
    roles: {
      softwareEngineer: "software engineer",
      software: "software",
      engineer: "engineer",
      developer: "developer",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps engineer",
      technicalSupport: "dukungan teknis",
      customerSuccess: "customer success"
    }
  },
  sv: {
    jobsCountry: "Jobb i {country}",
    jobsPlace: "Jobb i {place}",
    remoteCountry: "Remotejobb i {country}",
    remotePlace: "Remotejobb i {place}",
    roleCountry: "{role}-jobb i {country}",
    rolePlace: "{role}-jobb i {place}",
    remoteGeneric: "Remotejobb",
    roleGeneric: "{role}-jobb",
    roles: {
      softwareEngineer: "mjukvaruingenj\u00f6r",
      software: "mjukvara",
      engineer: "ingenj\u00f6r",
      developer: "utvecklare",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps-ingenj\u00f6r",
      technicalSupport: "teknisk support",
      customerSuccess: "customer success"
    }
  },
  da: {
    jobsCountry: "Job i {country}",
    jobsPlace: "Job i {place}",
    remoteCountry: "Remote job i {country}",
    remotePlace: "Remote job i {place}",
    roleCountry: "{role}-job i {country}",
    rolePlace: "{role}-job i {place}",
    remoteGeneric: "Remote job",
    roleGeneric: "{role}-job",
    roles: {
      softwareEngineer: "softwareingeni\u00f8r",
      software: "software",
      engineer: "ingeni\u00f8r",
      developer: "udvikler",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps-ingeni\u00f8r",
      technicalSupport: "teknisk support",
      customerSuccess: "customer success"
    }
  },
  no: {
    jobsCountry: "Jobber i {country}",
    jobsPlace: "Jobber i {place}",
    remoteCountry: "Remotejobber i {country}",
    remotePlace: "Remotejobber i {place}",
    roleCountry: "{role}-jobber i {country}",
    rolePlace: "{role}-jobber i {place}",
    remoteGeneric: "Remotejobber",
    roleGeneric: "{role}-jobber",
    roles: {
      softwareEngineer: "programvareingeni\u00f8r",
      software: "programvare",
      engineer: "ingeni\u00f8r",
      developer: "utvikler",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps-ingeni\u00f8r",
      technicalSupport: "teknisk support",
      customerSuccess: "customer success"
    }
  },
  fi: {
    jobsCountry: "Ty\u00f6paikat: {country}",
    jobsPlace: "Ty\u00f6paikat: {place}",
    remoteCountry: "Et\u00e4ty\u00f6paikat: {country}",
    remotePlace: "Et\u00e4ty\u00f6paikat: {place}",
    roleCountry: "{role}-ty\u00f6paikat: {country}",
    rolePlace: "{role}-ty\u00f6paikat: {place}",
    remoteGeneric: "Et\u00e4ty\u00f6paikat",
    roleGeneric: "{role}-ty\u00f6paikat",
    roles: {
      softwareEngineer: "ohjelmistoinsin\u00f6\u00f6ri",
      software: "ohjelmisto",
      engineer: "insin\u00f6\u00f6ri",
      developer: "kehitt\u00e4j\u00e4",
      productManager: "product manager",
      dataAnalyst: "data analyst",
      devopsEngineer: "DevOps-insin\u00f6\u00f6ri",
      technicalSupport: "tekninen tuki",
      customerSuccess: "customer success"
    }
  }
});

const PUBLIC_SEO_COUNTRY_QUERY_TERMS_BY_CODE = Object.freeze({
  US: ["us", "usa", "united states"],
  GB: ["uk", "gb", "britain", "united kingdom"],
  TR: ["turkiye", "turkey"],
  DE: ["germany", "german"],
  FR: ["france", "french"],
  ES: ["spain", "spanish"],
  BR: ["brazil", "brasil", "brazilian"],
  PT: ["portugal", "portuguese"],
  IT: ["italy", "italian"],
  NL: ["netherlands", "dutch"],
  PL: ["poland", "polish"],
  JP: ["japan", "japanese"],
  KR: ["korea", "south korea", "korean"],
  CN: ["china", "chinese"],
  IN: ["india", "indian"],
  AE: ["uae", "united arab emirates", "emirates"],
  ID: ["indonesia", "indonesian"],
  SE: ["sweden", "swedish"],
  DK: ["denmark", "danish"],
  NO: ["norway", "norwegian"],
  FI: ["finland", "finnish"]
});

const PUBLIC_SEO_PLACE_QUERY_TERMS_BY_COUNTRY = Object.freeze({
  TR: ["istanbul"],
  JP: ["tokyo", "osaka", "kyoto"],
  KR: ["seoul"],
  CN: ["shanghai", "beijing", "hong kong"],
  IN: ["bangalore", "bengaluru", "delhi", "mumbai", "hyderabad"],
  AE: ["dubai", "abu dhabi"],
  ID: ["jakarta", "bali"],
  SE: ["stockholm", "gothenburg", "malmo"],
  DK: ["copenhagen", "aarhus"],
  NO: ["oslo", "bergen"],
  FI: ["helsinki", "espoo"]
});

const PUBLIC_SEO_PLACE_DISPLAY_NAMES = Object.freeze({
  istanbul: { default: "Istanbul", tr: "\u0130stanbul" },
  tokyo: { default: "Tokyo", ja: "\u6771\u4eac", ko: "\ub3c4\ucfc4", "zh-CN": "\u4e1c\u4eac" },
  osaka: { default: "Osaka", ja: "\u5927\u962a", ko: "\uc624\uc0ac\uce74", "zh-CN": "\u5927\u962a" },
  kyoto: { default: "Kyoto", ja: "\u4eac\u90fd", ko: "\uad50\ud1a0", "zh-CN": "\u4eac\u90fd" },
  seoul: { default: "Seoul", ko: "\uc11c\uc6b8", ja: "\u30bd\u30a6\u30eb", "zh-CN": "\u9996\u5c14" },
  shanghai: { default: "Shanghai", "zh-CN": "\u4e0a\u6d77", ja: "\u4e0a\u6d77", ko: "\uc0c1\ud558\uc774" },
  beijing: { default: "Beijing", "zh-CN": "\u5317\u4eac", ja: "\u5317\u4eac", ko: "\ubca0\uc774\uc9d5" },
  "hong kong": { default: "Hong Kong", "zh-CN": "\u9999\u6e2f", ja: "\u9999\u6e2f", ko: "\ud64d\ucf69" },
  bangalore: { default: "Bangalore" },
  bengaluru: { default: "Bengaluru" },
  delhi: { default: "Delhi" },
  mumbai: { default: "Mumbai" },
  hyderabad: { default: "Hyderabad" },
  dubai: { default: "Dubai", ar: "\u062f\u0628\u064a" },
  "abu dhabi": { default: "Abu Dhabi", ar: "\u0623\u0628\u0648 \u0638\u0628\u064a" },
  jakarta: { default: "Jakarta" },
  bali: { default: "Bali" },
  stockholm: { default: "Stockholm" },
  gothenburg: { default: "Gothenburg", sv: "G\u00f6teborg" },
  malmo: { default: "Malmo", sv: "Malm\u00f6" },
  copenhagen: { default: "Copenhagen", da: "K\u00f8benhavn" },
  aarhus: { default: "Aarhus", da: "\u00c5rhus" },
  oslo: { default: "Oslo" },
  bergen: { default: "Bergen" },
  helsinki: { default: "Helsinki" },
  espoo: { default: "Espoo" }
});

const PUBLIC_SEO_ENGLISH_COUNTRY_NAMES = Object.freeze({
  US: "United States",
  GB: "United Kingdom",
  TR: "Turkey",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  BR: "Brazil",
  PT: "Portugal",
  IT: "Italy",
  NL: "Netherlands",
  PL: "Poland",
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  IN: "India",
  AE: "United Arab Emirates",
  ID: "Indonesia",
  SE: "Sweden",
  DK: "Denmark",
  NO: "Norway",
  FI: "Finland"
});

const PUBLIC_SEO_POPULAR_ROLE_PATTERNS = Object.freeze([
  ["technicalSupport", ["technical support"]],
  ["customerSuccess", ["customer success"]],
  ["productManager", ["product manager"]],
  ["dataAnalyst", ["data analyst"]],
  ["devopsEngineer", ["devops engineer", "devops"]],
  ["softwareEngineer", ["software engineer"]],
  ["software", ["software"]],
  ["engineer", ["engineer"]],
  ["developer", ["developer"]]
]);

function interpolatePublicSeoPopularLabel(template, values = {}) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : ""
  ).replace(/\s+/g, " ").trim();
}

function getPublicSeoPopularLabelCopy(languageCode) {
  const normalizedLanguageCode = normalizePublicSeoLanguageCode(languageCode);
  return PUBLIC_SEO_POPULAR_LABEL_COPY[normalizedLanguageCode] ||
    PUBLIC_SEO_POPULAR_LABEL_COPY[normalizedLanguageCode.split("-")[0]] ||
    PUBLIC_SEO_POPULAR_LABEL_COPY.en;
}

function normalizedPublicSeoPhraseIncludes(normalizedQuery, phrase) {
  const normalizedPhrase = normalizePublicSeoQueryKey(phrase);
  return Boolean(normalizedPhrase) && ` ${normalizedQuery} `.includes(` ${normalizedPhrase} `);
}

function getPublicSeoPopularRoleKey(normalizedQuery) {
  for (const [roleKey, patterns] of PUBLIC_SEO_POPULAR_ROLE_PATTERNS) {
    if (patterns.some((pattern) => normalizedPublicSeoPhraseIncludes(normalizedQuery, pattern))) {
      return roleKey;
    }
  }
  return "";
}

function getPublicSeoCountryDisplayName(countryCode, languageCode) {
  const normalizedCountryCode = normalizePublicSeoCountryCode(countryCode);
  if (!normalizedCountryCode) return "";
  const normalizedLanguageCode = normalizePublicSeoLanguageCode(languageCode);
  try {
    const displayNames = new Intl.DisplayNames([normalizedLanguageCode], { type: "region" });
    const displayName = String(displayNames.of(normalizedCountryCode) || "").trim();
    if (displayName && displayName.toUpperCase() !== normalizedCountryCode) return displayName;
  } catch {
    // Intl region names are a display enhancement; fall back to stable English names.
  }
  return PUBLIC_SEO_ENGLISH_COUNTRY_NAMES[normalizedCountryCode] || normalizedCountryCode;
}

function getPublicSeoPlaceDisplayName(placeKey, languageCode) {
  const normalizedPlaceKey = normalizePublicSeoQueryKey(placeKey);
  const normalizedLanguageCode = normalizePublicSeoLanguageCode(languageCode);
  const display = PUBLIC_SEO_PLACE_DISPLAY_NAMES[normalizedPlaceKey];
  if (!display) return getPublicSeoPopularQueryLabel(normalizedPlaceKey);
  return display[normalizedLanguageCode] || display[normalizedLanguageCode.split("-")[0]] || display.default || getPublicSeoPopularQueryLabel(normalizedPlaceKey);
}

function getPublicSeoPopularQueryPlaceKey(normalizedQuery, countryCode) {
  const normalizedCountryCode = normalizePublicSeoCountryCode(countryCode);
  const placeTerms = PUBLIC_SEO_PLACE_QUERY_TERMS_BY_COUNTRY[normalizedCountryCode] || [];
  return placeTerms.find((term) => normalizedPublicSeoPhraseIncludes(normalizedQuery, term)) || "";
}

function hasPublicSeoPopularCountryTerm(normalizedQuery, countryCode) {
  const normalizedCountryCode = normalizePublicSeoCountryCode(countryCode);
  const terms = PUBLIC_SEO_COUNTRY_QUERY_TERMS_BY_CODE[normalizedCountryCode] || [];
  return terms.some((term) => normalizedPublicSeoPhraseIncludes(normalizedQuery, term));
}

function getPublicSeoLocalizedPopularQueryLabel(query, options = {}) {
  const cleanedQuery = String(query || "").replace(/\s+/g, " ").trim();
  if (!cleanedQuery) return "";
  const normalizedLanguageCode = normalizePublicSeoLanguageCode(options.languageCode || options.language_code || "en");
  if (normalizedLanguageCode === "en") return getPublicSeoPopularQueryLabel(cleanedQuery);

  const normalizedQuery = normalizePublicSeoQueryKey(cleanedQuery);
  const copy = getPublicSeoPopularLabelCopy(normalizedLanguageCode);
  const roleKey = getPublicSeoPopularRoleKey(normalizedQuery);
  const role = roleKey ? copy.roles?.[roleKey] || PUBLIC_SEO_POPULAR_LABEL_COPY.en.roles[roleKey] : "";
  const isRemote = normalizedPublicSeoPhraseIncludes(normalizedQuery, "remote");
  const countryCode = normalizePublicSeoCountryCode(options.countryCode || options.country_code || "");
  const placeKey = getPublicSeoPopularQueryPlaceKey(normalizedQuery, countryCode);
  const hasCountry = countryCode && (hasPublicSeoPopularCountryTerm(normalizedQuery, countryCode) || !placeKey);

  if (placeKey) {
    const place = getPublicSeoPlaceDisplayName(placeKey, normalizedLanguageCode);
    if (isRemote) return interpolatePublicSeoPopularLabel(copy.remotePlace, { place, role });
    if (role) return interpolatePublicSeoPopularLabel(copy.rolePlace, { place, role });
    return interpolatePublicSeoPopularLabel(copy.jobsPlace, { place });
  }

  if (hasCountry) {
    const country = getPublicSeoCountryDisplayName(countryCode, normalizedLanguageCode);
    if (isRemote) return interpolatePublicSeoPopularLabel(copy.remoteCountry, { country, role });
    if (role) return interpolatePublicSeoPopularLabel(copy.roleCountry, { country, role });
    return interpolatePublicSeoPopularLabel(copy.jobsCountry, { country });
  }

  if (isRemote) return interpolatePublicSeoPopularLabel(copy.remoteGeneric, { role });
  if (role) return interpolatePublicSeoPopularLabel(copy.roleGeneric, { role });
  return getPublicSeoPopularQueryLabel(cleanedQuery);
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

function normalizePublicSeoCountryCode(value) {
  const countryCode = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(countryCode) ? countryCode : "";
}

function getPublicSeoFallbackEntryLabel(entry, languageCode) {
  if (!entry || typeof entry !== "object") return "";
  const labels = entry.labels && typeof entry.labels === "object" ? entry.labels : {};
  const normalizedLanguageCode = normalizePublicSeoLanguageCode(languageCode);
  return String(
    labels[normalizedLanguageCode] ||
      labels[normalizedLanguageCode.split("-")[0]] ||
      ""
  ).replace(/\s+/g, " ").trim();
}

function getPublicSeoCountryFallbackQueries(countryCode, languageCode, limit = SEO_LANDING_LINK_LIMIT) {
  const normalizedCountryCode = normalizePublicSeoCountryCode(countryCode);
  const fallbackEntries = PUBLIC_SEO_COUNTRY_POPULAR_FALLBACKS[normalizedCountryCode] || [];
  const boundedLimit = Math.max(1, Math.min(20, Number(limit || SEO_LANDING_LINK_LIMIT)));
  const normalizedLanguageCode = normalizePublicSeoLanguageCode(languageCode);
  return fallbackEntries.slice(0, boundedLimit).map((entry, index) => {
    const query = String(typeof entry === "string" ? entry : entry?.query || entry?.searchQuery || "").replace(/\s+/g, " ").trim();
    const label = getPublicSeoFallbackEntryLabel(entry, normalizedLanguageCode) || getPublicSeoLocalizedPopularQueryLabel(query, {
      languageCode: normalizedLanguageCode,
      countryCode: normalizedCountryCode
    });
    return {
      query,
      label,
      searchQuery: query,
      count: Math.max(1, 1000 - index),
      countryCode: normalizedCountryCode,
      languageCode: normalizedLanguageCode,
      source: "research_country_fallback",
      trustedPopularFallback: true
    };
  }).filter((item) => item.query);
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

function getPublicSeoPopularSearchItems(languageCode, queryCounts = [], limit = SEO_LANDING_LINK_LIMIT, options = {}) {
  const normalizedLanguageCode = normalizePublicSeoLanguageCode(languageCode);
  const normalizedOptionCountryCode = normalizePublicSeoCountryCode(options.countryCode || options.country_code || "");
  const routes = getPublicSeoLandingRoutesForLanguage(normalizedLanguageCode, 20);
  const routeByIntent = new Map(routes.map((route) => [String(route.searchIntent || "").trim(), route]));
  const countByIntent = new Map();
  const countByQuery = new Map();
  const trustProvidedQueries = Boolean(options.trustedQueryCounts);

  for (const item of Array.isArray(queryCounts) ? queryCounts : []) {
    const query = item?.query || item?.query_normalized || item?.searchQuery || item?.value || "";
    const cleanedQuery = String(query || "").replace(/\s+/g, " ").trim();
    const queryKey = normalizePublicSeoQueryKey(query);
    const count = Math.max(0, Number(item?.count || 0));
    if (!queryKey || count <= 0) continue;
    const itemCountryCode = normalizePublicSeoCountryCode(item?.countryCode || item?.country_code || normalizedOptionCountryCode);
    const itemLanguageCode = normalizePublicSeoLanguageCode(item?.languageCode || item?.language_code || normalizedLanguageCode);
    const itemLabel = String(item?.label || "").replace(/\s+/g, " ").trim();
    const intent = PUBLIC_SEO_INTENT_BY_QUERY_KEY.get(queryKey);
    if (intent && routeByIntent.has(intent)) {
      countByIntent.set(intent, Number(countByIntent.get(intent) || 0) + count);
      continue;
    }
    if (trustProvidedQueries || item?.trustedPopularFallback || isPublicSeoPopularQueryCandidate(queryKey)) {
      const existing = countByQuery.get(queryKey);
      countByQuery.set(queryKey, {
        query: trustProvidedQueries || item?.trustedPopularFallback ? cleanedQuery || queryKey : queryKey,
        count: Number(existing?.count || 0) + count,
        countryCode: existing?.countryCode || itemCountryCode,
        languageCode: existing?.languageCode || itemLanguageCode,
        label: existing?.label || itemLabel
      });
    }
  }

  const rankedRoutes = [...countByIntent.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([intent, count]) => ({ type: "route", route: routeByIntent.get(intent), count }));
  const rankedQueryLinks = [...countByQuery.values()]
    .sort((left, right) => right.count - left.count || left.query.localeCompare(right.query))
    .map(({ query, count, countryCode, languageCode: itemLanguageCode, label }) => ({
      type: "query",
      query,
      count,
      label: label || getPublicSeoLocalizedPopularQueryLabel(query, {
        languageCode: itemLanguageCode || normalizedLanguageCode,
        countryCode: countryCode || normalizedOptionCountryCode
      }),
      path: getPublicSeoQueryLandingPath(normalizedLanguageCode, query)
    }));
  const rankedItems = [...rankedRoutes, ...rankedQueryLinks]
    .sort((left, right) => right.count - left.count || String(left.route?.path || left.path).localeCompare(String(right.route?.path || right.path)));
  const seenPaths = new Set(rankedItems.map((item) => item.route?.path || item.path).filter(Boolean));
  const fallbackRoutes = routes
    .filter((route) => !seenPaths.has(route.path))
    .map((route) => ({ type: "route", route, count: 0 }));

  return [...rankedItems, ...fallbackRoutes]
    .slice(0, Math.max(1, Math.min(20, Number(limit || SEO_LANDING_LINK_LIMIT))))
    .map(({ type, route, path, query, count, label }) => ({
      path: type === "query" ? path : route.path,
      label: type === "query" ? label || getPublicSeoLocalizedPopularQueryLabel(query, {
        languageCode: normalizedLanguageCode,
        countryCode: normalizedOptionCountryCode
      }) : getPublicSeoRouteLabel(route),
      searchIntent: type === "query" ? `query:${query}` : route.searchIntent || "",
      searchQuery: type === "query" ? query : getPublicSeoCanonicalSearchQuery(route),
      localizedSearchQuery: type === "query" ? label || query : String(route.searchQuery || "").trim(),
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
  PUBLIC_SEO_ATS_PAGES,
  PUBLIC_SEO_ROUTES,
  getPublicSeoCanonicalSearchQuery,
  getPublicSeoAlternateGroupPages,
  getPublicSeoCountryFallbackQueries,
  getPublicSeoLandingRoutesForLanguage,
  getPublicSeoLocalizedPopularQueryLabel,
  getPublicSeoPopularSearchItems,
  getPublicSeoRouteLabel,
  getPublicSeoRouteHintByPath,
  normalizePublicSeoLanguageCode,
  normalizePublicSeoPath,
  normalizePublicSeoQueryKey
};
