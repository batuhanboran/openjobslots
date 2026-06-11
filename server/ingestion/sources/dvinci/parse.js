module.exports = function parse(list, company) {
  const items = Array.isArray(list) ? list : (Array.isArray(list?.jobs) ? list.jobs : (Array.isArray(list?.data?.jobs) ? list.data.jobs : []));
  return items;
};
