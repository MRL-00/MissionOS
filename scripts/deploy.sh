#!/bin/bash
# Auto-deploy MissionOS from master
set -euo pipefail
cd "$(dirname "$0")/.."

STATE_DIR="data"
STATE_FILE="$STATE_DIR/.deploy-version-state"

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

docker compose down
docker compose up -d --build

printf "%s\n%s\n" "$DEPLOY_DATE" "$DEPLOY_SEQUENCE" > "$STATE_FILE"

echo "$(date): Deploy complete! Now running $(git rev-parse --short HEAD) as ${VITE_DEPLOY_VERSION}"
