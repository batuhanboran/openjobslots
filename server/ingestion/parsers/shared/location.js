"use strict";

const { normalizeRemoteType } = require("../../posting");

function isRemoteOnlyLocationValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (normalizeRemoteType(normalized) === "unknown") return false;
  return /^(remote|hybrid|onsite|on[- ]?site|work from home|wfh|virtual|telework|home based)$/i.test(normalized);
}

module.exports = {
  isRemoteOnlyLocationValue
};
