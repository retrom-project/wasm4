# Retrom WASM-4 fork maintenance rules

This fork builds the WASM-4 browser runtime consumed by
`retrom-project/retrom-runtime`. It remains independent of Retrom application
APIs, databases, review workflows, credentials, and game catalogs.

## Repository identity

- `main` is an unmodified, fast-forward-only mirror of `upstream/main`.
- `retrom/gca2600db8de4` is the planned Retrom maintenance baseline. Retrom
  changes and release tags originate there, never from `main`.
- `upstream` must point to `https://github.com/aduros/wasm4.git`.
- `retrom-fork.json` is the machine-readable baseline and release contract.
  Never replace its fixed upstream commit with a floating branch.
- A new upstream baseline requires a reviewed
  `sync/upstream-g<12-hex-commit>` branch and a new matching `retrom/g<commit>`
  maintenance branch.

## Branches and commits

- Use short-lived `fix/*`, `feat/*`, `build/*`, or
  `sync/upstream-<baseline>` branches created from the fixed Retrom baseline.
- Branch names use lowercase ASCII and hyphens. Do not create temporary
  parallel maintenance branches or branches named after an agent or user.
- Keep downstream changes small and reviewable. Release ancestry after the
  fixed upstream baseline must not contain merge commits.
- Never force-push, move immutable tags, or delete another contributor's work.

## Runtime boundary

- This fork owns the browser core, host ABI, build, verification, and Release
  assets. It must not import `retrom-runtime` or Retrom source code.
- Stable ABI `wasm4-state-v1` must support ready lifecycle, pause/resume,
  standard browser gamepads, screenshot, bounded instant checkpoint, direct
  restore in a fresh instance, and complete input/frame/audio cleanup.
- A checkpoint is bound to the exact cart SHA-256 and includes WASM memory,
  exported mutable globals, and the bounded WASM-4 disk. Persistent disk alone
  is not an instant checkpoint.
- WASM-4 carts have no core-owned exit API. If one is added later, the host ABI
  must report it exactly once, disable checkpointing, and release all inputs.
- Tests and local smoke runs use only redistributable open-source carts. Never
  commit private or commercial games, credentials, saves, or downloaded carts.

## Quality and releases

- Before pushing, run `python3 .github/rpg-runtime/verify-source.py`.
- The upstream whole-tree ESLint target currently fails on untouched upstream
  sources. Retrom changes use the explicit `npm run test:retrom` gate: full
  web TypeScript checking plus zero-warning lint for the host bridge. Do not
  broaden this exception to new Retrom-owned source files.
- Web changes must also run
  `.github/rpg-runtime/build-web.sh <empty-output-directory>` and
  `.github/rpg-runtime/verify-release.py` with a valid candidate identity.
- PFB builds use `.github/rpg-runtime/build-candidate.sh` and must emit the
  common `retrom-core-candidate.json` descriptor.
- Release tags are `retrom-core-gca2600db8de4-rN`, optionally suffixed with
  `-rc.N` for integration candidates. Never publish floating aliases.
- Tags are annotated and immutable. The tag workflow is the supported Release
  path for `wasm4-retrom.mjs`, `LICENSE.txt`, and
  `rpg-runtime-release.json`.
