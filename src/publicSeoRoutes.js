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

const PUBLIC_SEO_ATS_PAGES = Object.freeze([
  {
    path: "/ats/greenhouse-jobs",
    searchQuery: "greenhouse jobs",
    canonicalSearchQuery: "greenhouse",
    title: "Greenhouse jobs | OpenJobSlots",
    description: "Search fresh public Greenhouse job openings indexed by OpenJobSlots.",
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
    path: "/ats/lever-jobs",
    searchQuery: "lever jobs",
    canonicalSearchQuery: "lever",
    title: "Lever jobs | OpenJobSlots",
    description: "Search fresh public Lever job openings indexed by OpenJobSlots.",
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
    path: "/ats/ashby-jobs",
    searchQuery: "ashby jobs",
    canonicalSearchQuery: "ashby",
    title: "Ashby jobs | OpenJobSlots",
    description: "Search fresh public Ashby job openings indexed by OpenJobSlots.",
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
    path: "/ats/workday-jobs",
    searchQuery: "workday jobs",
    canonicalSearchQuery: "workday",
    title: "Workday jobs | OpenJobSlots",
    description: "Search fresh public Workday job openings indexed by OpenJobSlots.",
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
    path: "/ats/bamboohr-jobs",
    searchQuery: "bamboohr jobs",
    canonicalSearchQuery: "bamboohr",
    title: "BambooHR jobs | OpenJobSlots",
    description: "Search fresh public BambooHR job openings indexed by OpenJobSlots.",
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
  }
]);

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
  ...PUBLIC_SEO_CONTENT_PAGES.map((page) => ({
    ...page,
    canonicalSearchQuery: page.canonicalSearchQuery || page.searchQuery,
    changefreq: "weekly",
    priority: "0.75"
  })),
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
const PUBLIC_SEO_SUPPORTED_LANGUAGES = new Set(["en", "tr", "de", "fr", "es"]);

const PUBLIC_SEO_COUNTRY_POPULAR_FALLBACKS = Object.freeze({
  US: [
    "US jobs",
    "remote jobs US",
    "software engineer US",
    "data analyst US",
    "product manager US",
    "technical support US",
    "customer success US",
    "devops engineer US"
  ],
  GB: [
    "UK jobs",
    "remote jobs UK",
    "software engineer UK",
    "data analyst UK",
    "product manager UK",
    "technical support UK",
    "customer success UK",
    "devops engineer UK"
  ],
  TR: [
    "Turkiye jobs",
    "remote Turkiye",
    "Turkey engineer",
    "Turkey software",
    "Istanbul jobs",
    "product manager Turkey",
    "customer success Turkey",
    "data analyst Turkey"
  ],
  DE: [
    "Germany jobs",
    "remote Germany",
    "engineer Germany",
    "software Germany",
    "developer Germany",
    "product manager Germany",
    "data analyst Germany",
    "devops engineer Germany"
  ],
  FR: [
    "France jobs",
    "remote France",
    "engineer France",
    "software France",
    "developer France",
    "product manager France",
    "data analyst France",
    "devops engineer France"
  ],
  ES: [
    "Spain jobs",
    "remote Spain",
    "engineer Spain",
    "software Spain",
    "developer Spain",
    "product manager Spain",
    "data analyst Spain",
    "devops engineer Spain"
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

function getPublicSeoLandingRoutesForLanguage(languageCode, limit = SEO_LANDING_LINK_LIMIT) {
  const normalizedLanguageCode = PUBLIC_SEO_SUPPORTED_LANGUAGES.has(languageCode) ? languageCode : "en";
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
  const normalizedLanguageCode = PUBLIC_SEO_SUPPORTED_LANGUAGES.has(languageCode) ? languageCode : "en";
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

function normalizePublicSeoCountryCode(value) {
  const countryCode = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(countryCode) ? countryCode : "";
}

function getPublicSeoCountryFallbackQueries(countryCode, languageCode, limit = SEO_LANDING_LINK_LIMIT) {
  const normalizedCountryCode = normalizePublicSeoCountryCode(countryCode);
  const queries = PUBLIC_SEO_COUNTRY_POPULAR_FALLBACKS[normalizedCountryCode] || [];
  const boundedLimit = Math.max(1, Math.min(20, Number(limit || SEO_LANDING_LINK_LIMIT)));
  return queries.slice(0, boundedLimit).map((query, index) => ({
    query,
    searchQuery: query,
    count: Math.max(1, 1000 - index),
    countryCode: normalizedCountryCode,
    languageCode: PUBLIC_SEO_SUPPORTED_LANGUAGES.has(languageCode) ? languageCode : "en",
    source: "research_country_fallback",
    trustedPopularFallback: true
  }));
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
  const routes = getPublicSeoLandingRoutesForLanguage(languageCode, 20);
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
    const intent = PUBLIC_SEO_INTENT_BY_QUERY_KEY.get(queryKey);
    if (intent && routeByIntent.has(intent)) {
      countByIntent.set(intent, Number(countByIntent.get(intent) || 0) + count);
      continue;
    }
    if (trustProvidedQueries || item?.trustedPopularFallback || isPublicSeoPopularQueryCandidate(queryKey)) {
      const existing = countByQuery.get(queryKey);
      countByQuery.set(queryKey, {
        query: trustProvidedQueries || item?.trustedPopularFallback ? cleanedQuery || queryKey : queryKey,
        count: Number(existing?.count || 0) + count
      });
    }
  }

  const rankedRoutes = [...countByIntent.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([intent, count]) => ({ type: "route", route: routeByIntent.get(intent), count }));
  const rankedQueryLinks = [...countByQuery.values()]
    .sort((left, right) => right.count - left.count || left.query.localeCompare(right.query))
    .map(({ query, count }) => ({
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
  getPublicSeoCountryFallbackQueries,
  getPublicSeoLandingRoutesForLanguage,
  getPublicSeoPopularSearchItems,
  getPublicSeoRouteLabel,
  getPublicSeoRouteHintByPath,
  normalizePublicSeoPath,
  normalizePublicSeoQueryKey
};
