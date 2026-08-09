"""鎖住「新聞會持續自動更新」這條管線的組態約定。

這個檔案存在的理由是一次真實故障：資料更新 workflow 從 `deploy-web.yml`
改名為 `refresh-data.yml`，但 Worker 的 dispatch 目標與本檔的測試都沒跟上，
於是「立即更新」打到不存在的 workflow，而排程更新也整條停擺。
"""
import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
REFRESH_WORKFLOW = WORKFLOWS / "refresh-data.yml"
CI_WORKFLOW = WORKFLOWS / "ci.yml"
WORKER_ENTRY = ROOT / "worker" / "src" / "index.js"

# Worker 在手動更新與 Cron 時分別使用這兩種觸發方式，兩者都必須被 workflow 接受。
WORKER_DISPATCH_EVENT = "scheduled-refresh"


def load_workflow(path: Path) -> dict:
    return yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def test_refresh_workflow_accepts_every_trigger_the_worker_uses() -> None:
    workflow = load_workflow(REFRESH_WORKFLOW)
    triggers = workflow["on"]

    # 排程是備援，workflow_dispatch 是 Worker 手動更新的目標，
    # repository_dispatch 是 Worker Cron 的目標。缺一種就會有一條更新路徑失效。
    assert "schedule" in triggers
    assert "workflow_dispatch" in triggers
    assert WORKER_DISPATCH_EVENT in triggers["repository_dispatch"]["types"]

    # README 承諾「推送至 main」就會部署；沒有這個觸發條件，修好的前端要等
    # 下一次排程才會上線。
    assert triggers["push"]["branches"] == ["main"]


def test_worker_dispatches_to_a_workflow_that_exists() -> None:
    """Worker 寫死的 workflow 檔名必須真的存在，否則手動更新會靜默失敗。"""
    source = WORKER_ENTRY.read_text(encoding="utf-8")
    match = re.search(r"GITHUB_WORKFLOW\s*=\s*'([^']+)'", source)
    assert match, "worker/src/index.js 應該定義 GITHUB_WORKFLOW"

    referenced = WORKFLOWS / match.group(1)
    assert referenced.is_file(), f"Worker 觸發的 {match.group(1)} 不存在於 .github/workflows"
    assert referenced == REFRESH_WORKFLOW


def test_no_workflow_hard_fails_on_a_missing_worker_url() -> None:
    """Worker 網址是選配加速層；沒設定時要降級建置，不能擋掉更新或讓 CI 永遠紅燈。

    這個檢查涵蓋兩個 workflow：漏掉任何一個都會有一條管線永久失敗。
    """
    for workflow in (REFRESH_WORKFLOW, CI_WORKFLOW):
        body = workflow.read_text(encoding="utf-8")
        assert "ALLOW_STATIC_ONLY" in body, f"{workflow.name} 未設定 Worker 網址時應降級建置"
        assert "VITE_API_BASE_URL is required" not in body, f"{workflow.name} 不應硬性要求 Worker 網址"


def test_refresh_skips_the_test_suite_that_ci_already_runs() -> None:
    """五分鐘一輪的資料更新不該重跑完整測試；那是 ci.yml 的職責。"""
    refresh_steps = load_workflow(REFRESH_WORKFLOW)["jobs"]["refresh"]["steps"]
    commands = " ".join(step.get("run", "") for step in refresh_steps)

    assert "pytest" not in commands
    assert "npm test" not in commands

    ci_commands = " ".join(
        step.get("run", "") for step in load_workflow(CI_WORKFLOW)["jobs"]["test"]["steps"]
    )
    assert "pytest" in ci_commands
    assert "npm test" in ci_commands
