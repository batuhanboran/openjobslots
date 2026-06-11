module.exports = function normalize(job, company) {
  return {
    title: job.title || job.position_name,
    source_job_id: job.id || job.source_job_id
  };
};
