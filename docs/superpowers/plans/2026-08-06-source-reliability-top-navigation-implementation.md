# Source Reliability and Top Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate false source-error states, expand the registry from 24 to 29 verified Taiwan media sources, and replace the desktop sidebar/bottom mobile tabs with an Apple-like top navigation.

**Architecture:** Python owns authoritative feed validation and the public Pages snapshot; valid empty feeds are healthy while malformed or unusable data remains an error. Worker scheduled snapshots combine direct official RSS results with Pages source-health evidence. React renders one horizontal desktop navigation and a compact top navigation at 1100px and below, with the existing accessible sheet behavior preserved.

**Tech Stack:** Python 3.12+, feedparser, requests, PyYAML, Cloudflare Worker JavaScript, React 18, React Router 6, TypeScript, Vitest, Testing Library, Vite 8, CSS.

## Global Constraints

- Keep the zero-cost GitHub Pages + Cloudflare Worker architecture.
- Store and render public metadata only; never fetch or retain protected full article bodies.
- New sources are exactly `rti`, `technews`, `taipeitimes`, `coolloud`, and `tfc`, for 29 total registered sources.
- A recognizable RSS/Atom document with zero entries is healthy; HTTP, connection, malformed document, or entries with no usable title/link/time remain errors.
- Desktop navigation is horizontal at the top; 1100px and below use the top compact navigation and complete nine-route sheet.
- Preserve 44px targets, focus trapping, Escape close, background inert state, focus restoration, reduced motion, light/dark themes, and no horizontal document overflow.

---

### Task 1: Distinguish an empty feed from a failed feed

**Files:**
- Modify: `src/opinion_pipeline/connectors/rss.py`
- Modify: `src/opinion_pipeline/connectors/google_news.py`
- Test: `tests/test_google_news.py`
- Test: `tests/test_sources.py`

**Interfaces:**
- Produces: `is_feed_document(parsed: dict) -> bool`, shared by RSS and Google News parsing.
- Behavior: valid empty documents return `SourceResult(ok=True, items=[])`; documents containing unusable entries return `NO_VALID_ITEMS`.

- [ ] **Step 1: Write failing valid-empty and malformed-feed tests**

```python
def test_valid_empty_google_news_feed_is_healthy():
    raw = b'<?xml version="1.0"?><rss version="2.0"><channel><title>empty</title></channel></rss>'
    result = parse_google_news(raw, SOURCE, 10)
    assert result.ok is True
    assert result.items == []

def test_non_feed_document_remains_an_error():
    result = parse_google_news(b'<html>blocked</html>', SOURCE, 10)
    assert result.ok is False
    assert result.error_code == 'EMPTY_OR_BAD_FEED'
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `python -X utf8 -m pytest tests/test_google_news.py -q`

Expected: the valid-empty test fails because current code returns `EMPTY_OR_BAD_FEED`.

- [ ] **Step 3: Implement document recognition and empty-feed health**

```python
def is_feed_document(parsed: dict) -> bool:
    return bool(parsed.get('version')) and isinstance(parsed.get('feed'), dict)

parsed = feedparser.parse(raw)
entries = parsed.get('entries') or []
if not entries:
    if is_feed_document(parsed):
        return SourceResult(id=sid, name=name, enabled=True, ok=True)
    return SourceResult(id=sid, name=name, enabled=True, ok=False, error_code='EMPTY_OR_BAD_FEED')
```

Apply the same distinction in `fetch_source`: record whether at least one valid empty feed was seen; only return healthy-empty if there were no unusable entries and no valid items.

- [ ] **Step 4: Verify focused and full Python tests**

Run: `python -X utf8 -m pytest tests/test_google_news.py tests/test_sources.py -q`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/opinion_pipeline/connectors/rss.py src/opinion_pipeline/connectors/google_news.py tests/test_google_news.py tests/test_sources.py
git commit -m "fix: distinguish empty feeds from source failures"
```

---

### Task 2: Add five verified Taiwan media sources

**Files:**
- Modify: `config/sources.yml`
- Modify: `tests/test_sources.py`
- Modify: `worker/src/sources.js`
- Modify: `worker/test/core.test.js`
- Modify: `web/src/types/contracts.ts`
- Modify: `web/src/lib/sources.ts`
- Modify: `web/src/lib/sources.test.ts`

**Interfaces:**
- Produces: the same ordered 29-source registry in Python, Worker, and Web.
- New official RSS URLs are fixed by the design specification and are not guessed at runtime.

- [ ] **Step 1: Change registry tests to require 29 sources and the five exact IDs**

```python
EXPECTED_SOURCE_IDS = (*EXISTING_SOURCE_IDS, 'rti', 'technews', 'taipeitimes', 'coolloud', 'tfc')

def test_new_taiwan_rss_sources_are_enabled():
    sources = {source['id']: source for source in load_sources(Path('config/sources.yml'))}
    assert sources['rti']['rss_url'] == 'https://www.rti.org.tw/rss'
    assert sources['technews']['rss_url'] == 'https://technews.tw/feed/'
    assert sources['taipeitimes']['rss_url'] == 'https://www.taipeitimes.com/xml/index.rss'
    assert sources['coolloud']['rss_url'] == 'https://www.coolloud.org.tw/rss.xml'
    assert sources['tfc']['rss_url'] == 'https://tfc-taiwan.org.tw/feed/'
```

Update Worker and Web tests to assert the same ordered IDs and total `29`.

- [ ] **Step 2: Run registry tests and confirm RED**

Run: `python -X utf8 -m pytest tests/test_sources.py -q; npm.cmd test -- --test-name-pattern "source registry"`

Expected: failures show the five missing IDs.

- [ ] **Step 3: Add exact YAML, Worker, contract, and display entries**

Each new source receives official domains, aliases, its verified `rss_url`, and disabled listing crawl. Web metadata uses stable series slots and short labels: `央廣`, `科技新報`, `北時`, `苦勞網`, `事實查核`.

- [ ] **Step 4: Verify parsers against the five live feeds**

Run a read-only connector check using `fetch_source(source, timeout=8, max_items=10)` for all five configured sources.

Expected: HTTP parsing succeeds, `ok=True`, at least one item per source, and no invalid-time drops.

- [ ] **Step 5: Run all registry tests and commit**

Run: `python -X utf8 -m pytest tests/test_sources.py -q; npm.cmd test` in `worker`; `npm.cmd test -- --run src/lib/sources.test.ts` in `web`.

```powershell
git add config/sources.yml tests/test_sources.py worker/src/sources.js worker/test/core.test.js web/src/types/contracts.ts web/src/lib/sources.ts web/src/lib/sources.test.ts
git commit -m "feat: add five verified Taiwan news sources"
```

---

### Task 3: Make Worker trust Pages source-health evidence

**Files:**
- Modify: `worker/src/index.js`
- Test: `worker/test/routes.test.js`

**Interfaces:**
- Produces: `pagesSourceStates(env) -> Promise<Map<string, SourceHealth>>`.
- Consumes: Pages `/data/sources.json` and `run.viaPages` from `fetchSourceItems`.

- [ ] **Step 1: Write a failing scheduled-snapshot test**

Create a Pages fixture where source `era` has `status: 'ok'`, `itemCount: 0`, and no recent articles. Trigger `scheduled()` and assert Worker `/api/data?name=sources` reports `era.status === 'ok'`, `stale === false`, and `itemCount === 0`. Add a second fixture with Pages `era.status === 'error'` and assert Worker remains `error` when no recent data exists.

- [ ] **Step 2: Run focused Worker tests and confirm RED**

Run: `npm.cmd test -- --test-name-pattern "Pages source health"`

Expected: current Worker reports `error` for the healthy zero-item Pages source.

- [ ] **Step 3: Implement Pages source-state loading**

```js
async function pagesSourceStates(env) {
  const base = env.ARCHIVE_BASE_URL || 'https://chunyu8866.github.io/MediaMonitoringDB';
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/data/sources.json`);
    if (!response.ok) return new Map();
    const body = await response.json();
    return new Map((body?.data?.sources || []).map((source) => [source.id, source]));
  } catch {
    return new Map();
  }
}
```

In `buildSnapshot`, load this map alongside Pages analysis. For `run.viaPages`, treat Pages `status === 'ok'` and `stale !== true` as healthy even when `hasRecent` is false. Preserve Pages `lastSuccessAt`, `errorCode`, and access mode when they are the evidence source.

- [ ] **Step 4: Run all Worker tests and commit**

Run: `npm.cmd test`

Expected: all Worker tests pass, including healthy-empty and true-error cases.

```powershell
git add worker/src/index.js worker/test/routes.test.js
git commit -m "fix: preserve Pages source health in Worker snapshots"
```

---

### Task 4: Replace the sidebar with Apple-like top navigation

**Files:**
- Create: `web/src/components/TopNavigation.tsx`
- Create: `web/src/components/TopNavigation.test.tsx`
- Modify: `web/src/components/Layout.tsx`
- Modify: `web/src/components/Layout.test.tsx`
- Modify: `web/src/components/MobileNavigation.tsx`
- Modify: `web/src/components/MobileNavigation.test.tsx`
- Modify: `web/src/index.css`
- Modify: `web/src/styles/apple.css`
- Modify: `web/test/route-smoke.test.tsx`

**Interfaces:**
- `TopNavigation({ groups, home })` renders all nine routes in a `nav[aria-label="主導覽"]`.
- `MobileNavigation` remains the accessible four-control compact navigation but is styled at the top and uses the 1100px media boundary.

- [ ] **Step 1: Write failing navigation structure tests**

```tsx
expect(screen.getByRole('navigation', { name: '主導覽' })).toBeInTheDocument();
expect(within(screen.getByRole('navigation', { name: '主導覽' })).getAllByRole('link')).toHaveLength(9);
expect(container.querySelector('aside.sidebar')).not.toBeInTheDocument();
```

Add compact-navigation tests for `(max-width: 1100px)` and assert its navigation precedes `<main>` in document order. Retain the nine-route sheet, focus, Escape, inert, and viewport-exit tests.

- [ ] **Step 2: Run focused Web tests and confirm RED**

Run: `npm.cmd test -- --run src/components/Layout.test.tsx src/components/MobileNavigation.test.tsx src/components/TopNavigation.test.tsx`

Expected: missing `TopNavigation`, sidebar still present, and the old 860px boundary fail.

- [ ] **Step 3: Implement TopNavigation and remove the sidebar**

Flatten `[home, ...groups.flatMap(group => group.items)]` and render compact `NavLink` elements with active state and icons. Mount it between brand and utility controls in `.appbar`; remove `NavLinkItem`, `<aside>`, and sidebar groups. Keep `<main>` inside `.layout`.

- [ ] **Step 4: Move compact navigation to the top**

Change the media query listener to `(max-width: 1100px)`. Override `.mobile-tabbar` to be sticky below the appbar, full-width or centered, with no bottom inset. Position `.mobile-sheet` below both top rows and animate from the top. Remove content bottom padding reserved for the old bottom navigation.

- [ ] **Step 5: Implement responsive CSS**

Desktop `.layout` becomes one column; `.content` remains centered with `max-width: 1480px`. `.topnav__link` has a 44px minimum target, compact typography, hover material, and active accent pill. Hide `.topnav` at 1100px and show `.mobile-tabbar`; at larger widths do the reverse. Preserve dark mode and reduced motion.

- [ ] **Step 6: Run focused Web tests and commit**

Run: `npm.cmd test -- --run src/components/TopNavigation.test.tsx src/components/Layout.test.tsx src/components/MobileNavigation.test.tsx web/test/route-smoke.test.tsx; npm.cmd run typecheck`

```powershell
git add web/src/components/TopNavigation.tsx web/src/components/TopNavigation.test.tsx web/src/components/Layout.tsx web/src/components/Layout.test.tsx web/src/components/MobileNavigation.tsx web/src/components/MobileNavigation.test.tsx web/src/index.css web/src/styles/apple.css web/test/route-smoke.test.tsx
git commit -m "feat: move global navigation to the top"
```

---

### Task 5: Full verification, review, release, and live audit

**Files:**
- Modify if required by verified failures only: files from Tasks 1–4

**Interfaces:**
- Deployment target: `main` -> GitHub Pages and existing Cloudflare Worker refresh path.

- [ ] **Step 1: Run complete automated verification**

Run in parallel where safe:

```powershell
python -X utf8 -m pytest -q
Set-Location worker; npm.cmd test
Set-Location web; npm.cmd test -- --maxWorkers=4; npm.cmd run typecheck; npm.cmd run build
```

Expected: zero failures; only previously recorded localstorage, ECharts chunk, and npm audit warnings may remain.

- [ ] **Step 2: Run source-health integration evidence**

Execute the Python pipeline against a temporary output directory with the production Pages restore URL. Assert all 29 source records exist, no valid-empty source is marked error, and each new source appears in `sources.json` with `accessMode=official-rss`.

- [ ] **Step 3: Browser QA all routes**

Run the production preview and verify all nine routes at 1440×900, 1024×768, and 390×844: one main/h1, no document overflow, desktop top navigation/no sidebar at 1440, compact top navigation at 1024/390, all nine sheet routes, focus trap, Escape restore, theme, and reduced-motion-compatible behavior.

- [ ] **Step 4: Request code review and resolve findings**

Review the branch against the pre-change `main` SHA. Any blocker receives a failing regression test before implementation.

- [ ] **Step 5: Merge and publish**

Fast-forward `main`, push, monitor `deploy-web.yml`, inspect failed logs if needed, and wait for a successful Pages deployment.

- [ ] **Step 6: Live verification**

Verify the deployed asset hash, desktop/mobile navigation, Pages `sources.json`, Worker `/api/health`, CORS preflight, and Worker `/api/data?name=sources`. Confirm the latest deployment SHA equals the pushed main SHA before declaring completion.
