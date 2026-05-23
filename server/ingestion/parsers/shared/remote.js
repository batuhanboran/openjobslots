"use strict";

const { decodeHtmlEntities } = require("./html");

function stripSearchDiacritics(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I");
}

function normalizeSearchText(value) {
  return stripSearchDiacritics(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cleanRemoteText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function normalizeExplicitRemoteValue(value) {
  const raw = cleanRemoteText(value);
  const normalized = normalizeSearchText(raw);
  if (!normalized) return null;
  if (/\b(not|non|no)\s+(?:a\s+)?(?:remote|hybrid|telework|work from home|wfh)\b/.test(normalized)) return "onsite";
  if (/^(yes|true|y|1)$/.test(normalized)) return "remote";
  if (/^(no|false|n|0)$/.test(normalized)) return "onsite";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/\b(remote|virtual|telework|work from home|wfh)\b/.test(normalized)) return "remote";
  if (/\b(on[- ]?site|onsite|office)\b/.test(normalized)) return "onsite";
  return null;
}

module.exports = {
  normalizeExplicitRemoteValue
};
