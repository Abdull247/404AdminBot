#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."

export PROVIDER_ID="nvidia"
export BASE_URL="${NVIDIA_BASE_URL:-https://integrate.api.nvidia.com/v1}"
export API_KEY="${NVIDIA_API_KEY:?set NVIDIA_API_KEY}"
export MODELS="${NVIDIA_MODELS:-mistralai/mistral-large-4-1t-a52b,meta/muse-glimmer-30b,nvidia/nemotron-3.5-lightning-30b-a3b,poolside/laguna-xs-2.1}"
export TIMEOUT_S="${NVIDIA_TIMEOUT_S:-50}"

exec bash scripts/lib/probe-openai.sh
