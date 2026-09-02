#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
output=${1:?absolute empty output directory is required}
if [[ "$output" != /* || ! -d "$output" || -L "$output" ]]; then
  echo "RPG_RUNTIME_OUTPUT_INVALID" >&2
  exit 1
fi
if find "$output" -mindepth 1 -print -quit | grep -q .; then
  echo "RPG_RUNTIME_OUTPUT_NOT_EMPTY" >&2
  exit 1
fi

cd "$root/devtools/web"
npm ci
cd "$root/runtimes/web"
npm ci
npm run test:retrom
npm run build:retrom
install -m 0644 dist/retrom/wasm4-retrom.mjs "$output/wasm4-retrom.mjs"
install -m 0644 "$root/LICENSE.txt" "$output/LICENSE.txt"
