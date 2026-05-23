"use strict";

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCharCode(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) => String.fromCharCode(parseInt(codePoint, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#x22;/gi, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractJsonLdObjectsFromHtml(sourceHtml) {
  const source = String(sourceHtml || "");
  const objects = [];
  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = scriptPattern.exec(source);

  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    objects.push(value);
    if (Array.isArray(value["@graph"])) visit(value["@graph"]);
  };

  while (match) {
    const raw = String(match[1] || "").trim();
    if (raw) {
      try {
        visit(JSON.parse(raw));
      } catch {
        try {
          visit(JSON.parse(decodeHtmlEntities(raw)));
        } catch {
          // Ignore malformed structured data and continue with DOM labels.
        }
      }
    }
    match = scriptPattern.exec(source);
  }

  return objects;
}

module.exports = {
  decodeHtmlEntities,
  extractJsonLdObjectsFromHtml
};
