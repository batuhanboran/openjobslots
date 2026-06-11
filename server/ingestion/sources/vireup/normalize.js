module.exports = function normalize(job, company) {
  return {
    source_job_id: String(job.id || job.reqId || job.source_job_id || job.jobId || ''),
    title: job.title || job.jobTitle || job.job_title || job.name || '',
    job_posting_url: job.url || job.job_posting_url || job.applyLink || ''
  };
};
