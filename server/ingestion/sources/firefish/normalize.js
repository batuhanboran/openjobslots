module.exports = function normalize(job, company) {
  return {
    title: job.JobTitle,
    source_job_id: String(job.JobId),
    job_posting_url: job.JobUrl,
    location: job.City,
    description: job.JobDescription
  };
};