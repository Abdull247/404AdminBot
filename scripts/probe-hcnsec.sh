#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."

export PROVIDER_ID="hcnsec"
export BASE_URL="${HCNSEC_BASE_URL:-https://api.hcnsec.cn/v1}"
export API_KEY="${HCNSEC_API_KEY:?set HCNSEC_API_KEY}"
export MODELS="${HCNSEC_MODELS:-DeepSeek-V4-Flash,glm-5.3-flash,MiniMax-M3.1-Flash}"
export TIMEOUT_S="${HCNSEC_TIMEOUT_S:-40}"

exec bash scripts/lib/probe-openai.sh
