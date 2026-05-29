function cleanKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

const METHOD_PROFILES = [
  {
    ats_key: "applytojob",
    phase_targets: ["phase_2"],
    source_family: "html_detail",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: true,
    methods: [
      { kind: "fixture_backed_html", role: "current-control" },
      { kind: "bounded_detail_html", role: "field-gap-evidence" }
    ]
  },
  {
    ats_key: "breezy",
    phase_targets: ["phase_2"],
    source_family: "html_detail",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: true,
    methods: [
      { kind: "fixture_backed_html", role: "current-control" },
      { kind: "bounded_detail_html", role: "field-gap-evidence" }
    ]
  },
  {
    ats_key: "teamtailor",
    phase_targets: ["phase_2", "phase_3"],
    source_family: "direct_json_or_html",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: false,
    methods: [
      { kind: "teamtailor_rss", role: "preferred-method" },
      { kind: "fixture_backed_html", role: "fallback-certification" }
    ]
  },
  {
    ats_key: "icims",
    phase_targets: ["phase_2", "phase_3"],
    source_family: "html_detail",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: true,
    methods: [
      { kind: "paged_iframe_html", role: "current-list-method" },
      { kind: "bounded_detail_html", role: "field-gap-evidence" }
    ]
  },
  {
    ats_key: "applitrack",
    phase_targets: ["phase_2", "phase_3"],
    source_family: "public_sector_html_detail",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: true,
    methods: [
      { kind: "output_asp_list", role: "current-list-method" },
      { kind: "bounded_detail_html", role: "field-gap-evidence" }
    ]
  },
  {
    ats_key: "saphrcloud",
    aliases: ["successfactors"],
    phase_targets: ["phase_2"],
    source_family: "enterprise_api",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: false,
    methods: [
      { kind: "enterprise_api_or_board_html", role: "alias-method-review" }
    ]
  },
  {
    ats_key: "oracle",
    phase_targets: ["phase_2", "phase_3"],
    source_family: "enterprise_api",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: false,
    methods: [
      { kind: "candidate_experience_api", role: "current-method" },
      { kind: "pagination_variant", role: "fixture-gap" }
    ]
  },
  {
    ats_key: "workday",
    phase_targets: ["phase_2", "phase_3"],
    source_family: "enterprise_api",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: true,
    methods: [
      { kind: "cxs_job_postings_api", role: "current-method" },
      { kind: "pagination_variant", role: "fixture-gap" },
      { kind: "bounded_detail_html", role: "description-evidence" }
    ]
  },
  {
    ats_key: "greenhouse",
    phase_targets: ["phase_2"],
    source_family: "direct_json",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: false,
    methods: [
      { kind: "job_board_api", role: "positive-control" }
    ]
  },
  {
    ats_key: "lever",
    phase_targets: ["phase_2"],
    source_family: "direct_json",
    truth_boundary: "deterministic-parser-fixture",
    detail_evidence_allowed: false,
    methods: [
      { kind: "postings_api", role: "positive-control" },
      { kind: "pagination_variant", role: "fixture-gap" }
    ]
  }
];

function listSourceMethodProfiles() {
  return METHOD_PROFILES
    .map((profile) => ({
      ...profile,
      aliases: profile.aliases ? profile.aliases.slice() : [],
      methods: profile.methods.map((method) => ({ ...method })),
      phase_targets: profile.phase_targets.slice()
    }))
    .sort((a, b) => a.ats_key.localeCompare(b.ats_key));
}

function getSourceMethodProfile(source) {
  const key = cleanKey(source);
  const profile = METHOD_PROFILES.find((entry) => {
    if (entry.ats_key === key) return true;
    return (entry.aliases || []).some((alias) => cleanKey(alias) === key);
  });
  if (!profile) return null;
  return listSourceMethodProfiles().find((entry) => entry.ats_key === profile.ats_key) || null;
}

function getMethodExperimentSources() {
  return Array.from(new Set(METHOD_PROFILES.flatMap((profile) => [
    profile.ats_key,
    ...(profile.aliases || [])
  ]))).sort();
}

module.exports = {
  getMethodExperimentSources,
  getSourceMethodProfile,
  listSourceMethodProfiles
};
