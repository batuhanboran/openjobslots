module.exports = function parse(list, company) {
  if (!list) return [];
  if (Array.isArray(list)) return list;
  return list.jobs || list.data || [];
};
