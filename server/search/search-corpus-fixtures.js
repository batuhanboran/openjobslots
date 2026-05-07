const BASE_LAST_SEEN_EPOCH = 1_800_000_000;

const ROLES = Object.freeze([
  "Software Engineer",
  "Data Analyst",
  "Product Manager",
  "DevOps Engineer",
  "QA Engineer",
  "UX Designer",
  "Sales Manager",
  "Customer Success Manager",
  "Marketing Specialist",
  "Finance Analyst",
  "Director",
  "Nurse Practitioner",
  "Machine Learning Engineer",
  "Security Engineer",
  "Backend Developer",
  "Frontend Developer"
]);

const COUNTRIES = Object.freeze([
  {
    code: "US",
    label: "United States",
    region: "North America",
    aliases: ["US", "USA", "U.S.", "United States"],
    location: "New York, United States"
  },
  {
    code: "CA",
    label: "Canada",
    region: "North America",
    aliases: ["Canada", "CAN"],
    location: "Montreal, Canada"
  },
  {
    code: "TR",
    label: "Turkey",
    region: "EMEA",
    aliases: ["Turkey", "Turkiye", "T\u00fcrkiye", "Turkish"],
    location: "Istanbul, T\u00fcrkiye"
  },
  {
    code: "GB",
    label: "United Kingdom",
    region: "EMEA",
    aliases: ["UK", "U.K.", "Great Britain"],
    location: "London, United Kingdom"
  },
  {
    code: "DE",
    label: "Germany",
    region: "EMEA",
    aliases: ["Germany", "Deutschland"],
    location: "D\u00fcsseldorf, Germany"
  },
  {
    code: "FR",
    label: "France",
    region: "EMEA",
    aliases: ["France"],
    location: "Paris, France"
  },
  {
    code: "IN",
    label: "India",
    region: "APAC",
    aliases: ["India"],
    location: "Bengaluru, India"
  },
  {
    code: "SG",
    label: "Singapore",
    region: "APAC",
    aliases: ["Singapore"],
    location: "Singapore"
  },
  {
    code: "JP",
    label: "Japan",
    region: "APAC",
    aliases: ["Japan"],
    location: "Tokyo, Japan"
  }
]);

const REMOTE_MODES = Object.freeze([
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" }
]);

const REGION_ALIASES = Object.freeze([
  { value: "North America", aliases: ["North America", "NA", "AMER", "Americas"] },
  { value: "EMEA", aliases: ["EMEA", "Europe", "Europe Middle East Africa"] },
  { value: "APAC", aliases: ["APAC", "Asia Pacific", "Asia"] }
]);

function slug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSeedPostings() {
  const postings = [];
  let sequence = 0;

  for (const role of ROLES) {
    for (const country of COUNTRIES) {
      for (const remoteMode of REMOTE_MODES) {
        const id = `${slug(role)}-${country.code}-${remoteMode.value}`;
        const workModeLabel =
          remoteMode.value === "remote"
            ? "Remote"
            : remoteMode.value === "hybrid"
              ? "Hybrid"
              : "On-site";
        postings.push({
          id,
          company_name: `Corpus ${country.code} ${remoteMode.label} ${sequence}`,
          position_name: role,
          canonical_url: `https://search-corpus.example/jobs/${id}`,
          location_text: `${workModeLabel} - ${country.location}`,
          country: country.label,
          country_code: country.code,
          region: country.region,
          remote_type: remoteMode.value,
          ats_key: "corpus",
          industry: "Synthetic QA",
          posting_date: sequence % 17 === 0 ? "" : "2026-05-01",
          hidden: false,
          applied: false,
          ignored: false,
          last_seen_epoch: BASE_LAST_SEEN_EPOCH - sequence
        });
        sequence += 1;
      }
    }
  }

  postings.push(
    {
      id: "hidden-software-engineer-US-remote",
      company_name: "Hidden Corpus Co",
      position_name: "Software Engineer",
      canonical_url: "https://search-corpus.example/jobs/hidden-software-engineer-US-remote",
      location_text: "Remote - New York, United States",
      country: "United States",
      country_code: "US",
      region: "North America",
      remote_type: "remote",
      ats_key: "corpus",
      industry: "Synthetic QA",
      posting_date: "2026-05-01",
      hidden: true,
      applied: false,
      ignored: false,
      last_seen_epoch: BASE_LAST_SEEN_EPOCH + 10
    },
    {
      id: "applied-director-TR-remote",
      company_name: "Applied Corpus Co",
      position_name: "Director",
      canonical_url: "https://search-corpus.example/jobs/applied-director-TR-remote",
      location_text: "Remote - Istanbul, T\u00fcrkiye",
      country: "Turkey",
      country_code: "TR",
      region: "EMEA",
      remote_type: "remote",
      ats_key: "corpus",
      industry: "Synthetic QA",
      posting_date: "2026-05-01",
      hidden: false,
      applied: true,
      ignored: false,
      last_seen_epoch: BASE_LAST_SEEN_EPOCH + 9
    },
    {
      id: "ignored-data-analyst-GB-hybrid",
      company_name: "Ignored Corpus Co",
      position_name: "Data Analyst",
      canonical_url: "https://search-corpus.example/jobs/ignored-data-analyst-GB-hybrid",
      location_text: "Hybrid - London, United Kingdom",
      country: "United Kingdom",
      country_code: "GB",
      region: "EMEA",
      remote_type: "hybrid",
      ats_key: "corpus",
      industry: "Synthetic QA",
      posting_date: "2026-05-01",
      hidden: false,
      applied: false,
      ignored: true,
      last_seen_epoch: BASE_LAST_SEEN_EPOCH + 8
    }
  );

  return postings;
}

function titleCountryCases() {
  const caseRoles = ["Software Engineer", "Data Analyst", "Product Manager", "Director"];
  const cases = [];
  for (const role of caseRoles) {
    for (const country of COUNTRIES) {
      for (const alias of country.aliases) {
        cases.push({
          id: `title-country-${slug(role)}-${country.code}-${slug(alias)}`,
          kind: "title+country-alias",
          search: `${role} ${alias}`,
          expect: {
            count: 3,
            every: { title: role, country: country.label },
            includes: [`${slug(role)}-${country.code}-remote`],
            excludes: [`${slug(role)}-${country.code === "US" ? "CA" : "US"}-remote`]
          }
        });
      }
    }
  }
  return cases;
}

function regionAliasCases() {
  const caseRoles = ["Software Engineer", "Director", "Backend Developer", "QA Engineer", "Marketing Specialist"];
  const cases = [];
  for (const role of caseRoles) {
    for (const region of REGION_ALIASES) {
      const countryCount = COUNTRIES.filter((country) => country.region === region.value).length;
      for (const alias of region.aliases) {
        cases.push({
          id: `region-${slug(role)}-${slug(alias)}`,
          kind: "region-alias",
          search: `${role} ${alias}`,
          expect: {
            count: countryCount * REMOTE_MODES.length,
            every: { title: role, region: region.value }
          }
        });
      }
    }
  }
  return cases;
}

function remoteModeCases() {
  const caseRoles = [
    "Software Engineer",
    "Data Analyst",
    "Product Manager",
    "Director",
    "QA Engineer",
    "Backend Developer",
    "Frontend Developer",
    "Security Engineer"
  ];
  const cases = [];
  for (const role of caseRoles) {
    for (const remote of ["remote", "hybrid", "non_remote"]) {
      cases.push({
        id: `remote-filter-${slug(role)}-${remote}`,
        kind: "remote-mode",
        search: role,
        options: { remote },
        expect: {
          count: COUNTRIES.length,
          every: {
            title: role,
            remote: remote === "non_remote" ? "onsite" : remote
          },
          excludes: [`${slug(role)}-US-${remote === "remote" ? "hybrid" : "remote"}`]
        }
      });
    }
  }
  return cases;
}

function diacriticAndQuoteCases() {
  return [
    {
      id: "diacritics-turkiye-title",
      kind: "diacritics-quotes",
      search: "Software Engineer T\u00fcrkiye",
      expect: { count: 3, every: { title: "Software Engineer", country: "Turkey" } }
    },
    {
      id: "diacritics-turkiye-ascii",
      kind: "diacritics-quotes",
      search: "Software Engineer Turkiye",
      expect: { count: 3, every: { title: "Software Engineer", country: "Turkey" } }
    },
    {
      id: "diacritics-turksih-typo",
      kind: "diacritics-quotes",
      search: "Director turksih",
      expect: { count: 3, every: { title: "Director", country: "Turkey" } }
    },
    {
      id: "quotes-double",
      kind: "diacritics-quotes",
      search: "\"Backend Developer\" \"Deutschland\"",
      expect: { count: 3, every: { title: "Backend Developer", country: "Germany" } }
    },
    {
      id: "quotes-single",
      kind: "diacritics-quotes",
      search: "'Frontend Developer' 'UK'",
      expect: { count: 3, every: { title: "Frontend Developer", country: "United Kingdom" } }
    },
    {
      id: "location-dusseldorf",
      kind: "diacritics-quotes",
      search: "Dusseldorf Security Engineer",
      expect: { count: 3, every: { title: "Security Engineer", country: "Germany" } }
    },
    {
      id: "location-dusseldorf-diacritic",
      kind: "diacritics-quotes",
      search: "D\u00fcsseldorf Security Engineer",
      expect: { count: 3, every: { title: "Security Engineer", country: "Germany" } }
    },
    {
      id: "country-u-dot-s-dot",
      kind: "diacritics-quotes",
      search: "QA Engineer U.S.",
      expect: { count: 3, every: { title: "QA Engineer", country: "United States" } }
    },
    {
      id: "country-u-dot-k-dot",
      kind: "diacritics-quotes",
      search: "Data Analyst U.K.",
      options: { include_ignored: true },
      expect: { count: 4, every: { title: "Data Analyst", country: "United Kingdom" } }
    },
    {
      id: "remote-wfh-alias",
      kind: "diacritics-quotes",
      search: "wfh Machine Learning Engineer",
      expect: { count: COUNTRIES.length, every: { title: "Machine Learning Engineer", remote: "remote" } }
    },
    {
      id: "remote-anywhere-alias",
      kind: "diacritics-quotes",
      search: "anywhere UX Designer",
      expect: { count: COUNTRIES.length, every: { title: "UX Designer", remote: "remote" } }
    },
    {
      id: "stop-word-roles",
      kind: "diacritics-quotes",
      search: "Product Manager jobs",
      expect: { count: COUNTRIES.length * REMOTE_MODES.length, every: { title: "Product Manager" } }
    },
    {
      id: "case-insensitive-title",
      kind: "diacritics-quotes",
      search: "finance analyst canada",
      expect: { count: 3, every: { title: "Finance Analyst", country: "Canada" } }
    },
    {
      id: "region-apac-spaced",
      kind: "diacritics-quotes",
      search: "Sales Manager Asia Pacific",
      expect: { count: 9, every: { title: "Sales Manager", region: "APAC" } }
    },
    {
      id: "hyphenated-onsite-text",
      kind: "diacritics-quotes",
      search: "On-site Nurse Practitioner",
      expect: { count: COUNTRIES.length, every: { title: "Nurse Practitioner", remote: "onsite" } }
    },
    {
      id: "structured-country-filter-alias",
      kind: "diacritics-quotes",
      search: "Director",
      options: { countries: ["Turkiye"], include_applied: true },
      expect: { count: 4, every: { title: "Director", country: "Turkey" } }
    },
    {
      id: "structured-region-filter-alias",
      kind: "diacritics-quotes",
      search: "Marketing Specialist",
      options: { regions: ["Europe"] },
      expect: { count: 12, every: { title: "Marketing Specialist", region: "EMEA" } }
    },
    {
      id: "hide-no-date",
      kind: "diacritics-quotes",
      search: "Software Engineer",
      options: { hide_no_date: true },
      expect: { count: 25, every: { title: "Software Engineer" } }
    },
    {
      id: "include-applied",
      kind: "diacritics-quotes",
      search: "Director Turkey",
      options: { include_applied: true },
      expect: { count: 4, includes: ["applied-director-TR-remote"], every: { title: "Director", country: "Turkey" } }
    },
    {
      id: "include-ignored",
      kind: "diacritics-quotes",
      search: "Data Analyst UK",
      options: { include_ignored: true },
      expect: { count: 4, includes: ["ignored-data-analyst-GB-hybrid"], every: { title: "Data Analyst" } }
    }
  ];
}

function titleOnlyCases() {
  return ROLES.map((role) => ({
    id: `title-only-${slug(role)}`,
    kind: "title-only",
    search: role,
    expect: {
      count: COUNTRIES.length * REMOTE_MODES.length,
      every: { title: role }
    }
  }));
}

function paginationCases() {
  return [
    {
      id: "pagination-engineer-page-1",
      kind: "pagination",
      search: "Engineer",
      options: { limit: 10, offset: 0 },
      expect: {
        count: 135,
        pageLength: 10,
        first: "software-engineer-US-remote",
        includes: ["software-engineer-US-remote"]
      }
    },
    {
      id: "pagination-engineer-page-2",
      kind: "pagination",
      search: "Engineer",
      options: { limit: 10, offset: 10 },
      expect: {
        count: 135,
        pageLength: 10,
        first: "software-engineer-GB-hybrid",
        excludes: ["software-engineer-US-remote"]
      }
    },
    {
      id: "pagination-engineer-last-page",
      kind: "pagination",
      search: "Engineer",
      options: { limit: 10, offset: 130 },
      expect: {
        count: 135,
        pageLength: 5
      }
    },
    {
      id: "pagination-director-country",
      kind: "pagination",
      search: "Director",
      options: { countries: ["US"], limit: 2, offset: 2 },
      expect: {
        count: 3,
        pageLength: 1,
        every: { title: "Director", country: "United States" }
      }
    },
    {
      id: "pagination-region-offset",
      kind: "pagination",
      search: "Analyst",
      options: { regions: ["EMEA"], limit: 5, offset: 5 },
      expect: {
        count: 24,
        pageLength: 5,
        every: { region: "EMEA" }
      }
    },
    {
      id: "pagination-remote-offset",
      kind: "pagination",
      search: "Manager",
      options: { remote: "remote", limit: 4, offset: 4 },
      expect: {
        count: 27,
        pageLength: 4,
        every: { remote: "remote" }
      }
    }
  ];
}

function negativeCases() {
  return [
    { id: "negative-empty-title", kind: "negative", search: "Rocket Surgeon", expect: { count: 0 } },
    { id: "negative-title-country", kind: "negative", search: "Software Engineer Antarctica", expect: { count: 0 } },
    {
      id: "negative-country-region-mismatch",
      kind: "negative",
      search: "Director",
      options: { countries: ["US"], regions: ["APAC"] },
      expect: { count: 0 }
    },
    {
      id: "negative-remote-country-mismatch",
      kind: "negative",
      search: "QA Engineer Japan",
      options: { remote: "remote", countries: ["Germany"] },
      expect: { count: 0 }
    },
    {
      id: "negative-hidden-default",
      kind: "negative",
      search: "Hidden Corpus Software Engineer",
      expect: { count: 0, excludes: ["hidden-software-engineer-US-remote"] }
    },
    {
      id: "negative-applied-default",
      kind: "negative",
      search: "Applied Corpus Director",
      expect: { count: 0, excludes: ["applied-director-TR-remote"] }
    },
    {
      id: "negative-ignored-default",
      kind: "negative",
      search: "Ignored Corpus Data Analyst",
      expect: { count: 0, excludes: ["ignored-data-analyst-GB-hybrid"] }
    },
    {
      id: "negative-non-remote-excludes-remote",
      kind: "negative",
      search: "Software Engineer",
      options: { remote: "non_remote" },
      expect: { count: COUNTRIES.length, excludes: ["software-engineer-US-remote", "software-engineer-US-hybrid"] }
    },
    {
      id: "negative-hybrid-excludes-onsite",
      kind: "negative",
      search: "Product Manager",
      options: { remote: "hybrid" },
      expect: { count: COUNTRIES.length, excludes: ["product-manager-US-onsite"] }
    },
    {
      id: "negative-hide-no-date-excludes-first-seed",
      kind: "negative",
      search: "Software Engineer",
      options: { hide_no_date: true },
      expect: { excludes: ["software-engineer-US-remote"] }
    }
  ];
}

function buildCorpusCases() {
  return [
    ...titleOnlyCases(),
    ...titleCountryCases(),
    ...regionAliasCases(),
    ...remoteModeCases(),
    ...diacriticAndQuoteCases(),
    ...paginationCases(),
    ...negativeCases()
  ];
}

module.exports = {
  COUNTRIES,
  REGION_ALIASES,
  REMOTE_MODES,
  ROLES,
  buildCorpusCases,
  buildSeedPostings,
  slug
};
