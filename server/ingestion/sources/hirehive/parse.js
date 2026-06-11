module.exports = function parse(list, company) {
  return Array.isArray(list) ? list : (list && (list.jobs || list.data || list.vacancies)) || [];
};