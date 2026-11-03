#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."

export PROVIDER_ID="agnes"
export BASE_URL="${AGNES_BASE_URL:-https://apihub.agnes-ai.com/v1}"
export API_KEY="${AGNES_API_KEY:?set AGNES_API_KEY}"
export MODELS="${AGNES_MODELS:-agnes-3.0-flash,agnes-2.5-flash}"
export TIMEOUT_S="${AGNES_TIMEOUT_S:-40}"

exec bash scripts/lib/probe-openai.sh
