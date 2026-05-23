const { createSourceModule } = require("../common");
const parser = require("./parse");

module.exports = {
  ...createSourceModule("ultipro"),
  ...parser
};
