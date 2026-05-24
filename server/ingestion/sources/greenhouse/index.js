const { SOURCE_FAMILIES, SOURCE_STATUSES } = require("../../sourceContracts");
const { createSourceModule } = require("../common");
const parser = require("./parse");

const sourceModule = createSourceModule("greenhouse");

module.exports = {
  ...sourceModule,
  atsKey: "greenhouse",
  family: SOURCE_FAMILIES.directJsonStable,
  status: SOURCE_STATUSES.enabled,
  ...parser
};
