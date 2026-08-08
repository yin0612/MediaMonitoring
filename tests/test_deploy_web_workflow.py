from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-web.yml"
FULL_TEST_STEPS = {
    "Python 測試",
    "安裝 Worker 相依套件",
    "Worker 核心測試",
    "前端單元測試",
    "型別檢查",
}
FULL_TEST_CONDITION = (
    "github.event_name != 'schedule' && github.event_name != 'repository_dispatch'"
)


def load_workflow() -> dict:
    return yaml.load(WORKFLOW.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def test_workflow_has_dedicated_automated_refresh_event() -> None:
    workflow = load_workflow()

    assert not workflow["on"]["workflow_dispatch"]
    assert workflow["on"]["repository_dispatch"]["types"] == ["scheduled-refresh"]


def test_only_automated_refresh_skips_full_test_steps() -> None:
    workflow = load_workflow()
    steps = {
        step["name"]: step
        for step in workflow["jobs"]["build"]["steps"]
        if "name" in step
    }

    assert FULL_TEST_STEPS <= steps.keys()
    for name in FULL_TEST_STEPS:
        assert steps[name]["if"] == FULL_TEST_CONDITION
