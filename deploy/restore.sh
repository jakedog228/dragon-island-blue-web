#!/bin/sh
# Restores an authoritative game state snapshot produced by backup.sh.
#
# Usage:
#   deploy/restore.sh <archive.tar.gz> <target-directory> [--force]
#
# The server MUST be stopped first. FileAuthoritativeSlotStore serialises transactions in-process
# and holds no lock a second writer would respect, so restoring underneath a live server produces
# state neither the archive nor the server ever contained:
#
#   docker compose -f deploy/compose.yaml --env-file deploy/.env stop game
#
# Restoring into a directory that already holds state is refused without --force. Overwriting live
# player state is not an operation this script performs by accident.

set -eu

archive="${1:-}"
target="${2:-}"
force="${3:-}"

fail() { echo "[dib-restore] ERROR: $*" >&2; exit 1; }
log() { echo "[dib-restore] $*"; }

if [ -z "$archive" ] || [ -z "$target" ]; then
	echo "usage: $0 <archive.tar.gz> <target-directory> [--force]" >&2
	exit 2
fi

[ -f "$archive" ] || fail "archive not found: $archive"

# --- Integrity ------------------------------------------------------------------------------------
# Verify before touching the target. A restore that discovers corruption halfway through has already
# destroyed whatever it was restoring over.
manifest="$archive.sha256"
if [ -f "$manifest" ]; then
	expected=$(awk '{print $1}' < "$manifest")
	actual=$(sha256sum "$archive" | awk '{print $1}')
	if [ "$expected" != "$actual" ]; then
		fail "sha256 mismatch for $archive
  manifest: $expected
  actual:   $actual
this archive is corrupt or was modified; do not restore it."
	fi
	log "sha256 verified against $(basename "$manifest")"
else
	log "WARNING: no manifest at $(basename "$manifest"); integrity cannot be confirmed"
fi

tar -tzf "$archive" >/dev/null 2>&1 || fail "archive is not readable as a gzip tar: $archive"
entries=$(tar -tzf "$archive" | wc -l | tr -d ' ')
[ "$entries" -gt 0 ] || fail "archive is empty"
log "archive readable, $entries entries"

# --- Target ---------------------------------------------------------------------------------------
if [ -e "$target" ] && [ ! -d "$target" ]; then
	fail "target exists and is not a directory: $target"
fi

if [ -d "$target" ]; then
	existing=$(find "$target" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')
	if [ "$existing" -gt 0 ] && [ "$force" != "--force" ]; then
		fail "target is not empty ($existing entries): $target
re-run with --force only after confirming the server is stopped and the current
contents are either expendable or separately backed up."
	fi
	if [ "$existing" -gt 0 ]; then
		# Preserve what is being replaced. --force means "I accept the swap", not "destroy the
		# evidence" -- if the restore turns out to be the wrong archive, this is the way back.
		aside="$target.replaced-$(date -u +%Y%m%dT%H%M%SZ)"
		log "moving existing contents aside -> $aside"
		mkdir -p "$aside"
		find "$target" -mindepth 1 -maxdepth 1 -exec mv {} "$aside"/ \;
	fi
else
	mkdir -p "$target"
fi

# --- Extract --------------------------------------------------------------------------------------
log "extracting into $target"
tar -xzf "$archive" -C "$target" || fail "extraction failed; target may be incomplete"

restored=$(find "$target" -mindepth 1 | wc -l | tr -d ' ')
log "restored $restored paths"

cat <<'NEXT'

[dib-restore] Next steps:
  1. Confirm ownership matches the runtime user. In the compose stack the server runs as `node`
     (uid 1000); a restore performed as root leaves root-owned files the server cannot write:
       chown -R 1000:1000 <target>
  2. Start the server:
       docker compose -f deploy/compose.yaml --env-file deploy/.env start game
  3. Confirm the restore actually carried identities forward:
       docker compose -f deploy/compose.yaml exec game node /app/dib-game-server.mjs invite:list
     If this lists nothing, the HMAC secret in use no longer matches the one the snapshot was
     written under. Restoring state does NOT restore identity -- see "Rotating the HMAC secret"
     in docs/deployment.md.
  4. Check readiness: curl -fsS https://<host>/api/game/readiness
NEXT
