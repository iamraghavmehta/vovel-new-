#!/usr/bin/env bash
# Bundles the browser app into dist/. Requires Bun (https://bun.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist
bun build src/app/main.tsx --outfile=dist/app.js --target=browser --minify
cp public/index.html public/styles.css dist/
echo "built dist/"
