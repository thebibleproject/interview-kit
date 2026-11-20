#!/usr/bin/env bash
# Installs the app on the running emulator or connected device.
#
# Usage: ./scripts/install-app.sh [path/to/app.apk]
# Default APK path: app/bible-study-notebook.apk
set -euo pipefail

cd "$(dirname "$0")/.."
APK="${1:-app/bible-study-notebook.apk}"

if [[ ! -f "$APK" ]]; then
  echo "No APK found at $APK" >&2
  echo "Put the APK in app/ or pass its path: ./scripts/install-app.sh path/to/app.apk" >&2
  exit 1
fi

if ! adb get-state >/dev/null 2>&1; then
  echo "No emulator or device found. Start an emulator and check 'adb devices'." >&2
  exit 1
fi

adb install -r "$APK"
echo "Installed $APK"
