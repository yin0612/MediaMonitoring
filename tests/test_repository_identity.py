from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}
FORBIDDEN_IDENTITIES = (
    "chunyu" + "8866",
    "shueisha" + "0612",
    "MediaMonitoring" + "DB",
)


def test_repository_contains_only_the_current_owner_identity() -> None:
    offenders: list[str] = []
    listed_files = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout.splitlines()

    for relative_path in listed_files:
        path = ROOT / relative_path
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue

        body = path.read_text(encoding="utf-8", errors="ignore").lower()
        matches = [identity for identity in FORBIDDEN_IDENTITIES if identity.lower() in body]
        if matches:
            offenders.append(f"{path.relative_to(ROOT)}: {', '.join(matches)}")

    assert not offenders, "Legacy owner identities remain:\n" + "\n".join(offenders)
