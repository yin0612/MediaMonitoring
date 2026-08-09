# yin0612 Cloudflare Reconnection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the local MediaMonitoring commits to `yin0612/MediaMonitoring` and reconnect the Pages frontend to the Cloudflare Worker account that is currently manageable from this workstation.

**Architecture:** Reuse the existing `media-monitoring-demo` Worker, its `SNAPSHOT` KV namespace, Cron trigger, and secret bindings. Deploy the repository's current Worker code with `yin0612.github.io` CORS and archive settings, then point the GitHub Pages build variable at that verified endpoint before pushing `main`.

**Tech Stack:** Python 3.12/pytest, Node.js 22, Cloudflare Workers/Wrangler, KV, React/Vite/Vitest, GitHub Actions, GitHub Pages, GitHub CLI.

## Global Constraints

- Do not force-push or rewrite remote history.
- Do not modify unrelated application behavior.
- Do not update `VITE_API_BASE_URL` until the Worker health, CORS, and data endpoints pass live checks.
- Preserve the existing `GITHUB_TOKEN` secret unless a live refresh proves that it cannot dispatch `yin0612/MediaMonitoring`.
- Stop before publication if any full local verification command fails.

---

### Task 1: Reconnect the Worker KV binding

**Files:**
- Modify: `worker/wrangler.toml:17`

**Interfaces:**
- Consumes: existing Cloudflare namespace `7b3cce6f054f4918bf5a27dc5386a322` named `SNAPSHOT`
- Produces: a deployable `SNAPSHOT` binding for the currently authenticated Cloudflare account

- [ ] **Step 1: Record the failing configuration evidence**

Run `npx.cmd wrangler kv namespace list` in `worker/` and compare it with `worker/wrangler.toml`.

Expected before the edit: the account lists `7b3cce6f054f4918bf5a27dc5386a322`, while the file references `7f726665db69456aba1da52ddeeeb563`.

- [ ] **Step 2: Apply the minimal configuration change**

Replace only the namespace line with:

```toml
id = "7b3cce6f054f4918bf5a27dc5386a322"
```

- [ ] **Step 3: Validate the edited binding and Worker tests**

Run:

```powershell
npx.cmd wrangler kv namespace list
npm.cmd test
```

Expected: the configured ID exists in the account and all Worker tests pass.

- [ ] **Step 4: Commit the configuration**

```powershell
git add -- worker/wrangler.toml
git commit -m "fix: reconnect Worker to managed Cloudflare KV"
```

### Task 2: Run the full release gate

**Files:**
- Verify only; no intended file modifications

**Interfaces:**
- Consumes: committed application and Worker configuration
- Produces: fresh test, typecheck, and build evidence required before deployment

- [ ] **Step 1: Run Python tests**

```powershell
$env:PYTHONPATH='src'
python -X utf8 -m pytest -q
```

Expected: exit code 0 and zero failed tests.

- [ ] **Step 2: Run Worker tests**

```powershell
Set-Location worker
npm.cmd test
```

Expected: exit code 0 and zero failed tests.

- [ ] **Step 3: Run frontend tests and typecheck**

```powershell
Set-Location web
npm.cmd test -- --run
npm.cmd run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 4: Build both supported frontend modes**

Worker mode:

```powershell
$env:VITE_API_BASE_URL='https://media-monitoring-demo.chunyu8866-media-monitoring.workers.dev'
Remove-Item Env:ALLOW_STATIC_ONLY -ErrorAction SilentlyContinue
npm.cmd run build
```

Static fallback mode:

```powershell
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
$env:ALLOW_STATIC_ONLY='true'
npm.cmd run build
```

Expected: both builds exit 0.

### Task 3: Deploy and verify the Cloudflare Worker

**Files:**
- Deploy committed `worker/` sources and configuration

**Interfaces:**
- Consumes: Wrangler OAuth for the managed account and the existing `GITHUB_TOKEN` secret
- Produces: `https://media-monitoring-demo.chunyu8866-media-monitoring.workers.dev`

- [ ] **Step 1: Deploy the Worker**

```powershell
Set-Location worker
npm.cmd run deploy
```

Expected: Wrangler reports a successful deployment for `media-monitoring-demo` and the existing workers.dev URL.

- [ ] **Step 2: Verify bindings and secrets**

Run `npx.cmd wrangler deployments list`, inspect the newest version with `npx.cmd wrangler versions view <version-id> --json`, and run `npx.cmd wrangler secret list`.

Expected bindings:

```text
ALLOWED_ORIGIN=https://yin0612.github.io
ARCHIVE_BASE_URL=https://yin0612.github.io/MediaMonitoring
SNAPSHOT=7b3cce6f054f4918bf5a27dc5386a322
GITHUB_TOKEN=secret_text
```

- [ ] **Step 3: Verify live health, CORS, and data**

Use cache-busted `curl.exe` requests for `/api/health`, an OPTIONS request from `Origin: https://yin0612.github.io`, `/api/data?name=meta`, and `/api/search?q=台灣&range=24h`.

Expected: HTTP 200 for GETs, HTTP 204 for OPTIONS, exact `Access-Control-Allow-Origin: https://yin0612.github.io`, and structured JSON bodies.

### Task 4: Publish GitHub main and Pages

**Files:**
- Publish the commits already present on `fix/yin0612-cloudflare-reconnect`

**Interfaces:**
- Consumes: verified Worker URL and the local release branch
- Produces: updated `origin/main`, GitHub Actions deployments, and GitHub Pages assets

- [ ] **Step 1: Update the repository variable**

```powershell
gh variable set VITE_API_BASE_URL --repo yin0612/MediaMonitoring --body "https://media-monitoring-demo.chunyu8866-media-monitoring.workers.dev"
gh variable get VITE_API_BASE_URL --repo yin0612/MediaMonitoring
```

Expected: the returned value equals the verified Worker URL.

- [ ] **Step 2: Fast-forward local main**

```powershell
git switch main
git merge --ff-only fix/yin0612-cloudflare-reconnect
```

Expected: no merge commit and no conflicts.

- [ ] **Step 3: Push main without rewriting history**

```powershell
git push origin main
```

Expected: `origin/main` advances to the exact local `HEAD`.

- [ ] **Step 4: Monitor both push workflows**

Use `gh run list --repo yin0612/MediaMonitoring --commit <HEAD>` to identify CI and `Refresh data and deploy`; watch both with `gh run watch <id> --exit-status`.

Expected: both runs conclude `success`.

- [ ] **Step 5: Verify Pages deployment**

Poll `https://yin0612.github.io/MediaMonitoring/source-main-sha.txt` with a cache-busting query until it equals `<HEAD>`, then request the Pages root and public data files.

Expected: the source SHA matches and all required URLs return HTTP 200.

### Task 5: Exercise the real refresh path

**Files:**
- External runtime verification only

**Interfaces:**
- Consumes: deployed Worker, current Pages Origin, and current GitHub repository
- Produces: a fresh Worker snapshot and one GitHub deep-refresh dispatch

- [ ] **Step 1: Trigger one refresh**

POST once to `/api/refresh` with `Origin: https://yin0612.github.io`, record the returned `refreshId`, then poll `/api/refresh/status?id=<refreshId>`.

Expected: HTTP 202; `fast` completes and `deep` completes or returns a concrete authorization error.

- [ ] **Step 2: Repair the dispatch secret only if the live test proves it is invalid**

If deep refresh reports an authorization or repository-dispatch failure, pipe the current `gh auth token` directly into `npx.cmd wrangler secret put GITHUB_TOKEN`, verify the secret binding exists, and repeat one refresh after the cooldown expires or use the automated dispatch path if appropriate.

Expected: a new Actions run for `yin0612/MediaMonitoring` is visible and completes successfully.

- [ ] **Step 3: Run the final production audit**

Verify exact Git commit alignment, clean local status, successful GitHub workflows, Pages SHA, Worker health/CORS, source count, snapshot freshness, and the frontend's configured Worker URL.

Expected: every item is supported by fresh command or HTTP evidence; otherwise continue diagnosis without claiming completion.
