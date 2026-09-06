#!/bin/sh
# Snapshots the authoritative game state directory.
#
# Safe to run against a LIVE server. Every file in the store is written to a temporary path,
# fsynced, then moved into place with an atomic rename (`atomicWrite` in fileSlotStore.ts and
# `writeRegistry` in invites.ts). A reader therefore always sees either the previous or the next
# complete version of any file, never a partial one. Slots carry no cross-file invariant -- each is
# one player's one slot -- so a snapshot cannot capture a torn record.
#
# The one thing that IS cross-file is `invites.json` versus the slot tree: a player invited during
# the snapshot may or may not appear. That is harmless, because re-inviting is non-destructive.
#
# Usage (host):      DIB_BACKUP_SOURCE=/var/lib/dib-game DIB_BACKUP_DEST=/srv/dib/backups ./backup.sh
# Usage (compose):   run automatically by the `backup` service.
#
# Optional offsite: set DIB_BACKUP_OFFSITE_CMD to a command receiving the archive path as $1, e.g.
#   DIB_BACKUP_OFFSITE_CMD='rclone copy "$1" remote:dib-backups/'

set -eu

source_dir="${DIB_BACKUP_SOURCE:-/var/lib/dib-game}"
dest_dir="${DIB_BACKUP_DEST:-/backups}"
keep_daily="${DIB_BACKUP_KEEP_DAILY:-7}"
keep_weekly="${DIB_BACKUP_KEEP_WEEKLY:-4}"

log() { echo "[dib-backup] $*"; }
fail() { echo "[dib-backup] ERROR: $*" >&2; exit 1; }

[ -d "$source_dir" ] || fail "source directory does not exist: $source_dir"
mkdir -p "$dest_dir" || fail "cannot create destination: $dest_dir"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
weekday=$(date -u +%u)
# ISO weekday 7 (Sunday) is retained on the weekly schedule instead of the daily one.
if [ "$weekday" = "7" ]; then tier="weekly"; else tier="daily"; fi

archive="$dest_dir/dib-game-state-$tier-$timestamp.tar.gz"
manifest="$archive.sha256"
staging="$archive.partial"

cleanup() { rm -f "$staging" "$staging.sha256"; }
trap cleanup EXIT

log "snapshotting $source_dir -> $archive"

# Exclude in-flight temporary files: they are mid-write by definition and are never referenced by a
# committed record, so restoring them would only reintroduce garbage.
if ! tar -czf "$staging" \
	--exclude='*.tmp' \
	-C "$source_dir" . 2>/dev/null; then
	fail "tar failed; leaving no partial archive behind"
fi

# Verify the archive is readable end to end before it is allowed to count as a backup. An
# unverified backup is a guess.
if ! tar -tzf "$staging" >/dev/null 2>&1; then
	fail "archive failed verification immediately after writing: $staging"
fi

entries=$(tar -tzf "$staging" | wc -l | tr -d ' ')
[ "$entries" -gt 0 ] || fail "archive contains no entries; refusing to record an empty backup"

sha=$(sha256sum "$staging" | awk '{print $1}')
mv "$staging" "$archive"
printf '%s  %s\n' "$sha" "$(basename "$archive")" > "$manifest"
trap - EXIT

size=$(wc -c < "$archive" | tr -d ' ')
log "wrote $archive ($size bytes, $entries entries)"
log "sha256 $sha"

# --- Offsite ------------------------------------------------------------------------------------
if [ -n "${DIB_BACKUP_OFFSITE_CMD:-}" ]; then
	log "pushing offsite"
	if sh -c "$DIB_BACKUP_OFFSITE_CMD" _ "$archive" && \
	   sh -c "$DIB_BACKUP_OFFSITE_CMD" _ "$manifest"; then
		log "offsite push succeeded"
	else
		# Do not fail the whole run: the local snapshot is already valid and rotation should still
		# happen. Surface it loudly so monitoring can catch a persistently broken destination.
		log "WARNING: offsite push failed for $archive"
	fi
fi

# --- Rotation -----------------------------------------------------------------------------------
# Rotate only after a verified new archive exists, so a failing backup never erodes history.
rotate() {
	tier_name="$1"
	keep="$2"
	count=$(find "$dest_dir" -maxdepth 1 -name "dib-game-state-$tier_name-*.tar.gz" | wc -l | tr -d ' ')
	[ "$count" -gt "$keep" ] || return 0
	remove=$((count - keep))
	find "$dest_dir" -maxdepth 1 -name "dib-game-state-$tier_name-*.tar.gz" | sort | head -n "$remove" |
	while IFS= read -r old; do
		log "rotating out $(basename "$old")"
		rm -f "$old" "$old.sha256"
	done
}

rotate daily "$keep_daily"
rotate weekly "$keep_weekly"

log "done"
