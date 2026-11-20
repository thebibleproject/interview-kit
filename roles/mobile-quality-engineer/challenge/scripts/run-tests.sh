#!/usr/bin/env bash
# Runs the Maestro suite and writes reports to reports/.
#
# Usage:
#   ./scripts/run-tests.sh                                   # every flow under maestro/tests
#   ./scripts/run-tests.sh maestro/tests/topics              # one folder
#   ./scripts/run-tests.sh maestro/tests/topics/rename_topic.yaml
#   ./scripts/run-tests.sh maestro --include-tags smoke      # only flows tagged smoke
#
# The first argument, if given, is what to run. Anything after it is passed
# straight to `maestro test`.
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="maestro"
if [[ $# -gt 0 ]]; then
  TARGET="$1"
  shift
fi

mkdir -p reports
maestro test \
  --format junit \
  --output reports/junit.xml \
  --debug-output reports/debug \
  "$@" \
  "$TARGET"
