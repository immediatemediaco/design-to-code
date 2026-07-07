#!/usr/bin/env bash

set -euo pipefail

PATCHWORK_DIR="${PATCHWORK_DIR:-patchwork}"
PATCHWORK_REPO="${PATCHWORK_REPO:-git@github.immediate.co.uk:wcp-packages/patchwork.git}"

if [[ -d "${PATCHWORK_DIR}/.git" ]]; then
  echo "Patchwork already available at ${PATCHWORK_DIR}"
  exit 0
fi

if [[ -e "${PATCHWORK_DIR}" ]]; then
  echo "Expected ${PATCHWORK_DIR} to be a git checkout, but it already exists and is not a repository." >&2
  exit 1
fi

echo "Cloning Patchwork into ${PATCHWORK_DIR}"
git clone "${PATCHWORK_REPO}" "${PATCHWORK_DIR}"
