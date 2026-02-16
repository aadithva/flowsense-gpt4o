#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
VIDEO_PATH="${1:-/tmp/flowsense-test.mp4}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this script."
  exit 1
fi

if [ ! -f "$VIDEO_PATH" ]; then
  echo "Video file not found: $VIDEO_PATH"
  echo "Usage: $0 /path/to/video.mp4"
  exit 1
fi

FILE_NAME="$(basename "$VIDEO_PATH")"
CONTENT_TYPE="video/mp4"

echo "Creating run..."
CREATE_RES="$(curl -s -X POST "$BASE_URL/api/runs" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Smoke Test $(date +%s)\",\"fileName\":\"$FILE_NAME\",\"contentType\":\"$CONTENT_TYPE\"}")"

RUN_ID="$(echo "$CREATE_RES" | jq -r '.run.id')"
UPLOAD_URL="$(echo "$CREATE_RES" | jq -r '.uploadUrl')"

if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
  echo "Failed to create run: $CREATE_RES"
  exit 1
fi

echo "Uploading video..."
curl -s -X PUT "$UPLOAD_URL" \
  -H "Content-Type: $CONTENT_TYPE" \
  --data-binary @"$VIDEO_PATH" >/dev/null

echo "Enqueuing run..."
curl -s -X POST "$BASE_URL/api/runs/$RUN_ID/enqueue" >/dev/null

echo "run_id=$RUN_ID"

echo "Polling status..."
for _ in {1..60}; do
  STATUS="$(curl -s "$BASE_URL/api/runs/$RUN_ID/status" | jq -r '.status')"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
  sleep 2
done

echo "Fetching report..."
curl -s "$BASE_URL/api/runs/$RUN_ID" | jq .
