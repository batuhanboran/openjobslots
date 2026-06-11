module.exports = function normalize(job, company) {
  return {
    title: job.title || job.jobTitle,
    source_job_id: job.id || job.jobId || String(job.source_job_id),
    job_posting_url: job.url || job.jobUrl,
    canonical_url: job.url || job.jobUrl,
    parser_key: "talentiojapan"
  };
};
module.exports.normalize = module.exports;
