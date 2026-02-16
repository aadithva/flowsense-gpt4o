#!/bin/bash

echo "==================================="
echo "FlowSense - Status"
echo "==================================="
echo ""

# Check if services are running
echo "1. Services Status:"
if curl -s http://localhost:3000 > /dev/null 2>&1; then
  echo "   ✓ Web app running on http://localhost:3000"
else
  echo "   ✗ Web app NOT running"
fi

if curl -s http://localhost:3001 > /dev/null 2>&1; then
  echo "   ✓ Processor running on http://localhost:3001"
else
  echo "   ✗ Processor NOT running"
fi

if curl -s http://127.0.0.1:54321 > /dev/null 2>&1; then
  echo "   ✓ Supabase running on http://127.0.0.1:54321"
else
  echo "   ✗ Supabase NOT running"
fi

echo ""
echo "2. Database Status:"

# Check profiles
PROFILES=$(curl -s 'http://127.0.0.1:54321/rest/v1/profiles?select=count' \
  -H "apikey: eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ0MzMzMjB9.7rXWPnmj8nZU_eeZFTXBBIFCkV7VDQFgqBVTIEEZ5NY" \
  -H "Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA4NDQzMzMyMH0.DCUugYwr9IKz9H8M8oYH4QnB_mWgkmsHNZbo7fQe87RAIpm53U3NGlBh9dXhPsdiW79WDobh61mbyHxm0MbyiA" \
  | jq -r '.[0].count // 0')
echo "   Anonymous user: $PROFILES profile(s)"

# Check analysis runs
RUNS=$(curl -s 'http://127.0.0.1:54321/rest/v1/analysis_runs?select=id,title,status,progress_percentage,created_at&order=created_at.desc&limit=5' \
  -H "apikey: eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ0MzMzMjB9.7rXWPnmj8nZU_eeZFTXBBIFCkV7VDQFgqBVTIEEZ5NY" \
  -H "Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA4NDQzMzMyMH0.DCUugYwr9IKz9H8M8oYH4QnB_mWgkmsHNZbo7fQe87RAIpm53U3NGlBh9dXhPsdiW79WDobh61mbyHxm0MbyiA")

RUN_COUNT=$(echo "$RUNS" | jq 'length')
echo "   Analysis runs: $RUN_COUNT"

if [ "$RUN_COUNT" -gt 0 ]; then
  echo ""
  echo "   Recent runs:"
  echo "$RUNS" | jq -r '.[] | "   - [\(.status)] \(.title) (\(.progress_percentage // 0)%) - \(.created_at)"'
fi

echo ""
echo "3. Storage Status:"

# Check videos bucket
BUCKET=$(curl -s 'http://127.0.0.1:54321/storage/v1/bucket/videos' \
  -H "Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA4NDQzMzMyMH0.DCUugYwr9IKz9H8M8oYH4QnB_mWgkmsHNZbo7fQe87RAIpm53U3NGlBh9dXhPsdiW79WDobh61mbyHxm0MbyiA")

if echo "$BUCKET" | jq -e '.name == "videos"' > /dev/null 2>&1; then
  echo "   ✓ Videos bucket exists"

  # List files in bucket
  FILES=$(curl -s 'http://127.0.0.1:54321/storage/v1/object/list/videos' \
    -H "Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA4NDQzMzMyMH0.DCUugYwr9IKz9H8M8oYH4QnB_mWgkmsHNZbo7fQe87RAIpm53U3NGlBh9dXhPsdiW79WDobh61mbyHxm0MbyiA")

  FILE_COUNT=$(echo "$FILES" | jq 'length' 2>/dev/null || echo "0")
  echo "   Files in storage: $FILE_COUNT"

  if [ "$FILE_COUNT" -gt 0 ]; then
    echo ""
    echo "   Recent files:"
    echo "$FILES" | jq -r '.[] | "   - \(.name) (\(.metadata.size // 0 | tonumber / 1024 / 1024 | floor)MB)"' | head -5
  fi
else
  echo "   ✗ Videos bucket NOT found"
fi

echo ""
echo "==================================="
echo "Open http://localhost:3000 to test"
echo "==================================="
