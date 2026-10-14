#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Prefer reproducible installs. Parallel task merges can leave importer references
# whose peer-dependency snapshots are missing, even when the YAML is valid.
install_log="$(mktemp)"
trap 'rm -f "$install_log"' EXIT
if pnpm install --frozen-lockfile 2>&1 | tee "$install_log"; then
  :
else
  status=$?
  if grep -Eq 'ERR_PNPM_(LOCKFILE_MISSING_DEPENDENCY|OUTDATED_LOCKFILE|LOCKFILE_CONFIG_MISMATCH|BROKEN_LOCKFILE)' "$install_log"; then
    echo "Merged lockfile is inconsistent; repairing it from the workspace manifests."
    pnpm install --no-frozen-lockfile --fix-lockfile
  else
    # Do not hide registry, security, network, or lifecycle-script failures.
    exit "$status"
  fi
fi

# Rebuild shared declarations before newly merged artifact code consumes them.
pnpm run typecheck:libs
pnpm --filter @workspace/api-server --filter @workspace/voice-kiosk run typecheck
pnpm --filter @workspace/db run push-force
