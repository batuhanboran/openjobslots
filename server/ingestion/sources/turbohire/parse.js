module.exports = function parse(payload, company) {
  if (Array.isArray(payload)) return payload;
  if (payload && payload.jobs && Array.isArray(payload.jobs)) return payload.jobs;
  if (payload && payload.data && Array.isArray(payload.data)) return payload.data;
  return [];
};
