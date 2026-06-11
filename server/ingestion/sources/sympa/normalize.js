module.exports = function normalize(job, company) {
  return {
    title: job.title || "Unknown Title",
    source_job_id: String(job.id || "unknown")
  };
};
