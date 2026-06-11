module.exports = function normalize(job, company) {
  return {
    title: job.job_title || job.title || 'Untitled',
    source_job_id: String(job.job_id || job.id || Math.random())
  };
};
