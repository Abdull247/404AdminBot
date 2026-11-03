#!/usr/bin/env bash
set -u

provider_id="${PROVIDER_ID:?PROVIDER_ID is required}"
base_url="${BASE_URL:?BASE_URL is required}"
api_key="${API_KEY:?API_KEY is required}"
models_csv="${MODELS:?MODELS is required}"
timeout_s="${TIMEOUT_S:-40}"

base_url="${base_url%/}"
pass=0
fail=0

echo "== ${provider_id} models =="
curl -sS -m "${timeout_s}" \
  -H "Authorization: Bearer ${api_key}" \
  -H "Accept: application/json" \
  "${base_url}/models" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    print("WARN: /models did not return JSON")
    print(raw[:400])
    raise SystemExit
items = data.get("data") or data.get("models") or []
print("listed", len(items), "models")
shown = 0
for item in items:
    mid = item.get("id") or item.get("name")
    free = item.get("is_free")
    if free is False:
        continue
    extra = "" if free is None else " (free=%s)" % free
    print("-", mid, extra)
    shown += 1
    if shown >= 60:
        break
'

echo
echo "== ${provider_id} chat probes =="
IFS=',' read -r -a models <<< "${models_csv}"
for model in "${models[@]}"; do
  model="$(echo "${model}" | xargs)"
  [ -n "${model}" ] || continue
  echo "-- ${model}"
  payload="$(python3 -c 'import json,sys; print(json.dumps({
    "model": sys.argv[1],
    "messages": [{"role":"user","content":"Reply with exactly: pong"}],
    "max_tokens": 16,
    "temperature": 0
  }))' "${model}")"
  summary="$(curl -sS -m "${timeout_s}" -w "\nHTTP_CODE:%{http_code}" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "${payload}" \
    "${base_url}/chat/completions" | python3 -c '
import json, sys
raw = sys.stdin.read()
code = "000"
body = raw
marker = "\nHTTP_CODE:"
if marker in raw:
    body, code = raw.rsplit(marker, 1)
    code = code.strip()
try:
    data = json.loads(body)
except Exception:
    print(code + " " + body[:240].replace("\n", " "))
    raise SystemExit
err = data.get("error")
if isinstance(err, dict):
    text = str(err.get("message") or err.get("code") or err)[:240]
elif err:
    text = str(err)[:240]
else:
    choices = data.get("choices") or []
    if not choices:
        text = "no choices"
    else:
        msg = choices[0].get("message") or {}
        content = msg.get("content") or msg.get("reasoning_content") or ""
        if isinstance(content, list):
            content = " ".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
        text = str(content).replace("\n", " ")[:240] or "(empty content)"
print(code + " " + text)
')"
  http_code="${summary%% *}"
  if [ "${http_code}" = "200" ]; then
    echo "OK ${summary}"
    pass=$((pass + 1))
  else
    echo "FAIL ${summary}"
    fail=$((fail + 1))
  fi
done

echo
echo "== ${provider_id} summary pass=${pass} fail=${fail} =="
