# Apple-Style Opinion Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn MediaMonitoring into an Apple-style opinion decision workspace that surfaces actionable daily signals, exposes every route on mobile, teaches advanced analysis, and preserves all existing data/API contracts.

**Architecture:** Keep the Python pipeline, Worker, public JSON envelopes, routing, and fallback paths unchanged. Add pure TypeScript view-model modules for decision insights and presets, small React presentation components for the new workflows, and a single Apple visual-system stylesheet layered over the existing route-specific layout rules.

**Tech Stack:** React 18, TypeScript 5.6, React Router 6, Vitest 4, Testing Library, ECharts 6, CSS custom properties, Vite 8.

## Global Constraints

- Preserve `{ schemaVersion, generatedAt, data }`, `stale`, `experimental`, Worker fallback, and every existing API route.
- Do not add authentication, cookies, server writes, a database, or new runtime dependencies.
- All new production behavior follows RED → GREEN → REFACTOR.
- Structural icons use the local SVG `Icon` family; user-facing React views contain no hardcoded emoji.
- Mobile primary content has no horizontal overflow; touch controls are at least 44×44 CSS px.
- Support light, dark, system, focus-visible, and `prefers-reduced-motion` states.
- Keep all nine routes and their existing analytical meaning.

---

### Task 1: Daily Decision Brief

**Files:**
- Create: `web/src/lib/decisionBrief.test.ts`
- Create: `web/src/lib/decisionBrief.ts`
- Create: `web/src/components/DecisionBrief.test.tsx`
- Create: `web/src/components/DecisionBrief.tsx`
- Modify: `web/src/pages/HomePage.test.tsx`
- Modify: `web/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `HomeInputs`, `HomeSnapshot`, `getRisingKeywords`, and existing `/keywords`, `/topics`, `/recent`, `/sources`, `/meta` snapshots.
- Produces: `DecisionBriefModel`, `DecisionSignal`, and `buildDecisionBrief(input: HomeInputs, generatedAt?: string | null): DecisionBriefModel`.

- [x] **Step 1: Write failing pure-function tests**

Create fixtures that prove these exact behaviors:

```ts
expect(buildDecisionBrief(input, now)).toMatchObject({
  confidence: 'good',
  headline: '台積電正在升溫',
  primaryAction: { to: '/keywords', label: '查看關鍵字趨勢' },
});
expect(result.signals.map((signal) => signal.kind)).toEqual(['momentum', 'topic', 'coverage']);
```

Also cover no rising term, stale keywords/topics, zero sources, and all-empty data without throwing.

- [x] **Step 2: Verify RED**

Run: `npm test -- src/lib/decisionBrief.test.ts`

Expected: FAIL because `./decisionBrief` does not exist.

- [x] **Step 3: Implement the pure view model**

Define:

```ts
export type DecisionConfidence = 'good' | 'attention' | 'limited';
export type DecisionSignalKind = 'momentum' | 'topic' | 'coverage';

export interface DecisionSignal {
  kind: DecisionSignalKind;
  label: string;
  value: string;
  detail: string;
  to: string;
}

export interface DecisionBriefModel {
  eyebrow: string;
  headline: string;
  summary: string;
  confidence: DecisionConfidence;
  signals: DecisionSignal[];
  primaryAction: { to: string; label: string };
}
```

Use `getRisingKeywords` for the latest 90-minute comparison, cap signals at three, avoid division by zero, and use limited wording when any deep dataset is stale.

- [x] **Step 4: Verify GREEN for the pure function**

Run: `npm test -- src/lib/decisionBrief.test.ts`

Expected: all decision-brief tests PASS.

- [x] **Step 5: Write failing component and page tests**

Assert that `DecisionBrief` renders a named region, heading, confidence text, three signal links, and the primary action. Update `HomePage.test.tsx` to require the new brief before the legacy metric grid and to reject the old static hero title.

- [x] **Step 6: Verify component RED**

Run: `npm test -- src/components/DecisionBrief.test.tsx src/pages/HomePage.test.tsx`

Expected: FAIL because the component and new home structure do not exist.

- [x] **Step 7: Implement the component and integrate HomePage**

`DecisionBrief` receives only `model: DecisionBriefModel`. `HomePage` constructs one input object, calls `buildHomeSnapshot` and `buildDecisionBrief`, removes the always-large static hero and low-severity source banner, and keeps severe restore/error banners.

- [x] **Step 8: Verify GREEN and refactor**

Run: `npm test -- src/lib/decisionBrief.test.ts src/components/DecisionBrief.test.tsx src/pages/HomePage.test.tsx src/lib/home.test.ts`

Expected: all listed files PASS.

- [x] **Step 9: Commit**

```powershell
git add web/src/lib/decisionBrief.ts web/src/lib/decisionBrief.test.ts web/src/components/DecisionBrief.tsx web/src/components/DecisionBrief.test.tsx web/src/pages/HomePage.tsx web/src/pages/HomePage.test.tsx
git commit -m "feat: add daily opinion decision brief"
```

### Task 2: Complete Mobile Navigation

**Files:**
- Create: `web/src/components/MobileNavigation.test.tsx`
- Create: `web/src/components/MobileNavigation.tsx`
- Modify: `web/src/components/Layout.test.tsx`
- Modify: `web/src/components/Layout.tsx`
- Modify: `web/src/components/Icon.tsx`

**Interfaces:**
- Consumes: exported `NavGroup[]` and `NavItem` definitions from `Layout.tsx`.
- Produces: `MobileNavigation({ groups, home }: { groups: NavGroup[]; home: NavItem }): JSX.Element`.

- [x] **Step 1: Write failing navigation tests**

Tests require exactly four primary controls named `首頁`, `搜尋`, `總覽`, `更多`; opening `更多` exposes a dialog named `所有功能`, all nine route labels, and a `關閉功能選單` button; Escape and selecting `/topics` close the dialog.

- [x] **Step 2: Verify RED**

Run: `npm test -- src/components/MobileNavigation.test.tsx src/components/Layout.test.tsx`

Expected: FAIL because `MobileNavigation` and the `更多` dialog do not exist.

- [x] **Step 3: Implement navigation behavior**

Use React state, `role="dialog"`, `aria-modal="true"`, a backdrop button, `useEffect` for Escape/body scroll lock, and `NavLink` for route state. Add `menu`, `close`, `home`, and `chevronRight` paths to `IconName`.

- [x] **Step 4: Integrate Layout**

Export `NavItem` and `NavGroup`; replace the horizontal group-first mobile nav with `<MobileNavigation groups={NAV_GROUPS} home={HOME_NAV} />`. Keep desktop navigation unchanged. Use a single compact system-status label in the app bar.

- [x] **Step 5: Verify GREEN and refactor**

Run: `npm test -- src/components/MobileNavigation.test.tsx src/components/Layout.test.tsx src/main.test.tsx`

Expected: all listed tests PASS with no act warnings.

- [x] **Step 6: Commit**

```powershell
git add web/src/components/MobileNavigation.tsx web/src/components/MobileNavigation.test.tsx web/src/components/Layout.tsx web/src/components/Layout.test.tsx web/src/components/Icon.tsx
git commit -m "feat: expose every route in mobile navigation"
```

### Task 3: Advanced Analysis Launcher

**Files:**
- Create: `web/src/lib/analysisPresets.test.ts`
- Create: `web/src/lib/analysisPresets.ts`
- Create: `web/src/components/AnalysisLauncher.test.tsx`
- Create: `web/src/components/AnalysisLauncher.tsx`
- Create: `web/src/pages/AdvancedAnalysisPage.test.tsx`
- Modify: `web/src/pages/AdvancedAnalysisPage.tsx`

**Interfaces:**
- Produces: `AnalysisPreset`, `ANALYSIS_PRESETS`, and `cloneAnalysisPreset(preset): { topics: TopicInput[]; range: SearchRange }`.
- `AnalysisLauncher` accepts `onApply(topics: TopicInput[], range: SearchRange): void`.

- [x] **Step 1: Write failing preset tests**

Require preset ids `brand-compare`, `policy-monitor`, `noise-filter`; each has 1–3 topics, non-empty names/queries, and a valid `SearchRange`. Mutating the cloned topics must not change `ANALYSIS_PRESETS`.

- [x] **Step 2: Verify RED**

Run: `npm test -- src/lib/analysisPresets.test.ts`

Expected: FAIL because the preset module does not exist.

- [x] **Step 3: Implement immutable presets**

Use `as const satisfies readonly AnalysisPreset[]`; clone with `.map(topic => ({ ...topic }))`.

- [x] **Step 4: Write failing launcher/page tests**

Require three preset buttons, visible syntax tokens `AND`, `OR`, `NOT`, `-排除詞`, `"精準詞"`, and prove clicking `品牌比較` fills the form without calling `searchNews`.

- [x] **Step 5: Verify component RED**

Run: `npm test -- src/components/AnalysisLauncher.test.tsx src/pages/AdvancedAnalysisPage.test.tsx`

Expected: FAIL because launcher UI is missing.

- [x] **Step 6: Implement and integrate**

Render launcher between `PageHeader` and the comparison form. Applying a preset replaces topics/range, clears prior results and form errors, and never submits automatically.

- [x] **Step 7: Verify GREEN and refactor**

Run: `npm test -- src/lib/analysisPresets.test.ts src/components/AnalysisLauncher.test.tsx src/pages/AdvancedAnalysisPage.test.tsx src/lib/analysis.test.ts`

Expected: all listed tests PASS.

- [x] **Step 8: Commit**

```powershell
git add web/src/lib/analysisPresets.ts web/src/lib/analysisPresets.test.ts web/src/components/AnalysisLauncher.tsx web/src/components/AnalysisLauncher.test.tsx web/src/pages/AdvancedAnalysisPage.tsx web/src/pages/AdvancedAnalysisPage.test.tsx
git commit -m "feat: add guided advanced-analysis presets"
```

### Task 4: Unified Icon and State System

**Files:**
- Modify: `web/src/copyPolicy.test.ts`
- Modify: `web/src/components/ui.test.tsx`
- Modify: `web/src/components/ui.tsx`
- Modify: `web/src/components/Icon.tsx`
- Modify: `web/src/pages/HomePage.tsx`
- Modify: `web/src/pages/OverviewPage.tsx`
- Modify: `web/src/pages/EntitiesPage.tsx`
- Modify: `web/src/pages/KeywordsPage.tsx`
- Modify: `web/src/pages/TopicsPage.tsx`
- Modify: `web/src/pages/MethodPage.tsx`

**Interfaces:**
- `StatTile.icon`, `Banner.icon`, and `EmptyState.icon` become `IconName` values.
- `Card` adds optional `tone?: 'default' | 'elevated' | 'subtle'` with `default` fallback.

- [x] **Step 1: Write failing policy and component tests**

Extend raw-view policy with a Unicode pictograph scan:

```ts
const pictograph = /\p{Extended_Pictographic}/u;
expect(offenders).toEqual([]);
```

Exclude test files only. Add component assertions that state visuals contain local `svg[aria-hidden="true"]` and that `tone="subtle"` yields `card--subtle`.

- [x] **Step 2: Verify RED**

Run: `npm test -- src/copyPolicy.test.ts src/components/ui.test.tsx`

Expected: FAIL listing the current emoji-bearing React views and missing tone class.

- [x] **Step 3: Expand the SVG family and migrate callers**

Add `alert`, `archive`, `checkCircle`, `experiment`, `info`, `inbox`, `message`, `shield`, `trendUp`, and `warning`. Replace every emoji found by the policy scan with the nearest semantic `IconName`. Method limitation cards use `Icon` directly.

- [x] **Step 4: Implement Card tone and state icons**

Render `<Icon name={iconName} />` inside `StatTile`, `Banner`, `ErrorState`, and `EmptyState`. Preserve accessible text; icons remain decorative.

- [x] **Step 5: Verify GREEN**

Run: `npm test -- src/copyPolicy.test.ts src/components/ui.test.tsx src/pages/HomePage.test.tsx src/pages/OverviewPage.test.tsx`

Expected: all listed tests PASS and the policy offender list is empty.

- [x] **Step 6: Commit**

```powershell
git add web/src/copyPolicy.test.ts web/src/components/ui.tsx web/src/components/ui.test.tsx web/src/components/Icon.tsx web/src/pages/HomePage.tsx web/src/pages/OverviewPage.tsx web/src/pages/EntitiesPage.tsx web/src/pages/KeywordsPage.tsx web/src/pages/TopicsPage.tsx web/src/pages/MethodPage.tsx
git commit -m "refactor: unify interface icons and states"
```

### Task 5: Apple Visual System and Responsive Acceptance

**Files:**
- Create: `web/src/styles/apple.css`
- Modify: `web/src/index.css`
- Modify: `web/src/main.tsx`
- Modify: `web/test/route-smoke.test.tsx`
- Modify: `web/src/components/PageHeader.tsx`
- Modify: `web/index.html`

**Interfaces:**
- CSS continues to expose existing chart tokens: `--text-primary`, `--text-secondary`, `--grid`, `--baseline`, `--surface-1`, `--accent`, `--series-1` through `--series-8`, and sentiment tokens.

- [x] **Step 1: Write failing route-structure checks**

Add smoke assertions that every route renders one `main`, one `h1`, and no legacy `.mobile-nav` horizontal strip. Require the home route to contain `.decision-brief` and analysis route to contain `.analysis-launcher`.

- [x] **Step 2: Verify RED**

Run: `npm test -- ../web/test/route-smoke.test.tsx`

Expected: FAIL on missing new shell classes before styling integration.

- [x] **Step 3: Create the Apple token layer**

`apple.css` defines:

```css
:root {
  --page: #f5f5f7;
  --surface-1: rgba(255, 255, 255, 0.82);
  --surface-2: #ffffff;
  --text-primary: #1d1d1f;
  --text-secondary: #6e6e73;
  --accent: #0071e3;
  --radius-sm: 12px;
  --radius: 18px;
  --radius-lg: 28px;
  --focus-ring: 0 0 0 4px color-mix(in srgb, var(--accent) 24%, transparent);
  --shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 40px rgba(0,0,0,.08);
}
```

Add dark equivalents, translucent shell materials, 44px controls, decision brief layout, mobile bottom tab bar/sheet, refined cards, inputs, tables, charts, focus-visible, reduced motion, and 390/768/1024 breakpoints. Do not override series semantics.

- [x] **Step 4: Integrate styles and metadata**

Import `./styles/apple.css` after `./index.css` in `main.tsx`. Update title/theme-color metadata in `web/index.html`. Keep route-specific CSS in `index.css`; remove only directly conflicting legacy mobile-nav rules after confirming tests.

- [x] **Step 5: Verify route tests, typecheck, and build**

Run:

```powershell
npm test -- ../web/test/route-smoke.test.tsx
npm run typecheck
npm run build
```

Expected: route smoke PASS, TypeScript exit 0, Vite build exit 0. Existing ECharts size warning may remain but no new warning is accepted.

- [x] **Step 6: Commit**

```powershell
git add web/src/styles/apple.css web/src/index.css web/src/main.tsx web/test/route-smoke.test.tsx web/src/components/PageHeader.tsx web/index.html
git commit -m "feat: apply Apple-style responsive visual system"
```

### Task 6: Completion Audit, Browser QA, and Release

**Files:**
- Modify: `docs/superpowers/plans/2026-08-06-apple-command-center-implementation.md` checkboxes only
- Update generated assets only when existing project workflows require them.

**Interfaces:**
- No new product interface; this task proves the specification.

- [x] **Step 1: Run complete local verification**

```powershell
$env:PYTHONIOENCODING='utf-8'
python -X utf8 -m pytest -q
Set-Location worker
npm test
Set-Location ..\web
npm test
npm run typecheck
npm run build
```

Expected: 0 failures. Record exact counts and distinguish pre-existing audit/chunk warnings from failures.

- [x] **Step 2: Audit source acceptance conditions**

Run searches proving: no user-facing GitHub URLs/icons, no `<br>`, no hardcoded structural emoji, all nine routes still registered, new decision/preset/mobile components present, and no `.openai/hosting.json` was introduced.

- [x] **Step 3: Start the verified preview**

Run the existing Vite preview/dev script without changing the package manager or lockfile. Use the exact printed local URL.

- [x] **Step 4: Browser-check all routes at three viewports**

At 1440×900, 1024×768, and 390×844 verify document width, heading visibility, navigation reachability, focus controls, theme switching, the mobile sheet, and the first-view decision brief. Exercise analysis presets without submitting a network request.

- [x] **Step 5: Review diff and simplify**

Run `git diff --check`, inspect `git diff --stat` and the complete branch diff, remove duplicate CSS or dead components, then rerun affected Web tests and build.

- [x] **Step 6: Final commit**

```powershell
git add -A
git commit -m "test: verify Apple-style opinion command center"
```

Skip the commit if no tracked verification artifact changed.

- [ ] **Step 7: Integrate and publish**

Use the finishing-development workflow to merge the verified branch into `main`, push `main`, monitor the existing GitHub Pages workflow, and verify the production URL plus Worker health/CORS routes. Do not rotate or expose secrets.

- [ ] **Step 8: Completion evidence**

Record commit SHA, test counts, build result, viewport/route matrix, deployment run, production HTTP status, and any remaining non-blocking warnings before marking the active goal complete.
