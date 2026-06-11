module.exports = function parse(list, company) {
  if (Array.isArray(list)) return list;
  if (list && Array.isArray(list.data)) return list.data;
  if (list && Array.isArray(list.jobs)) return list.jobs;
  return [];
};