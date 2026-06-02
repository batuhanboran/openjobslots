const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const appConfig = require(path.join(repoRoot, "app.json"));
const packageJson = require(path.join(repoRoot, "package.json"));
const {
  FLYONUI_NATIVE_POLICY,
  PRODUCTION_PUBLIC_API_BASE_URL,
  PUBLIC_MOBILE_ENDPOINTS
} = require(path.join(repoRoot, "src", "mobile", "publicSurface"));

const appSource = fs.readFileSync(path.join(repoRoot, "App.js"), "utf8");
const easJsonPath = path.join(repoRoot, "eas.json");
assert.ok(fs.existsSync(easJsonPath), "eas.json must exist for store build profiles");
const easJson = JSON.parse(fs.readFileSync(easJsonPath, "utf8"));

const expo = appConfig.expo || {};
assert.strictEqual(expo.name, "OJS", "Android launcher label should stay short enough for mobile home screens");
assert.ok(expo.name.length <= 4, "Android launcher label should not hyphen-wrap the product name");
assert.ok((expo.platforms || []).includes("ios"), "Expo config must include ios");
assert.ok((expo.platforms || []).includes("android"), "Expo config must include android");
assert.strictEqual(expo.ios?.bundleIdentifier, "com.openjobslots.app");
assert.strictEqual(expo.android?.package, "com.openjobslots.app");
assert.strictEqual(expo.scheme, "openjobslots");

for (const profileName of ["development", "preview", "production"]) {
  assert.strictEqual(
    easJson.build?.[profileName]?.env?.EXPO_PUBLIC_API_BASE_URL,
    PRODUCTION_PUBLIC_API_BASE_URL,
    `${profileName} build must target the public production API`
  );
}

assert.deepStrictEqual(PUBLIC_MOBILE_ENDPOINTS, [
  "/postings",
  "/postings/filter-options",
  "/search/popular",
  "/search/suggest",
  "/sync/status",
  "/ingestion/status"
]);
assert.strictEqual(FLYONUI_NATIVE_POLICY.allowedInNativeApp, false);
assert.ok(!packageJson.dependencies?.flyonui, "FlyonUI must not be a native app dependency");
assert.ok(!packageJson.devDependencies?.flyonui, "FlyonUI must not be a native app devDependency");
assert.ok(
  appSource.includes('const animatedSearchPlaceholderEnabled = Platform.OS === "web";'),
  "Native mobile search placeholder should stay static to avoid idle render timers"
);
assert.ok(
  appSource.includes("if (!animatedSearchPlaceholderEnabled) return undefined;"),
  "Search placeholder timer must be gated away from native mobile"
);
assert.ok(
  appSource.includes("const emptySearchPlaceholder = compact ? compactSearchPlaceholder : exampleSearchPlaceholder;"),
  "Compact result search should use the short mobile-safe placeholder"
);
assert.ok(
  appSource.includes("if (showResultsSurface) return undefined;"),
  "Search placeholder timer should stay off while the compact results surface is active"
);
assert.ok(
  appSource.includes("Keyboard,"),
  "Native search flows should import Keyboard for submit-time dismissal"
);
assert.ok(
  appSource.includes("function dismissSearchKeyboard(inputRef)"),
  "Native search flows should centralize keyboard dismissal"
);
assert.ok(
  appSource.includes("inputRef?.current?.blur?.();"),
  "Native search submit/clear flows should blur the search input after submission"
);
assert.ok(
  appSource.includes("setTimeout(dismissInput, 350);"),
  "Native search submit should retry blur after the results input remounts"
);
assert.ok(
  appSource.includes("const suppressNativeSearchFocusRef = useRef(false);"),
  "Native search submit should suppress remount focus until the user edits again"
);
assert.ok(
  appSource.includes("resetNativeSearchFocus();"),
  "Native search submit/clear flows should clear the focused search frame once results are visible"
);
assert.ok(
  appSource.includes("const [hideNativeSearchCaret, setHideNativeSearchCaret] = useState(false);"),
  "Native search submit should track submitted presentation separately from TextInput focus"
);
assert.ok(
  appSource.includes("setHideNativeSearchCaret(true);"),
  "Native search submit should hide the caret after submission"
);
assert.ok(
  appSource.includes('caretHidden={Platform.OS !== "web" && hideNativeSearchCaret}'),
  "Native search results should not leave a visible caret after submission"
);
assert.ok(
  !appSource.includes("showNativeSearchDisplay"),
  "Native search results should keep the TextInput mounted so a real tap can reopen Android IME"
);
assert.ok(
  !appSource.includes("activateNativeSearchEditing"),
  "Native submitted search text should not rely on programmatic focus from a remounted display control"
);
assert.ok(
  appSource.includes('submitBehavior: "blurAndSubmit"'),
  "Native search submit should blur the search input before showing refreshed results"
);
assert.ok(
  appSource.includes("showSoftInputOnFocus: true"),
  "Native search edit mode should explicitly allow the soft keyboard to reopen"
);
assert.ok(
  appSource.includes("onPressIn={handleSearchPressIn}"),
  "Native submitted search text should re-enable caret state before the tapped TextInput receives focus"
);
assert.ok(
  appSource.includes("dismissSearchKeyboard(searchInputRef);"),
  "Native search submit/clear flows should dismiss the soft keyboard so results are not covered"
);

console.log("mobile store readiness checks passed");
