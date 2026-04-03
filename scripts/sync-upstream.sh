#!/bin/bash
set -e

REPO="/Users/addison/Dev/opencli"
UPSTREAM="https://github.com/jackwener/opencli.git"

cd "$REPO"

if ! git remote get-url upstream &>/dev/null; then
  git remote add upstream "$UPSTREAM"
  echo "✅ Added upstream remote"
fi

git fetch upstream
git checkout main
git merge upstream/main
git push origin main

echo "✅ Synced with upstream"
