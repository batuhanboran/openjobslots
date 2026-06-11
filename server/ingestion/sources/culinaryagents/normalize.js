module.exports = function normalize(job, company) {
  return {
    source_job_id: String(job.id || job.jobId || job.fid || ''),
    title: job.title || job.positionName || '',
    job_posting_url: job.url || job.link || job.jobPostingUrl || ''
  };
};
