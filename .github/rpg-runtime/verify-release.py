#!/usr/bin/env python3
"""Validate WASM-4 browser assets and emit release metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re


BASELINE = "ca2600db8de49d0d228ed57dd6c6778fb579a013"
TAG = re.compile(r"^retrom-core-gca2600db8de4-r[1-9][0-9]*(-rc\.[1-9][0-9]*)?$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")


def digest(path: pathlib.Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def require_file(path: pathlib.Path, minimum: int, maximum: int) -> None:
    if path.is_symlink() or not path.is_file() or not minimum <= path.stat().st_size <= maximum:
        raise SystemExit(f"RPG_RUNTIME_RELEASE_ASSET_INVALID:{path.name}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    if args.repository != "https://github.com/retrom-project/wasm4":
        raise SystemExit("RPG_RUNTIME_RELEASE_REPOSITORY_INVALID")
    if TAG.fullmatch(args.tag) is None or COMMIT.fullmatch(args.commit) is None:
        raise SystemExit("RPG_RUNTIME_RELEASE_IDENTITY_INVALID")

    module = args.output / "wasm4-retrom.mjs"
    license_file = args.output / "LICENSE.txt"
    require_file(module, 20_000, 2 * 1024 * 1024)
    require_file(license_file, 500, 64 * 1024)
    javascript = module.read_text(encoding="utf-8")
    for marker in (
        "createRetromWasm4", "RETROM_WASM4_ADAPTER_ABI", "wasm4-state-v1",
        "WASM4_CHECKPOINT_RESTORE_FAILED", "WASM4_RUNTIME_INVALID_STATE",
    ):
        if marker not in javascript:
            raise SystemExit(f"RPG_RUNTIME_RELEASE_BRIDGE_INVALID:{marker}")

    assets = [
        {"filename": path.name, "observedSha256": digest(path), "sizeBytes": path.stat().st_size}
        for path in (module, license_file)
    ]
    metadata = {
        "adapterAbi": "wasm4-state-v1",
        "assets": assets,
        "commit": args.commit,
        "digestPolicy": "OBSERVED_CACHE_INTEGRITY_ONLY",
        "repository": args.repository,
        "schemaVersion": 1,
        "sourceCommits": {"engine": BASELINE},
        "tag": args.tag,
    }
    (args.output / "rpg-runtime-release.json").write_text(
        json.dumps(metadata, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
