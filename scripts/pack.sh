#!/usr/bin/env bash
# Pack the unpacked Chrome MV3 extension into dist/sousuo-jishiben-<version>.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")"
NAME="sousuo-jishiben-${VERSION}"
DIST="${ROOT}/dist"
STAGING="${DIST}/${NAME}"
ZIP="${DIST}/${NAME}.zip"

rm -rf "$STAGING" "$ZIP"
mkdir -p "$STAGING"

rsync -a \
  --exclude '.DS_Store' \
  --exclude '.thumbs/' \
  --exclude '_harness*' \
  src/ "$STAGING/src/"

rsync -a \
  --exclude '.DS_Store' \
  --exclude '.thumbs/' \
  assets/ "$STAGING/assets/"

cp manifest.json "$STAGING/"

# Chrome "Load unpacked" needs a folder with manifest.json at the top.
# Zip that folder so testers unzip once, then pick the directory.
(
  cd "$DIST"
  zip -r -q "${NAME}.zip" "${NAME}" -x "*.DS_Store" -x "**/.thumbs/*"
)

BYTES="$(wc -c < "$ZIP" | tr -d ' ')"
echo "Wrote ${ZIP}"
echo "version ${VERSION}  ${BYTES} bytes"
