#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."

export PROVIDER_ID="kira"
export BASE_URL="${KIRA_BASE_URL:-https://kiraai.vn/api/v1}"
export API_KEY="${KIRA_API_KEY:?set KIRA_API_KEY}"
export MODELS="${KIRA_MODELS:-deepseek-v4-flash-free,qwen3.8-flash-next-free,qwen3.8-27b-free,qwen3.5-flash-free,mimo-v2.6-flash-free,beam-free,kira-mini-1.0,apodex-1.1-mini-free,gpt-oss-120b-free}"
export TIMEOUT_S="${KIRA_TIMEOUT_S:-40}"

exec bash scripts/lib/probe-openai.sh
