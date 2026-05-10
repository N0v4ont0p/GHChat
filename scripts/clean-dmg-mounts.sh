#!/usr/bin/env bash
# scripts/clean-dmg-mounts.sh
#
# Detach any stale GHchat DMG volumes that electron-builder may have left mounted
# from a previous (failed) packaging run.
#
# Background:
#   electron-builder mounts a temporary DMG, copies the app bundle into it, then
#   calls `hdiutil resize` to shrink it before finalising the artifact.  If a
#   previous build was interrupted the volume stays mounted and the next resize
#   call fails with:
#     hdiutil: resize: failed. Resource temporarily unavailable (35)
#
# Usage:
#   bash scripts/clean-dmg-mounts.sh        # called automatically by package:mac* scripts
#   pnpm run clean:dmg-mounts               # call manually after a failed build
#
# Recovery (manual):
#   hdiutil info                            # list all mounted disk images
#   hdiutil detach /Volumes/GHchat* --force # force-detach a specific volume
#   rm -rf dist                             # remove stale build output
#   pnpm run package:mac:arm64              # retry packaging

set -euo pipefail

detached=0

# Detach any volume whose mount-point begins with "GHchat" or "ghchat" (both casings
# are matched because electron-builder may vary the capitalisation depending on
# the productName vs the volume label).
for vol in /Volumes/GHchat* /Volumes/ghchat*; do
  if [ -d "$vol" ]; then
    echo "  [clean-dmg-mounts] Detaching stale volume: $vol"
    hdiutil detach "$vol" --force 2>/dev/null && detached=$((detached + 1)) || true
  fi
done

# Also sweep for any electron-builder temp images still attached
# (they appear as /Volumes/<random-hex> when hdiutil info shows a .dmg source path
# under the system temp dir — skip these to avoid touching unrelated images).

if [ "$detached" -gt 0 ]; then
  echo "  [clean-dmg-mounts] Detached $detached stale volume(s)."
else
  echo "  [clean-dmg-mounts] No stale GHchat volumes found."
fi
