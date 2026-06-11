module.exports = function normalize(job, company) {
  return {
    title: job.title || job.name,
    source_job_id: String(job.id || job.jobId || job.source_job_id || ''),
    job_posting_url: job.url || job.job_posting_url || ''
  };
};