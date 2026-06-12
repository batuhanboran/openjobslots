module.exports = function normalize(job, company) {
  return {
    title: job.title || job.jobTitle || "Unknown Title",
    source_job_id: String(job.id || job.jobId || "unknown")
  };
};
