module.exports = function normalize(job, company) {
  return {
    title: job.name,
    source_job_id: String(job.id),
    job_posting_url: job.url,
    location: job.location,
    description: job.job_description
  };
};