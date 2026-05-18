# OpenJobSlots 2.0 Demo And ATS Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build reviewable 2.0 demos first, then implement the approved frontend refresh and read-only ATS intelligence layer without exposing internal diagnostics or changing production data.

**Architecture:** Keep the demo phase isolated under `docs/demos/` and keep production app changes behind reviewed tasks. Public UI reads only public-safe posting/search/filter data, while ATS intelligence is exposed through admin-only or local read-only reporting paths.

**Tech Stack:** React Native / React Native Web, Express 5, Node.js scripts, Playwright, existing ATS workbench tooling, existing admin token diagnostic guard.

---

## File Structure

- Create: `docs/demos/openjobslots-2.0/index.html`
  - Static, local-only review demo with three switchable 2.0 concepts.
- Modify: `App.js`
  - Later implementation of public shell, design tokens, card motion, card actions, and version labels.
- Modify: `src/api.js`
  - Later removal of public diagnostics calls from public card flows and optional addition of admin-only ATS intelligence calls.
- Modify: `server/index.js`
  - Later admin-only read endpoint for source intelligence if the existing workbench output needs HTTP access.
- Modify: `scripts/ats-workbench.js`
  - Later extension of read-only source ranking fields when needed.
- Test: `tests/e2e/postings.spec.js`
  - Browser-level verification for search, card actions, mobile layout, and public diagnostics non-exposure.
- Test: `tests/api/core-api.test.js`
  - API verification for public route behavior and admin-only diagnostics.
- Test: `scripts/ats-workbench.test.js`
  - Read-only ATS intelligence scoring and ranking verification.
- Create: `docs/reference/cloudflare-waf-2.0-checklist.md`
  - Manual checklist for Cloudflare/WAF review before deploy.
- Create: `docs/reference/sentry-2.0-readiness.md`
  - Sentry instrumentation and credential readiness checklist.

---

### Task 1: Lock The Demo Direction

**Files:**
- Create: `docs/demos/openjobslots-2.0/index.html`
- Test: local browser review

- [ ] **Step 1: Add the local demo shell**

Create `docs/demos/openjobslots-2.0/index.html` with self-contained HTML, CSS, and JavaScript. It must not call production APIs. The page must include tabs for:

```text
Dense Search Cockpit
Mobile Job Card Stack
ATS Intelligence Overlay
```

- [ ] **Step 2: Verify the demo opens locally**

Run:

```powershell
Start-Process "C:\Users\BaronPC\Documents\New project\OpenJobSlots\docs\demos\openjobslots-2.0\index.html"
```

Expected: the browser opens a static OpenJobSlots 2.0 demo with switchable views and animated card/button states.

- [ ] **Step 3: Capture desktop and mobile screenshots**

Run:

```powershell
npx playwright screenshot "file:///C:/Users/BaronPC/Documents/New%20project/OpenJobSlots/docs/demos/openjobslots-2.0/index.html" docs/demos/openjobslots-2.0/desktop.png --viewport-size=1440,1000
npx playwright screenshot "file:///C:/Users/BaronPC/Documents/New%20project/OpenJobSlots/docs/demos/openjobslots-2.0/index.html" docs/demos/openjobslots-2.0/mobile.png --viewport-size=390,844
```

Expected: both screenshots render non-empty UI, with no text overlap and visible job cards.

- [ ] **Step 4: Commit the demo artifact**

```powershell
git add docs/demos/openjobslots-2.0/index.html
git commit -m "docs: add openjobslots 2.0 review demo"
```

---

### Task 2: Add Public-Safe Frontend Tokens

**Files:**
- Modify: `App.js`
- Test: `tests/e2e/postings.spec.js`

- [ ] **Step 1: Write the failing E2E assertion for visible 2.0 public shell**

Add this assertion to `tests/e2e/postings.spec.js` after the page loads the postings UI:

```javascript
await expect(page.getByTestId("brand-wordmark")).toBeVisible();
await expect(page.getByTestId("postings-search-input")).toBeVisible();
await expect(page.getByTestId("results-surface")).toBeVisible();
await expect(page.getByTestId("posting-card").first()).toBeVisible();
```

- [ ] **Step 2: Run the E2E test to record current behavior**

Run:

```powershell
npm run test:e2e -- tests/e2e/postings.spec.js
```

Expected: existing tests pass or fail only on the new 2.0-specific selectors if the current fixture path does not render them consistently.

- [ ] **Step 3: Replace the public palette with 2.0 tokens**

In `App.js`, replace the `OJS_COLORS` object with a balanced neutral/teal/status palette:

```javascript
const OJS_COLORS = {
  blue: "#243447",
  accent: "#A7D8C9",
  accentSoft: "#EAF6F2",
  red: "#C95F5F",
  yellow: "#A36B20",
  green: "#2F8068",
  ink: "#17212B",
  text: "#26323D",
  muted: "#61707E",
  slotGray: "#61707E",
  border: "#D5DDE5",
  softBorder: "#E6EBF0",
  bg: "#F7F9FB",
  surface: "#FFFFFF",
  surfaceMuted: "#F0F4F7",
  hover: "#EDF6F3",
  pressed: "#D9F0E8",
  focus: "#2F8068",
  success: "#2F8068",
  successSoft: "#EAF6F2",
  warning: "#A36B20",
  warningSoft: "#FFF5E6",
  danger: "#A83F3F",
  dangerSoft: "#F8E8E8",
  shadow: "#17212B"
};
```

- [ ] **Step 4: Update version labels only after release scope is accepted**

Change:

```javascript
const PUBLIC_APP_VERSION = "1.8.0";
```

to:

```javascript
const PUBLIC_APP_VERSION = "2.0.0";
```

Expected: the public label reads `Public v2.0.0` only on the release branch, not during demo-only work.

- [ ] **Step 5: Run syntax and E2E checks**

Run:

```powershell
node --check App.js
npm run test:e2e -- tests/e2e/postings.spec.js
```

Expected: syntax check passes and postings E2E remains green.

---

### Task 3: Redesign Posting Cards With Motion

**Files:**
- Modify: `App.js`
- Test: `tests/e2e/postings.spec.js`

- [ ] **Step 1: Add E2E coverage for card actions**

Add assertions that the first posting card exposes public-safe actions and does not expose diagnostics by default:

```javascript
const firstCard = page.getByTestId("posting-card").first();
await expect(firstCard.getByText(/ATS:/)).toBeVisible();
await expect(firstCard.getByTestId("posting-card-open")).toBeVisible();
await expect(page.getByTestId("posting-card-source-toggle").first()).toHaveCount(0);
```

- [ ] **Step 2: Run the card test and confirm current public diagnostics exposure fails**

Run:

```powershell
npm run test:e2e -- tests/e2e/postings.spec.js
```

Expected: the source toggle assertion fails until public card diagnostics are removed or hidden behind admin state.

- [ ] **Step 3: Add card motion values inside `PostingCard`**

Add local animated values:

```javascript
const cardMotionRef = useRef(new Animated.Value(0));
const actionMotionRef = useRef(new Animated.Value(0));

useEffect(() => {
  Animated.timing(cardMotionRef.current, {
    toValue: 1,
    duration: 180,
    useNativeDriver: Platform.OS !== "web"
  }).start();
}, []);
```

- [ ] **Step 4: Apply restrained card animation**

Wrap the card root with:

```javascript
<Animated.View
  style={[
    styles.card,
    {
      opacity: cardMotionRef.current,
      transform: [
        {
          translateY: cardMotionRef.current.interpolate({
            inputRange: [0, 1],
            outputRange: [8, 0]
          })
        }
      ]
    }
  ]}
  testID="posting-card"
>
```

Expected: card entry uses opacity and translate only.

- [ ] **Step 5: Move detailed source diagnostics behind admin state**

Render the source toggle only when `showAdminActions` is true:

```javascript
{showAdminActions ? (
  <View style={styles.postingCardSourceRow}>
    <Pressable
      onPress={() => onToggleDiagnostics?.(item)}
      style={({ pressed }) => [styles.postingCardSourceButton, pressed ? styles.buttonPressed : null]}
      testID="posting-card-source-toggle"
      accessibilityRole="button"
      accessibilityLabel="Show posting source and quality details"
    >
      <Text style={styles.postingCardSourceButtonText}>{diagnosticsOpen ? "Hide source" : "Source"}</Text>
    </Pressable>
  </View>
) : null}
```

- [ ] **Step 6: Run card action tests**

Run:

```powershell
node --check App.js
npm run test:e2e -- tests/e2e/postings.spec.js
```

Expected: public cards render, actions remain reachable, and source diagnostics are absent for non-admin users.

---

### Task 4: Build Read-Only ATS Intelligence Summary

**Files:**
- Modify: `scripts/ats-workbench.js`
- Modify: `scripts/ats-workbench.test.js`
- Optional Modify: `server/index.js`
- Test: `scripts/ats-workbench.test.js`, `tests/api/core-api.test.js`

- [ ] **Step 1: Add source intelligence test fixtures**

In `scripts/ats-workbench.test.js`, add a fixture shaped like:

```javascript
const sourceRows = [
  {
    ats: "greenhouse",
    accepted_count: 1200,
    rejected_count: 40,
    last_success_epoch: 1778950000,
    last_failure_epoch: 0,
    no_geo_no_remote_count: 18,
    estimated_net_new_count: 220
  },
  {
    ats: "legacy-html",
    accepted_count: 80,
    rejected_count: 210,
    last_success_epoch: 1777000000,
    last_failure_epoch: 1778952000,
    no_geo_no_remote_count: 51,
    estimated_net_new_count: 12
  }
];
```

- [ ] **Step 2: Assert intelligence ratings**

Add expectations:

```javascript
assert.equal(scoreSourceIntelligence(sourceRows[0]).recommendation, "promote");
assert.equal(scoreSourceIntelligence(sourceRows[1]).recommendation, "repair");
assert.ok(scoreSourceIntelligence(sourceRows[0]).parser_confidence > scoreSourceIntelligence(sourceRows[1]).parser_confidence);
```

- [ ] **Step 3: Run the test to confirm the function is missing**

Run:

```powershell
node scripts/ats-workbench.test.js
```

Expected: FAIL with `scoreSourceIntelligence is not defined` or an equivalent export failure.

- [ ] **Step 4: Implement `scoreSourceIntelligence`**

Add a pure function to `scripts/ats-workbench.js`:

```javascript
function scoreSourceIntelligence(row) {
  const accepted = Math.max(0, Number(row.accepted_count || 0));
  const rejected = Math.max(0, Number(row.rejected_count || 0));
  const missingGeoRemote = Math.max(0, Number(row.no_geo_no_remote_count || 0));
  const netNew = Math.max(0, Number(row.estimated_net_new_count || 0));
  const total = accepted + rejected;
  const rejectionRate = total > 0 ? rejected / total : 1;
  const missingRate = accepted > 0 ? missingGeoRemote / accepted : 1;
  const parserConfidence = Math.max(0, Math.min(1, 1 - rejectionRate * 0.7 - missingRate * 0.3));
  const recommendation =
    parserConfidence >= 0.85 && netNew >= 100
      ? "promote"
      : parserConfidence >= 0.7 && netNew >= 25
        ? "monitor"
        : rejectionRate >= 0.5 || missingRate >= 0.4
          ? "repair"
          : "hold";

  return {
    ats: String(row.ats || "unknown"),
    accepted_count: accepted,
    rejected_count: rejected,
    parser_confidence: Number(parserConfidence.toFixed(3)),
    estimated_net_new_count: netNew,
    recommendation
  };
}
```

- [ ] **Step 5: Export and reuse the function**

Export it from the same module export object already used by the workbench tests:

```javascript
module.exports = {
  ...module.exports,
  scoreSourceIntelligence
};
```

If the file currently uses a single `module.exports = { ... }` block, add `scoreSourceIntelligence` to that object instead of replacing it.

- [ ] **Step 6: Run backend checks**

Run:

```powershell
node --check scripts/ats-workbench.js
node scripts/ats-workbench.test.js
npm run test:api
```

Expected: source intelligence tests pass and public API behavior remains unchanged.

---

### Task 5: Add Sentry And Cloudflare Readiness Docs

**Files:**
- Create: `docs/reference/sentry-2.0-readiness.md`
- Create: `docs/reference/cloudflare-waf-2.0-checklist.md`
- Test: manual review and credential check

- [ ] **Step 1: Add Sentry readiness doc**

Create `docs/reference/sentry-2.0-readiness.md`:

```markdown
# Sentry 2.0 Readiness

Required local environment:
- SENTRY_AUTH_TOKEN
- SENTRY_ORG
- SENTRY_PROJECT

Frontend checkpoints:
- Search load failures include route, query length, and filter count.
- Card action failures include action type and safe posting identifier hash.
- No full posting URL or personal data is sent as raw error context.

Backend checkpoints:
- Admin diagnostic failures are captured without leaking admin tokens.
- ATS fetch failures group by source key and sanitized host.
- Canary/apply jobs include mode, source key, and result counts.

Release gate:
- Run the Sentry issue scan when credentials are present.
- Document top unresolved production errors before 2.0 deployment.
```

- [ ] **Step 2: Add Cloudflare WAF checklist**

Create `docs/reference/cloudflare-waf-2.0-checklist.md`:

```markdown
# Cloudflare WAF 2.0 Checklist

Before deployment, verify:
- Admin diagnostics require the app admin token and are not cached.
- Mutation endpoints have rate limits.
- Search suggestions have bot/rate protection.
- Static web assets may be cached, API responses may not be cached broadly.
- Security headers include HSTS, X-Content-Type-Options, Referrer-Policy, and a reviewed CSP.
- WAF events are checked for blocked admin, sync, and ingestion traffic.
```

- [ ] **Step 3: Run credential presence check**

Run:

```powershell
@("SENTRY_AUTH_TOKEN","SENTRY_ORG","SENTRY_PROJECT") | ForEach-Object { "$_=$([bool]$env:$_)" }
```

Expected: each line reports whether the value is configured without printing secrets.

---

### Task 6: Release Gate

**Files:**
- Modify: `docs/PROJECT_STATE.md`
- Test: `npm run test:backend`, `npm run test:api`, `npm run build:web`, `npm run quality:gate`

- [ ] **Step 1: Record the 2.0 demo and backend readiness state**

Add a new dated section to `docs/PROJECT_STATE.md`:

```markdown
## 2026-05-17 - OpenJobSlots 2.0 Demo Readiness

- Public 2.0 redesign is demo-first and not deployed.
- Public cards must not expose detailed diagnostics.
- ATS source intelligence remains read-only until reviewed.
- Sentry live scan requires local credentials.
- Cloudflare/WAF review is required before deployment.
```

- [ ] **Step 2: Run final checks**

Run:

```powershell
npm run test:backend
npm run test:api
npm run build:web
npm run quality:gate
```

Expected: all commands pass before any release or deploy step.

- [ ] **Step 3: Commit release readiness**

```powershell
git add App.js src/api.js server/index.js scripts/ats-workbench.js scripts/ats-workbench.test.js tests/e2e/postings.spec.js tests/api/core-api.test.js docs/reference/sentry-2.0-readiness.md docs/reference/cloudflare-waf-2.0-checklist.md docs/PROJECT_STATE.md
git commit -m "feat: prepare openjobslots 2.0 redesign and ats intelligence"
```

---

## Self-Review

- Spec coverage: The plan covers local demos, public redesign, animated cards, public diagnostics separation, ATS intelligence, Sentry readiness, Cloudflare readiness, and release checks.
- Placeholder scan: No task uses TBD, TODO, or unspecified implementation steps.
- Type consistency: The ATS intelligence fields use `snake_case` to match the backend/reporting style already present in the project.
