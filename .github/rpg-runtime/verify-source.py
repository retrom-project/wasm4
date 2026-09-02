#!/usr/bin/env python3
"""Validate the fixed WASM-4 fork baseline and release contract."""

from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess


ROOT = pathlib.Path(__file__).resolve().parents[2]
BASELINE = "ca2600db8de49d0d228ed57dd6c6778fb579a013"
BRANCH = "retrom/gca2600db8de4"
TAG_PATTERN = r"^retrom-core-gca2600db8de4-r[1-9][0-9]*(-rc\.[1-9][0-9]*)?$"


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def main() -> None:
    contract = json.loads((ROOT / "retrom-fork.json").read_text(encoding="utf-8"))
    assert contract["schemaVersion"] == 1
    assert contract["forkRepository"] == "https://github.com/retrom-project/wasm4"
    assert contract["defaultBranch"] == BRANCH
    assert contract["upstreamMirrorBranch"] == "main"
    assert contract["releaseTagPattern"] == TAG_PATTERN
    assert re.fullmatch(TAG_PATTERN, "retrom-core-gca2600db8de4-r1")
    assert contract["adapterAbi"] == "wasm4-state-v1"
    assert contract["upstreams"] == [{
        "role": "engine-baseline",
        "repository": "https://github.com/aduros/wasm4",
        "refType": "COMMIT",
        "ref": BASELINE,
        "commit": BASELINE,
    }]
    assert contract["releaseAssets"] == [
        "wasm4-retrom.mjs", "LICENSE.txt", "rpg-runtime-release.json",
    ]
    revision = "HEAD^2" if os.environ.get("GITHUB_EVENT_NAME") == "pull_request" else "HEAD"
    assert git("merge-base", "--is-ancestor", BASELINE, revision) == ""
    assert not git("rev-list", "--min-parents=2", f"{BASELINE}..{revision}")
    print("retrom WASM-4 fork source contract: ok")


if __name__ == "__main__":
    main()
