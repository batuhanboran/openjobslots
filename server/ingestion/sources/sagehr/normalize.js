module.exports = function normalize(job, company) {
  return {
    title: job.position_name || "Unknown Title",
    source_job_id: job.job_posting_url || "unknown"
  };
};