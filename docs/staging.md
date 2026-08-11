# Staging Worker

`worker/wrangler.staging.toml` is an isolated staging deployment for the
MediaMonitoring Worker.

- Worker name: `media-monitoring-staging`
- KV: `media-monitoring-staging-snapshot`
- D1: `media-monitoring-staging-archive`
- Allowed browser origin: `http://localhost:4173`
- Published Pages data is read-only input; production KV and D1 are not bound.

Apply the additive schema and deploy with:

```powershell
Set-Location worker
npx.cmd wrangler d1 migrations apply media-monitoring-staging-archive --remote --config wrangler.staging.toml
npx.cmd wrangler deploy --config wrangler.staging.toml
```

R2 is intentionally not included because this Cloudflare account has not
enabled the R2 entitlement. Turnstile secrets are also kept out of staging
until a staging hostname/site key exists; `/api/health` therefore reports that
dependency as degraded rather than claiming a complete staging environment.
