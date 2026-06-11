module.exports = function normalize(job, company) {
  return {
    title: job.title,
    source_job_id: String(job.id),
    job_posting_url: job.url,
    location: job.location,
    description: job.description
  };
};