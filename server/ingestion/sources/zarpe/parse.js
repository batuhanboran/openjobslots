module.exports = function parse(payload, company = {}) {
  if (!payload) return [];
  const items = Array.isArray(payload) ? payload : (Array.isArray(payload.jobs) ? payload.jobs : []);
  return items;
};
