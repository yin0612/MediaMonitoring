# Remaining external release gates

The executable code and deployment checks are complete. These two gates need
an external action and are intentionally not replaced with guessed data.

## Cloudflare R2 entitlement

The active `shueisha0612` Cloudflare account currently returns API error 10042
from `wrangler r2 bucket list` and asks for R2 to be enabled in the Cloudflare
Dashboard. The production Worker therefore keeps the R2 binding optional and
does not claim immutable R2 archival is active. Enabling R2 can change billing
or account entitlements, so it must be done by the account owner first.

## Human annotation labels

The deterministic machine draft is present at
`benchmarks/annotation-machine-draft.jsonl` and contains 1,000 rows. The
evaluator currently reports `status=insufficient_labels`,
`humanLabelRows=0`, and `missingHumanLabels=1000`; all agreement/F1 metrics are
therefore `null`. A reviewer must label the provided annotation template before
the requested Cohen's kappa and macro-F1 gates can be computed.

Until both gates are supplied, production responses continue to expose
coverage/quality/provenance and the UI must not describe the system as having
complete R2 archival or human-validated model performance.
