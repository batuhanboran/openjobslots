module.exports = function normalize(job, company) {
  return {
    title: job.title || 'Untitled',
    source_job_id: job.id || job.reqId || String(Math.random())
  };
};
