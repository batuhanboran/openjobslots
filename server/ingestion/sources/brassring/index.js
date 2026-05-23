const { createSourceModule } = require("../common");
const parser = require("./parse");

module.exports = {
  ...createSourceModule("brassring"),
  ...parser
};
