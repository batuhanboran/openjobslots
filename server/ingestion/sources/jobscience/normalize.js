module.exports = function normalize(job, company) {
  return {
    title: job.title || "",
    source_job_id: String(job.id || job.job_id || ""),
    job_posting_url: job.url || job.job_url || ""
  };
};
