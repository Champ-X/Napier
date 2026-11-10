#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$repo_root"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf 'Usage: %s\nStart the Napier frontend and backend. Press Ctrl+C to stop both.\n' "$0"
  exit 0
fi
if [[ $# -ne 0 ]]; then
  printf 'Unknown argument: %s\nUsage: %s\n' "$1" "$0" >&2
  exit 1
fi

for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Missing %s. Install Node.js >=22.19.0 with npm, then run this script again.\n' "$tool" >&2
    exit 1
  fi
done

node --input-type=module <<'JS'
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  console.error(`Node.js >=22.19.0 is required; found ${process.versions.node}.`);
  process.exit(1);
}
JS

# Create local configuration exclusively; never replace existing credentials.
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
try {
  writeFileSync('.env', readFileSync('.env.example'), { flag: 'wx', mode: 0o600 });
  console.log('Created .env from .env.example. Demo mode works without API keys.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
JS

for dependency in \
  node_modules/.package-lock.json \
  node_modules/typescript/bin/tsc \
  node_modules/concurrently/dist/bin/concurrently.js \
  node_modules/tsx/dist/cli.mjs \
  node_modules/vite/bin/vite.js; do
  if [[ ! -f "$dependency" ]]; then
    printf 'Installing dependencies from package-lock.json...\n'
    npm ci --no-audit --no-fund
    break
  fi
done

printf 'Starting Napier in %s\nOpen the Local URL printed by Vite. Press Ctrl+C to stop the frontend and backend.\n' "$repo_root"
exec npm run dev
