const { SOURCE_FAMILIES, SOURCE_STATUSES } = require("../../sourceContracts");
const { createSourceModule } = require("../common");
const parser = require("./parse");

const sourceModule = createSourceModule("icims");

module.exports = {
  ...sourceModule,
  atsKey: "icims",
  family: SOURCE_FAMILIES.embeddedOrSemiStructured,
  status: SOURCE_STATUSES.enabled,
  ...parser
};
