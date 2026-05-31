const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const APP_PATH = path.join(__dirname, "..", "App.js");
const source = fs.readFileSync(APP_PATH, "utf8");
const ast = parser.parse(source, {
  sourceType: "module",
  plugins: ["jsx"]
});

function propertyName(property) {
  if (property?.key?.type === "StringLiteral") return property.key.value;
  if (property?.key?.type === "Identifier") return property.key.name;
  return "";
}

function evaluateLiteral(node) {
  if (!node) return undefined;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "NumericLiteral") return node.value;
  if (node.type === "BooleanLiteral") return node.value;
  if (node.type === "NullLiteral") return null;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((item) => item.value.cooked).join("");
  }
  if (node.type === "ArrayExpression") {
    return node.elements.map(evaluateLiteral);
  }
  if (node.type === "ObjectExpression") {
    const value = {};
    for (const property of node.properties) {
      if (property.type === "ObjectProperty") value[propertyName(property)] = evaluateLiteral(property.value);
      if (property.type === "SpreadElement") Object.assign(value, evaluateLiteral(property.argument) || {});
    }
    return value;
  }
  if (node.type === "CallExpression" && node.callee.name === "createPublicLanguagePack") {
    return evaluateLiteral(node.arguments[0]);
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.name === "Object" &&
    node.callee.property.name === "freeze"
  ) {
    return evaluateLiteral(node.arguments[0]);
  }
  return undefined;
}

function extractAppI18nState() {
  const state = {
    languages: [],
    baseMessages: {},
    assignedMessages: {},
    supplements: {},
    releases: [],
    releaseTranslations: {}
  };

  traverse(ast, {
    VariableDeclarator(pathRef) {
      const name = pathRef.node.id?.name;
      if (name === "PUBLIC_LANGUAGE_OPTIONS") state.languages = evaluateLiteral(pathRef.node.init) || [];
      if (name === "PUBLIC_MESSAGES") state.baseMessages = evaluateLiteral(pathRef.node.init) || {};
      if (name === "PUBLIC_LANGUAGE_PACK_COMPLETION_COPY") state.supplements = evaluateLiteral(pathRef.node.init) || {};
      if (name === "PUBLIC_RELEASE_NOTES") state.releases = evaluateLiteral(pathRef.node.init) || [];
      if (name === "PUBLIC_RELEASE_NOTE_TRANSLATIONS") state.releaseTranslations = evaluateLiteral(pathRef.node.init) || {};
    },
    CallExpression(pathRef) {
      const node = pathRef.node;
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.object.name === "Object" &&
        node.callee.property.name === "assign" &&
        node.arguments[0]?.name === "PUBLIC_MESSAGES"
      ) {
        state.assignedMessages = evaluateLiteral(node.arguments[1]) || {};
      }
    }
  });

  return state;
}

function buildPublicLanguagePackSupplement(copy = {}) {
  return {
    "search.examplePrefix": copy.examplePrefix,
    "filters.loading": copy.filtersLoading,
    "filters.global.locationTitle": copy.locationTitle,
    "filters.global.locationCopy": copy.locationCopy,
    "filters.ats": copy.ats,
    "filters.ats.any": copy.allAts,
    "filters.industries.any": copy.anyIndustry,
    "filters.regions.any": copy.worldwide,
    "filters.countries.any": copy.allCountries,
    "filters.states.any": copy.allStates,
    "filters.counties": copy.counties,
    "filters.counties.any": copy.allCounties,
    "filters.industries.empty": copy.noIndustries,
    "filters.industries.helper": copy.industriesHelper,
    "filters.regions.empty": copy.regionsEmpty,
    "filters.regions.helper": copy.regionsHelper,
    "filters.countries.emptyRegion": copy.countriesEmptyRegion,
    "filters.countries.empty": copy.countriesEmpty,
    "filters.countries.helperRegion": copy.countriesHelperRegion,
    "filters.countries.helper": copy.countriesHelper,
    "filters.states.empty": copy.statesEmpty,
    "filters.states.helper": copy.statesHelper,
    "filters.counties.empty": copy.countiesEmpty,
    "filters.counties.helper": copy.countiesHelper,
    "filters.countryHint": copy.countryHint,
    "filters.stateHint": copy.stateHint,
    "freshness.3": copy.freshness3,
    "freshness.7": copy.freshness7,
    "freshness.30": copy.freshness30,
    "remote.allShort": copy.anyShort,
    "remote.remoteShort": copy.remoteShort,
    "remote.hybridShort": copy.hybridShort,
    "remote.nonRemoteShort": copy.onSiteShort,
    "remote.hideNoDate": copy.hideNoDate,
    "sources.empty": copy.sourcesEmpty,
    "results.toSeeSlots": copy.toSeeSlots,
    "results.indexLoading": copy.indexLoading,
    "sort.ats_source": copy.sortAtsSource,
    "release.closeA11y": copy.releaseCloseA11y,
    "release.historyLabel": copy.releaseHistoryLabel,
    "release.openA11y": copy.releaseOpenA11y,
    "stats.ats": copy.ats,
    "suggestion.search": copy.suggestionSearch,
    "suggestion.recent": copy.suggestionRecent,
    "suggestion.ats": copy.ats,
    "dropdown.empty": copy.dropdownEmpty,
    "dropdown.noMatch": copy.dropdownNoMatch,
    "dropdown.showing": copy.dropdownShowing,
    "sources.result": copy.sourceResult,
    "sources.results": copy.sourceResults,
    "sources.confidence": copy.sourceConfidence,
    "sources.quality": copy.sourceQuality,
    "sources.freshSeen": copy.sourceFreshSeen,
    "sources.currentSet": copy.sourceCurrentSet,
    "search.intentDetected": copy.intentDetected,
    "posting.atsLabel": copy.ats,
    "empty.searchAllLocations": copy.searchAllLocations,
    "empty.allWorkModes": copy.allWorkModes,
    "results.scrollMore": copy.scrollMore,
    ...(copy.extra || {})
  };
}

function mergedMessagesForLanguage(state, languageCode) {
  const base = state.baseMessages.en || {};
  const own = languageCode === "en"
    ? base
    : (state.baseMessages[languageCode] || { ...base, ...(state.assignedMessages[languageCode] || {}) });
  const supplement = state.supplements[languageCode]
    ? buildPublicLanguagePackSupplement(state.supplements[languageCode])
    : {};
  return {
    ...base,
    ...own,
    ...supplement
  };
}

const SAME_TEXT_ALLOWED_KEYS = new Set([
  "filters.ats",
  "filters.show",
  "remote.remoteShort",
  "remote.hybridShort",
  "stats.ats",
  "sort.ats_source",
  "suggestion.ats",
  "suggestion.region",
  "suggestion.recent",
  "posting.atsLabel",
  "release.versionLabel"
]);

test("public language packs cover every public UI message key", () => {
  const state = extractAppI18nState();
  const baseKeys = Object.keys(state.baseMessages.en || {});
  assert.ok(baseKeys.length > 100, "English public message baseline should be parsed");

  for (const language of state.languages) {
    const languageCode = language.code;
    const messages = mergedMessagesForLanguage(state, languageCode);
    for (const key of baseKeys) {
      assert.equal(typeof messages[key], "string", `${languageCode} missing ${key}`);
      assert.ok(messages[key].trim(), `${languageCode} has blank ${key}`);
    }
  }
});

test("non-English language packs do not inherit broad English search/result/version copy", () => {
  const state = extractAppI18nState();
  const english = state.baseMessages.en || {};

  for (const language of state.languages.filter((item) => item.code !== "en")) {
    const messages = mergedMessagesForLanguage(state, language.code);
    const inherited = Object.entries(english)
      .filter(([key, value]) => !SAME_TEXT_ALLOWED_KEYS.has(key) && messages[key] === value)
      .map(([key]) => key);
    assert.deepEqual(inherited, [], `${language.code} still inherits English copy: ${inherited.join(", ")}`);
  }
});

test("release notes never collapse to one repeated generic summary", () => {
  const state = extractAppI18nState();
  const topVersions = state.releases.slice(0, 6);
  assert.equal(topVersions.length, 6);
  assert.ok(source.includes("summary: translated?.summary || release.summary"), "release fallback must stay version-specific");

  for (const language of state.languages) {
    const genericSummary = mergedMessagesForLanguage(state, language.code)["release.genericSummary"];
    const summaries = topVersions.map((release) =>
      state.releaseTranslations[language.code]?.[release.version]?.summary || release.summary
    );
    assert.equal(new Set(summaries).size, summaries.length, `${language.code} top release summaries repeat`);
    assert.ok(!summaries.includes(genericSummary), `${language.code} uses the generic release summary in top releases`);
  }
});

test("visible non-English release-note lanes have handcrafted top-release translations", () => {
  const state = extractAppI18nState();
  const topVersions = state.releases.slice(0, 6).map((release) => release.version);
  const directlyLocalizedLanguages = ["tr", "de", "fr", "es", "pt-BR", "pt-PT", "it", "nl", "pl"];

  for (const languageCode of directlyLocalizedLanguages) {
    for (const version of topVersions) {
      assert.ok(state.releaseTranslations[languageCode]?.[version]?.title, `${languageCode} missing release title ${version}`);
      assert.ok(state.releaseTranslations[languageCode]?.[version]?.summary, `${languageCode} missing release summary ${version}`);
    }
  }
});
