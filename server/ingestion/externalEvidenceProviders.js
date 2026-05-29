const { DETAIL_EVIDENCE_STATUS } = require("./detailEvidence");

const PROVIDER_PROFILES = Object.freeze([
  {
    provider: "firecrawl",
    default_enabled: false,
    integration_role: "markdown-scrape-api",
    truth_boundary: "evidence-only",
    output_fields: ["markdown", "text", "html", "final_url", "warnings"]
  },
  {
    provider: "crawl4ai",
    default_enabled: false,
    integration_role: "self-hosted-llm-ready-crawler",
    truth_boundary: "evidence-only",
    output_fields: ["markdown", "text", "html", "final_url", "warnings"]
  },
  {
    provider: "crawlee",
    default_enabled: false,
    integration_role: "node-rendered-fetch-sidecar",
    truth_boundary: "evidence-only",
    output_fields: ["markdown", "text", "html", "final_url", "warnings"]
  }
]);

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeProvider(value) {
  return clean(value, 80).toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function listExternalEvidenceProviderProfiles() {
  return PROVIDER_PROFILES.map((profile) => ({
    ...profile,
    output_fields: profile.output_fields.slice()
  }));
}

function getExternalEvidenceProviderProfile(provider) {
  const normalized = normalizeProvider(provider);
  return listExternalEvidenceProviderProfiles().find((profile) => profile.provider === normalized) || null;
}

function normalizeAdapterResult(provider, sourceUrl, result = {}) {
  const profile = getExternalEvidenceProviderProfile(provider);
  return {
    ok: Boolean(result.ok ?? true),
    status: clean(result.status || DETAIL_EVIDENCE_STATUS.FETCHED, 80),
    finalUrl: clean(result.finalUrl || result.final_url || sourceUrl, 2000),
    httpStatus: Number(result.httpStatus || result.http_status || 200) || null,
    markdown: String(result.markdown || result.text || ""),
    text: String(result.text || result.markdown || ""),
    html: String(result.html || ""),
    extractorVersion: clean(result.extractorVersion || result.extractor_version || "1", 80),
    warnings: Array.isArray(result.warnings) ? result.warnings.map((warning) => clean(warning, 240)).filter(Boolean) : [],
    config: {
      ...(result.config || {}),
      provider,
      external_provider: true,
      integration_role: profile?.integration_role || "external-evidence-provider",
      evidence_only: true
    }
  };
}

function createExternalEvidenceExtractors(options = {}) {
  const adapters = options.adapters || {};
  const extractors = {};

  for (const profile of PROVIDER_PROFILES) {
    const adapter = adapters[profile.provider];
    if (typeof adapter !== "function") continue;
    extractors[profile.provider] = async (sourceUrl, extractorOptions = {}) => {
      const result = await adapter(sourceUrl, {
        ...extractorOptions,
        provider: profile.provider,
        profile: getExternalEvidenceProviderProfile(profile.provider)
      });
      return normalizeAdapterResult(profile.provider, sourceUrl, result);
    };
  }

  return extractors;
}

module.exports = {
  createExternalEvidenceExtractors,
  getExternalEvidenceProviderProfile,
  listExternalEvidenceProviderProfiles,
  normalizeAdapterResult
};
