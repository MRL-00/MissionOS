#!/bin/bash
OFFICE_URL="${OFFICE_URL:-http://localhost:3001}"

case "$1" in
  register)
    curl -s -X POST "$OFFICE_URL/api/agent/register" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"$2\",\"name\":\"$3\",\"role\":\"$4\",\"type\":\"${5:-visitor}\"}"
    ;;
  deregister)
    curl -s -X DELETE "$OFFICE_URL/api/agent/$2"
    ;;
  status)
    curl -s -X POST "$OFFICE_URL/api/agent/$2/status" \
      -H "Content-Type: application/json" \
      -d "{\"agentId\":\"$2\",\"status\":\"$3\",\"task\":\"$4\",\"message\":\"$5\",\"timestamp\":$(date +%s000)}"
    ;;
  list)
    curl -s "$OFFICE_URL/api/agents" | python3 -m json.tool
    ;;
  *)
    echo "Usage: office-cli.sh {register|deregister|status|list}"
    ;;
esac
