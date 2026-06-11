module.exports = function normalize(job, company) {
  return {
    title: job.jobTitle,
    source_job_id: String(job.id),
    job_posting_url: job.jobUrl,
    location: job.jobLocation,
    description: job.description
  };
};