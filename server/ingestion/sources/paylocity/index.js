const { createSourceModule } = require("../common");
const parser = require("./parse");

module.exports = {
  ...createSourceModule("paylocity"),
  ...parser
};
