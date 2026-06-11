module.exports = function normalize(job, company) {
  return {
    title: job.title || job.position_name || 'Untitled',
    source_job_id: job.id || job.reqId || job.source_job_id || job.job_posting_url || String(Math.random())
  };
};
