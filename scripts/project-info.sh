#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Project root: $ROOT"
echo

echo "Detected project markers:"
for f in \
  package.json pnpm-lock.yaml yarn.lock bun.lock bun.lockb package-lock.json \
  pyproject.toml requirements.txt setup.py \
  Cargo.toml go.mod Package.swift gradlew Makefile \
  docker-compose.yml compose.yml Dockerfile; do
  if [[ -e "$f" ]]; then
    echo "  - $f"
  fi
done

echo
echo "Available tools:"
for cmd in git node npm pnpm yarn bun python3 cargo go swift java make; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf "  - %-10s %s\n" "$cmd" "$(command -v "$cmd")"
  fi
done
