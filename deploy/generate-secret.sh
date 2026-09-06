#!/bin/sh
# Generates the authoritative HMAC secret.
#
# WARNING: this secret is the player identity namespace, not just a signing key.
# `playerId = HMAC(secret, loginToken)` (apps/game-server/src/invites.ts), so every stored slot is
# addressed under an identity derived from it. Generate it ONCE per deployment. Replacing it
# orphans all existing player state -- see "Rotating the HMAC secret" in docs/deployment.md.
#
# Usage: deploy/generate-secret.sh /srv/dib/secrets/hmac

set -eu

target="${1:-}"
if [ -z "$target" ]; then
	echo "usage: $0 <output-file>" >&2
	exit 2
fi

if [ -e "$target" ]; then
	echo "refusing to overwrite existing secret: $target" >&2
	echo "an existing secret is load-bearing; see docs/deployment.md before replacing it." >&2
	exit 1
fi

directory=$(dirname "$target")
mkdir -p "$directory"

# Create with restrictive permissions BEFORE writing, so the secret is never briefly world-readable.
old_umask=$(umask)
umask 077
: > "$target"
umask "$old_umask"

# 48 bytes -> 64 base64url characters, comfortably above the 32-byte floor the server enforces.
if command -v openssl >/dev/null 2>&1; then
	openssl rand -base64 48 | tr -d '\n' | tr '+/' '-_' | tr -d '=' > "$target"
else
	head -c 48 /dev/urandom | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=' > "$target"
fi

chmod 600 "$target"

bytes=$(wc -c < "$target" | tr -d ' ')
if [ "$bytes" -lt 32 ]; then
	echo "generated secret is only $bytes bytes; refusing to leave it in place" >&2
	rm -f "$target"
	exit 1
fi

echo "Wrote $bytes-byte secret to $target (mode 600)."
echo "Set DIB_HMAC_SECRET_HOST_PATH=$target in deploy/.env"
echo
echo "Back this file up somewhere separate from the state snapshots."
echo "Losing it makes every existing player slot unreachable."
