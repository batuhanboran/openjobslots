module.exports = function normalize(job, company) {
  return {
    title: job.job_title,
    source_job_id: String(job.req_id),
    job_posting_url: job.req_url,
    location: job.city,
    description: job.description
  };
};