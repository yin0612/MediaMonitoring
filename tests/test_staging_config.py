from pathlib import Path


STAGING = Path(__file__).parents[1] / "worker" / "wrangler.staging.toml"
PRODUCTION = Path(__file__).parents[1] / "worker" / "wrangler.toml"


def test_staging_uses_distinct_worker_and_storage_bindings():
    staging = STAGING.read_text(encoding="utf-8")
    production = PRODUCTION.read_text(encoding="utf-8")

    assert 'name = "media-monitoring-staging"' in staging
    assert 'id = "23fe55b5eaaa4a6fac83258797fa46c7"' in staging
    assert 'database_id = "8a6301b6-a939-43d7-a562-69722074a8c1"' in staging
    assert 'id = "7f726665db69456aba1da52ddeeeb563"' not in staging
    assert 'database_id = "47b47466-faff-4533-a5b8-c8cef08108dd"' not in staging
    assert 'name = "media-monitoring-demo"' in production


def test_staging_has_its_own_snapshot_refresh_trigger():
    staging = STAGING.read_text(encoding="utf-8")

    assert "[triggers]" in staging
    assert 'crons = ["*/5 * * * *"]' in staging


def test_staging_documentation_records_unavailable_paid_dependencies():
    documentation = (Path(__file__).parents[1] / "docs" / "staging.md").read_text(encoding="utf-8")

    assert "R2" in documentation
    assert "R2 entitlement" in documentation
    assert "Turnstile" in documentation
