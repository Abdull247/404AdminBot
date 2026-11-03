#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."

echo "Probing enabled chat models for hcnsec, agnes, nvidia, kira"
echo

bash scripts/probe-hcnsec.sh || true
echo
bash scripts/probe-agnes.sh || true
echo
bash scripts/probe-nvidia.sh || true
echo
bash scripts/probe-kira.sh || true
