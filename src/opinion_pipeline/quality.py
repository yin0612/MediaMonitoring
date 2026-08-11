"""Transparent, recomputable source-quality measurements."""
from __future__ import annotations

from datetime import datetime, timezone


ACCESS_SCORE = {"official-rss": 1.0, "site-listing": 0.75, "google-news": 0.6}
WEIGHTS = {"availability": 0.3, "freshness": 0.3, "excerpt": 0.25, "access": 0.15}


def assess_source_quality(
    transport_ok: bool,
    items: list,
    access_mode: str,
    now: datetime,
    *,
    latency_ms: int,
) -> dict:
    newest = max((item.published_at for item in items), default=None)
    age_hours = max(0.0, (now - newest).total_seconds() / 3600) if newest else None
    freshness = max(0.0, 1.0 - age_hours / 24) if age_hours is not None else 0.0
    excerpt_rate = sum(bool(item.excerpt.strip()) for item in items) / len(items) if items else 0.0
    components = {
        "availability": 1.0 if transport_ok else 0.0,
        "freshness": round(freshness, 3),
        "excerpt": round(excerpt_rate, 3),
        "access": ACCESS_SCORE.get(access_mode, 0.5),
    }
    quality_score = round(sum(components[key] * WEIGHTS[key] for key in WEIGHTS), 3)
    fallback = access_mode != "official-rss"
    if not transport_ok:
        status = "error"
    elif not items:
        status = "empty"
    elif fallback or excerpt_rate < 0.6 or (age_hours is not None and age_hours > 6):
        status = "degraded"
    else:
        status = "ok"
    return {
        "status": status,
        "windowHours": 24,
        "newestItemAt": newest.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if newest else None,
        "transportOk": transport_ok,
        "fallbackUsed": fallback,
        "officialItemCount": len(items) if access_mode == "official-rss" else 0,
        "fallbackItemCount": len(items) if fallback else 0,
        "excerptRate": round(excerpt_rate, 3),
        "latencyMs": max(0, int(latency_ms)),
        "qualityScore": quality_score,
        "qualityComponents": components,
    }
