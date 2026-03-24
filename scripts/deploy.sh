#!/bin/bash
# Auto-deploy the-office from master
set -e
cd "$(dirname "$0")/.."

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

docker compose down
docker compose up -d --build

echo "$(date): Deploy complete! Now running $(git rev-parse --short HEAD)"
