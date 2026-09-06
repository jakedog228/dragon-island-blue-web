#!/usr/bin/env bash
# Asserts that the Docker build context contains no copyrighted, player-owned, or secret material.
#
# `.dockerignore` is the only thing standing between `docker build` and ~120 MB of decrypted game
# bundle, save files, and the HMAC secret sitting in the repository root. A regression there is
# silent: the build still succeeds, it just ships content it must not. This script makes it loud.
#
# Run from the repository root:  deploy/verify-build-context.sh
#
# Requires Docker (it asks the daemon what it would actually receive, rather than reimplementing
# .dockerignore semantics -- a reimplementation would drift from Docker's real matching rules and
# give false confidence).

set -euo pipefail

cd "$(dirname "$0")/.."

fail_count=0
note() { printf '  %s\n' "$*"; }
problem() { printf 'FAIL: %s\n' "$*" >&2; fail_count=$((fail_count + 1)); }

echo "Verifying Docker build context for $(pwd)"

if ! command -v docker >/dev/null 2>&1; then
	echo "docker not found on PATH; cannot verify the real build context." >&2
	exit 2
fi

# --- Enumerate the context the daemon would actually receive ------------------------------------
# `docker build --call target=...` is not portable across versions, so instead build a throwaway
# image whose only job is to list what arrived. This is the ground truth: it is the same context
# tar the real build gets.
listing=$(mktemp)
dockerfile=$(mktemp)
cleanup() { rm -f "$listing" "$dockerfile"; }
trap cleanup EXIT

cat > "$dockerfile" <<'EOF'
FROM busybox:1.36 AS context-listing
COPY . /context
RUN find /context -type f | sed 's#^/context/##' | sort > /listing.txt
FROM scratch
COPY --from=context-listing /listing.txt /listing.txt
EOF

echo "Building context listing (this transfers the context once)..."
if ! DOCKER_BUILDKIT=1 docker build \
	--quiet \
	--file "$dockerfile" \
	--output "type=local,dest=$(dirname "$listing")" \
	. >/dev/null; then
	echo "context listing build failed" >&2
	exit 1
fi
mv "$(dirname "$listing")/listing.txt" "$listing"

total=$(wc -l < "$listing" | tr -d ' ')
bytes=$(awk '{print}' "$listing" | wc -c | tr -d ' ')
echo "Context contains $total files (listing is $bytes bytes)"

# --- Forbidden paths ----------------------------------------------------------------------------
# Anything matching these is copyrighted, player-owned, or secret. Patterns are matched against the
# context-relative path.
forbidden=(
	'^Payload/'          # decrypted app bundle
	'(^|/)extracted/'    # extracted game resources
	'(^|/)clean_room/'   # clean-room derived packages
	'(^|/)emulation/'
	'(^|/)offline_work/'
	'(^|/)working/'
	'(^|/)_ipa_tmp/'
	'\.ipa$'
	'\.bndb$'
	'savefile'
	'(^|/)hmac\.txt$'
	'(^|/)IMG_'
	'(^|/)\.dib-game-data/'
	'(^|/)\.dib-save-data/'
	'(^|/)\.env$'
	'(^|/)node_modules/'
	'(^|/)\.git/'
)

echo "Checking for forbidden paths..."
for pattern in "${forbidden[@]}"; do
	if matches=$(grep -E "$pattern" "$listing"); then
		problem "build context includes paths matching /$pattern/:"
		echo "$matches" | head -10 | sed 's/^/      /' >&2
		count=$(echo "$matches" | wc -l | tr -d ' ')
		[ "$count" -gt 10 ] && echo "      ... and $((count - 10)) more" >&2
	fi
done

# --- Required paths -----------------------------------------------------------------------------
# An over-aggressive .dockerignore breaks the build in a way that is easy to "fix" by loosening the
# safelist too far, so assert the build inputs are present too.
required=(
	'^package\.json$'
	'^pnpm-lock\.yaml$'
	'^pnpm-workspace\.yaml$'
	'^apps/game-server/src/cli\.ts$'
	'^apps/game-server/build\.mjs$'
	'^apps/web/index\.html$'
	'^apps/web/vite\.config\.ts$'
	'^deploy/Caddyfile$'
)

echo "Checking required build inputs are present..."
for pattern in "${required[@]}"; do
	if ! grep -qE "$pattern" "$listing"; then
		problem "build context is MISSING a required input matching /$pattern/"
	fi
done

# --- Size sanity --------------------------------------------------------------------------------
# A context that suddenly grows by an order of magnitude is the signature of a safelist rule that
# stopped matching. The threshold is generous; it is a tripwire, not a budget.
if [ "$total" -gt 6000 ]; then
	problem "build context has $total files, well past the ~expected size; inspect the listing"
	note "listing kept at: $listing"
	trap - EXIT
fi

echo
if [ "$fail_count" -eq 0 ]; then
	echo "OK: build context is clean ($total files, no content-boundary violations)."
	exit 0
fi

echo "$fail_count check(s) failed. Do NOT build or push an image until .dockerignore is fixed." >&2
exit 1
