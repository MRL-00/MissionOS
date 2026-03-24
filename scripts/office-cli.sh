#!/bin/bash
OFFICE_URL="${OFFICE_URL:-http://localhost:3001}"

case "$1" in
  register)
    payload=$(jq -n \
      --arg id "$2" \
      --arg name "$3" \
      --arg role "$4" \
      --arg type "${5:-visitor}" \
      '{id: $id, name: $name, role: $role, type: $type}')
    curl -s -X POST "$OFFICE_URL/api/agent/register" \
      -H "Content-Type: application/json" \
      -d "$payload"
    ;;
  deregister)
    curl -s -X DELETE "$OFFICE_URL/api/agent/$2"
    ;;
  status)
    payload=$(jq -n \
      --arg agentId "$2" \
      --arg status "$3" \
      --arg task "$4" \
      --arg message "$5" \
      --argjson timestamp "$(date +%s000)" \
      '{agentId: $agentId, status: $status, timestamp: $timestamp}
      + if $task == "" then {} else {task: $task} end
      + if $message == "" then {} else {message: $message} end')
    curl -s -X POST "$OFFICE_URL/api/agent/$2/status" \
      -H "Content-Type: application/json" \
      -d "$payload"
    ;;
  list)
    curl -s "$OFFICE_URL/api/agents" | python3 -m json.tool
    ;;
  *)
    echo "Usage: office-cli.sh {register|deregister|status|list}"
    ;;
esac
