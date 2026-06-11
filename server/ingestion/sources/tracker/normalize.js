module.exports = function normalize(job, company) {
  return {
    title: job.title || "No Title",
    source_job_id: String(job.id || "")
  };
};
