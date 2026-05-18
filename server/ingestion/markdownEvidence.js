function clean(value, max = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function field(value, fallback = "unknown") {
  const normalized = clean(value);
  return normalized || fallback;
}

function descriptionExcerpt(sample = {}, maxDescriptionLength = 500) {
  const raw = clean(
    sample.description_plain ||
    sample.description_text ||
    sample.description ||
    sample.description_html ||
    "",
    Math.max(0, Number(maxDescriptionLength || 0)) + 1
  );
  if (!raw) return "";
  if (raw.length <= maxDescriptionLength) return raw;
  return `${raw.slice(0, maxDescriptionLength).trim()}...`;
}

function sourceLabel(report = {}, sample = {}) {
  return field(sample.ats_key || sample.source || report.source, "unknown-source");
}

function sourceJobId(sample = {}) {
  return field(sample.source_job_id || sample.job_id || sample.id, "unknown-id");
}

function buildSampleSection(report = {}, sample = {}, options = {}) {
  const maxDescriptionLength = Math.max(0, Number(options.maxDescriptionLength || 500));
  const label = sourceLabel(report, sample);
  const jobId = sourceJobId(sample);
  const excerpt = descriptionExcerpt(sample, maxDescriptionLength);
  const lines = [
    `## ${label} / ${jobId}`,
    "",
    `- Source URL: ${field(sample.source_url || sample.source_company_url)}`,
    `- Canonical URL: ${field(sample.canonical_url || sample.job_posting_url)}`,
    `- Raw title: ${field(sample.title || sample.position_name)}`,
    `- Raw company/agency: ${field(sample.company || sample.company_name)}`,
    `- Raw location: ${field(sample.location || sample.location_text)}`,
    `- Parsed city: ${field(sample.city)}`,
    `- Parsed region: ${field(sample.region || sample.state)}`,
    `- Parsed country: ${field(sample.country)}`,
    `- Raw posted/open date: ${field(sample.posting_date || sample.posted_at)}`,
    `- Parsed posted epoch: ${field(sample.posted_at_epoch || sample.posting_date_epoch)}`,
    `- Remote evidence: ${field(sample.remote_type)}`,
    `- Parser version: ${field(sample.parser_version)}`,
    `- Confidence: ${field(sample.confidence || sample.parser_confidence || sample.confidence_score)}`,
    `- Quality score: ${field(sample.quality_score)}`,
    `- Quality gate: ${field(sample.classification || sample.net_new_classification || sample.status)}`,
    `- Missing fields: ${field(sample.reason || sample.validation_error || sample.failure_reason, "none")}`,
    ""
  ];
  if (excerpt) {
    lines.push("### Description excerpt", "", excerpt, "");
  }
  return lines.join("\n");
}

function reportsForMarkdown(report = {}) {
  if (Array.isArray(report.results)) return report.results;
  return [report];
}

function buildMarkdownEvidenceSnapshot(report = {}, options = {}) {
  const reports = reportsForMarkdown(report);
  const lines = [
    "# ATS Evidence Snapshot",
    "",
    `Generated at: ${field(report.generated_at || new Date().toISOString())}`,
    "",
    "These samples are review artifacts only. They must not be used to infer or invent country, region, city, remote type, posting date, or source id.",
    ""
  ];
  let sectionCount = 0;
  for (const item of reports) {
    const samples = Array.isArray(item.samples) ? item.samples : [];
    for (const sample of samples) {
      lines.push(buildSampleSection(item, sample, options));
      sectionCount += 1;
    }
  }
  if (sectionCount === 0) {
    lines.push("No candidate samples were available in this report.", "");
  }
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  buildMarkdownEvidenceSnapshot
};
