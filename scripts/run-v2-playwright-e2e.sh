#!/usr/bin/env bash
set -euo pipefail

E2E_PORT="${E2E_PORT:-0}"
ARTIFACTS_DIR="${E2E_ARTIFACTS_DIR:-$(pwd)/.playwright-e2e-artifacts}"
TMP_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pc-v2-e2e-XXXXXX")"
RAW_SERVER_LOG="$TMP_DATA_DIR/e2e-server-raw.log"
REDACTED_SERVER_LOG="$ARTIFACTS_DIR/e2e-server.log"

rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR"

E2E_PORT="$E2E_PORT" \
E2E_DATA_DIR="$TMP_DATA_DIR" \
  node --import tsx scripts/e2e-v2-server.ts </dev/null >"$RAW_SERVER_LOG" 2>&1 &
SRV_PID=$!

SETUP_TOKEN=""

redact_server_log() {
  if [ -f "$RAW_SERVER_LOG" ]; then
    if [ -n "$SETUP_TOKEN" ]; then
      sed "s/${SETUP_TOKEN}/***MASKED_SETUP_TOKEN***/g" "$RAW_SERVER_LOG" >"$REDACTED_SERVER_LOG" || true
    else
      grep -v "First-registration single-use setup token" "$RAW_SERVER_LOG" >"$REDACTED_SERVER_LOG" || true
    fi
  fi
}

cleanup() {
  local rc=$?
  kill -TERM "$SRV_PID" 2>/dev/null || true
  wait "$SRV_PID" 2>/dev/null || true
  redact_server_log
  rm -rf "$TMP_DATA_DIR"
  exit "$rc"
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  if grep -q "E2E_SERVER_READY=" "$RAW_SERVER_LOG" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$SRV_PID" 2>/dev/null; then
    echo "[ERROR] e2e-v2-server.ts exited unexpectedly:" >&2
    redact_server_log
    cat "$REDACTED_SERVER_LOG" >&2 || true
    exit 1
  fi
  sleep 0.2
done

if ! grep -q "E2E_SERVER_READY=" "$RAW_SERVER_LOG"; then
  echo "[ERROR] Timed out waiting for e2e-v2-server.ts:" >&2
  redact_server_log
  cat "$REDACTED_SERVER_LOG" >&2 || true
  exit 1
fi

E2E_BASE_URL="$(sed -n 's/^E2E_SERVER_READY=//p' "$RAW_SERVER_LOG" | tail -n 1 | tr -d '\r\n')"
SETUP_TOKEN="$(sed -n 's/^\[PhotoCloud v2 Setup\] First-registration single-use setup token (printed once): //p' "$RAW_SERVER_LOG" | tail -n 1 | tr -d '\r\n')"
FIXTURES_DIR="$(sed -n 's/^E2E_FIXTURES_DIR=//p' "$RAW_SERVER_LOG" | tail -n 1 | tr -d '\r\n')"

if [ -n "$SETUP_TOKEN" ] && [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  echo "::add-mask::$SETUP_TOKEN"
fi

if [ -z "$E2E_BASE_URL" ] || [ -z "$SETUP_TOKEN" ] || [ -z "$FIXTURES_DIR" ]; then
  echo "[ERROR] Failed to extract E2E_BASE_URL, SETUP_TOKEN or FIXTURES_DIR from server stdout:" >&2
  redact_server_log
  cat "$REDACTED_SERVER_LOG" >&2 || true
  exit 1
fi

redact_server_log

export E2E_BASE_URL
export E2E_SETUP_TOKEN="$SETUP_TOKEN"
export E2E_FIXTURES_DIR="$FIXTURES_DIR"
export E2E_ARTIFACTS_DIR="$ARTIFACTS_DIR"

node scripts/e2e-v2-playwright.mjs
