#!/usr/bin/env python3
"""Emit the common Retrom core candidate descriptor."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import stat
import subprocess


ROOT = pathlib.Path(__file__).resolve().parents[2]


def git_bytes(root: pathlib.Path, *arguments: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(root), *arguments], capture_output=True, check=False,
    )
    if result.returncode != 0:
        raise SystemExit("PFB_WORKTREE_INVALID")
    return result.stdout


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_file(path: pathlib.Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def checked_output(raw: str, *, empty: bool) -> pathlib.Path:
    output = pathlib.Path(raw)
    if not output.is_absolute() or output.is_symlink() or not output.is_dir():
        raise SystemExit("PFB_CANDIDATE_OUTPUT_INVALID")
    if empty and any(output.iterdir()):
        raise SystemExit("PFB_CANDIDATE_OUTPUT_INVALID")
    return output


def is_worktree_root(root: pathlib.Path) -> bool:
    result = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--show-toplevel"],
        capture_output=True, check=False, text=True,
    )
    if result.returncode != 0:
        return False
    try:
        return pathlib.Path(result.stdout.strip()).resolve(strict=True) == root.resolve(strict=True)
    except OSError:
        return False


def source_tree_sha256(root: pathlib.Path = ROOT) -> str:
    raw_paths = git_bytes(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    raw_modes = git_bytes(root, "ls-files", "--stage", "-z")
    tracked: dict[str, tuple[str, str]] = {}
    for item in raw_modes.split(b"\0"):
        if item:
            prefix, raw_path = item.split(b"\t", 1)
            mode, object_id, _stage = prefix.decode("ascii").split(" ")
            tracked[raw_path.decode("utf-8")] = (mode, object_id)
    records = []
    for raw_path in sorted(set(raw_paths.split(b"\0"))):
        if not raw_path:
            continue
        relative = raw_path.decode("utf-8")
        candidate = pathlib.Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or candidate.as_posix() != relative:
            raise SystemExit("PFB_WORKTREE_INVALID")
        target = root / relative
        mode, object_id = tracked.get(relative, ("100644", ""))
        try:
            info = target.lstat()
        except FileNotFoundError:
            continue
        if mode == "160000" and stat.S_ISDIR(info.st_mode):
            nested = {
                "indexCommit": object_id,
                "worktreeCommit": None,
                "sourceTreeSha256": None,
            }
            if is_worktree_root(target):
                nested["worktreeCommit"] = git_bytes(target, "rev-parse", "HEAD").decode().strip()
                nested["sourceTreeSha256"] = source_tree_sha256(target)
            contents = json.dumps(
                nested, separators=(",", ":"), sort_keys=True,
            ).encode("utf-8")
            file_digest = digest_bytes(contents)
            mode = "160000"
        else:
            if stat.S_ISLNK(info.st_mode):
                mode = "120000"
                file_digest = digest_bytes(os.readlink(target).encode("utf-8"))
            elif stat.S_ISREG(info.st_mode):
                if relative not in tracked:
                    mode = "100755" if info.st_mode & stat.S_IXUSR else "100644"
                file_digest = digest_file(target)
            else:
                raise SystemExit("PFB_WORKTREE_INVALID")
        records.append({"path": relative, "mode": mode, "sha256": file_digest})
    canonical = json.dumps(
        records, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    ).encode("utf-8")
    return digest_bytes(canonical)


def finalize(output: pathlib.Path, core_id: str) -> None:
    fork = json.loads((ROOT / "retrom-fork.json").read_text(encoding="utf-8"))
    expected = sorted(name for name in fork["releaseAssets"] if name != "rpg-runtime-release.json")
    if sorted(path.name for path in output.iterdir()) != expected:
        raise SystemExit("PFB_CANDIDATE_OUTPUT_INVALID")
    branch = git_bytes(ROOT, "symbolic-ref", "--quiet", "--short", "HEAD").decode().strip()
    commit = git_bytes(ROOT, "rev-parse", "HEAD").decode().strip()
    files = [
        {"filename": name, "sizeBytes": (output / name).stat().st_size,
         "sha256": digest_file(output / name)}
        for name in expected
    ]
    descriptor = {
        "schemaVersion": 1,
        "kind": "RETROM_CORE_CANDIDATE_V1",
        "coreId": core_id,
        "repository": fork["forkRepository"],
        "branch": branch,
        "commit": commit,
        "dirty": bool(git_bytes(ROOT, "status", "--porcelain=v1", "-z")),
        "sourceTreeSha256": source_tree_sha256(),
        "adapterAbi": fork["adapterAbi"],
        "files": files,
    }
    (output / "retrom-core-candidate.json").write_text(
        json.dumps(descriptor, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("prepare", "finalize"))
    parser.add_argument("output")
    parser.add_argument("--core-id")
    args = parser.parse_args()
    output = checked_output(args.output, empty=args.action == "prepare")
    if args.action == "finalize":
        if not args.core_id:
            raise SystemExit("PFB_CANDIDATE_OUTPUT_INVALID")
        finalize(output, args.core_id)


if __name__ == "__main__":
    main()
