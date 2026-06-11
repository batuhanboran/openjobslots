module.exports = function parse(list, company) {
  return Array.isArray(list) ? list : (list.jobs || []);
};
