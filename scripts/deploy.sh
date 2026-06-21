#!/bin/bash
# Auto-deploy MissionOS from master
set -euo pipefail
cd "$(dirname "$0")/.."

STATE_DIR="server/data"
STATE_FILE="$STATE_DIR/.deploy-version-state"
HEALTH_URL="${MISSIONOS_HEALTH_URL:-http://127.0.0.1:3001/api/health}"
HEALTH_TIMEOUT_SECONDS="${MISSIONOS_HEALTH_TIMEOUT_SECONDS:-60}"

echo "$(date): Checking for updates..."
git fetch origin master --quiet

LOCAL=$(git rev-parse master)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "$(date): Already up to date ($LOCAL)"
  exit 0
fi

echo "$(date): New commits found ($LOCAL → $REMOTE), deploying..."
git checkout master --quiet
git pull origin master --quiet

mkdir -p "$STATE_DIR"

DEPLOY_DATE=$(date +%Y.%m.%d)
DEPLOY_SEQUENCE=1
if [ -f "$STATE_FILE" ]; then
  LAST_DEPLOY_DATE=$(sed -n '1p' "$STATE_FILE")
  LAST_DEPLOY_SEQUENCE=$(sed -n '2p' "$STATE_FILE")
  if [ "$LAST_DEPLOY_DATE" = "$DEPLOY_DATE" ] && [[ "$LAST_DEPLOY_SEQUENCE" =~ ^[0-9]+$ ]]; then
    DEPLOY_SEQUENCE=$((LAST_DEPLOY_SEQUENCE + 1))
  fi
fi

printf -v DEPLOY_SEQUENCE_PADDED "%02d" "$DEPLOY_SEQUENCE"
export VITE_DEPLOY_VERSION="v${DEPLOY_DATE}-${DEPLOY_SEQUENCE_PADDED}"

echo "$(date): Building deployment ${VITE_DEPLOY_VERSION}..."

docker compose config --quiet
docker compose up -d --build

echo "$(date): Waiting for MissionOS health check at ${HEALTH_URL}..."
HEALTH_DEADLINE=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until curl --fail --silent --show-error "$HEALTH_URL" | grep -q '"ok":true'; do
  if [ "$SECONDS" -ge "$HEALTH_DEADLINE" ]; then
    echo "$(date): Deploy health check failed after ${HEALTH_TIMEOUT_SECONDS}s"
    docker compose ps
    exit 1
  fi
  sleep 2
done

printf "%s\n%s\n" "$DEPLOY_DATE" "$DEPLOY_SEQUENCE" > "$STATE_FILE"

echo "$(date): Deploy complete! Now running $(git rev-parse --short HEAD) as ${VITE_DEPLOY_VERSION}"
