# Local Annotation Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free local browser interface for reviewing the
benchmark JSONL, displaying optional machine suggestions, and downloading
reviewer-approved labels.

**Architecture:** `annotation-core.mjs` owns JSONL parsing, immutable row
updates, validation, and JSONL serialization. `app.js` owns browser state and
form behavior, while `index.html` provides the static local interface.

**Tech Stack:** Browser ES modules, Node.js built-in test runner, HTML/CSS.

## Global Constraints

- No data upload, Cloudflare binding, account, or dependency is introduced.
- Machine suggestions never mutate official `annotations` without a reviewer
  action.
- Existing 1,000-row candidate schema and 100 double-annotation rows remain
  compatible with `scripts/evaluate_annotations.py`.

---

### Task 1: Testable annotation core

**Files:**
- Create: `tools/annotation-app/annotation-core.test.mjs`
- Create: `tools/annotation-app/annotation-core.mjs`

- [ ] **Step 1: Write failing tests** for parsing candidate JSONL, updating
  consensus or reviewer labels without changing source metadata, refusing an
  automatic machine-suggestion write, and reporting missing labels.
- [ ] **Step 2: Run `node --test tools/annotation-app/annotation-core.test.mjs`**
  and confirm it fails because the core module is absent.
- [ ] **Step 3: Implement the smallest pure functions** needed by the tests:
  `parseJsonl`, `serializeJsonl`, `updateAnnotation`, `validateRows`, and
  `machineSuggestionFor`.
- [ ] **Step 4: Re-run the Node test** and confirm it passes.

### Task 2: Local browser annotator

**Files:**
- Create: `tools/annotation-app/index.html`
- Create: `tools/annotation-app/app.js`
- Create: `tools/annotation-app/styles.css`
- Create: `tools/annotation-app/README.md`

- [ ] **Step 1: Add a browser-level test or static contract test** asserting the
  page exposes candidate upload, optional suggestion upload, write mode,
  article controls, and JSONL download.
- [ ] **Step 2: Run the test** and confirm it fails because the static files are
  absent.
- [ ] **Step 3: Implement the static UI** using the tested core module. Persist
  only active browser-session state, clearly label machine output, and disable
  reviewer modes on non-double rows.
- [ ] **Step 4: Re-run static and Node tests** and confirm they pass.

### Task 3: Documentation and end-to-end validation

**Files:**
- Modify: `README.md`
- Modify: `benchmarks/ANNOTATION_GUIDE.md`

- [ ] **Step 1: Document exact Windows launch, import, review, export, and
  evaluator commands.**
- [ ] **Step 2: Run the Node tests, syntax checks, Python evaluator dry run,
  and the existing web typecheck/build.**
- [ ] **Step 3: Use a local browser check to load the 1,000-row candidate file,
  display a machine suggestion without mutating labels, save one reviewer
  action, and verify downloaded JSONL remains parseable.**
- [ ] **Step 4: Commit the design, implementation, tests, and documentation.**
