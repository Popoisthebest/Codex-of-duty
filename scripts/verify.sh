#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== BUILD ==="
npm run build

echo "=== PHYSICS CONTRACT ==="
npm run harness:physics

echo "=== HARNESS CONTRACT ==="
npm run harness:check

echo "=== PLAYTEST ==="
npm run harness:playtest

echo "=== VERIFY PASSED ==="
