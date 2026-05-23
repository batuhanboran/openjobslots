const { createSourceModule } = require("../common");
const parser = require("./parse");

module.exports = {
  ...createSourceModule("adp_workforcenow"),
  ...parser
};
