#!/usr/bin/env bash
# Invoked by azure-deploy.ps1 -PublishMods. Packages never enter the application build context.
set -euo pipefail
app_root="$1"
stage="$2"
hash="$3"
[[ "$app_root" =~ ^/[A-Za-z0-9._/-]+$ && "$app_root" != / && "$app_root" != *..* ]]
[[ "$stage" =~ ^/tmp/dib-mods-[a-f0-9]{32}$ && "$hash" =~ ^[a-f0-9]{64}$ ]]
exec 9>"$app_root/.deploy.lock"
flock -n 9 || { echo 'another deployment is running' >&2; exit 1; }
current="$(readlink -f "$app_root/current")"
test -f "$current/deploy/.env"
root="$app_root/official-mods"
release="$root/releases/$hash"
override="$root/compose.yaml"
candidate="$stage/compose.yaml"
base=(-f "$current/deploy/compose.yaml" --env-file "$current/deploy/.env")
previous=()
if [ -f "$override" ]; then
    cp "$override" "$stage/previous.yaml"
    previous=(-f "$stage/previous.yaml")
fi
compose() { docker compose "${base[@]}" "$@"; }
activated=false
accepted=false
cleanup() {
    status=$?
    trap - EXIT
    if $activated && ! $accepted; then
        echo 'Catalog activation failed; restoring previous configuration' >&2
        if [ -f "$stage/previous.yaml" ]; then
            install -m 0644 "$stage/previous.yaml" "$override.rollback"
            mv -f "$override.rollback" "$override"
        else
            rm -f "$override"
        fi
        compose "${previous[@]}" up -d --no-build --no-deps --wait --wait-timeout 120 game || status=1
    fi
    rm -rf -- "$stage"
    exit "$status"
}
trap cleanup EXIT
actual="$(sha256sum "$stage/catalog.tar.gz" | cut -d ' ' -f 1)"
[[ "$actual" == "$hash" ]] || { echo 'Catalog checksum mismatch' >&2; exit 1; }
# The locally validated snapshot contains only flat regular files. Reject links and nested paths
# before extracting even though SSH and the expected SHA-256 already authenticate the transfer.
python3 - "$stage/catalog.tar.gz" <<'PY'
import re, sys, tarfile
with tarfile.open(sys.argv[1]) as archive:
    for item in archive:
        if item.name == '.' and item.isdir():
            continue
        name = item.name.removeprefix('./')
        if not item.isfile() or not re.fullmatch(r'(?:[a-z0-9-]+(?:\.dibmod|\.listing\.json|\.screenshot-[0-9]+\.png)|SHA256SUMS|publish-manifest\.json)', name):
            raise SystemExit('Unexpected archive member: ' + item.name)
PY
mkdir -p "$root/releases"
if [ ! -d "$release" ]; then
    incoming="$(mktemp -d "$root/releases/.incoming-XXXXXXXX")"
    tar -xzf "$stage/catalog.tar.gz" --no-same-owner -C "$incoming"
    (cd "$incoming" && sha256sum -c SHA256SUMS)
    mv "$incoming" "$release"
fi
(cd "$release" && sha256sum -c SHA256SUMS)
chmod 755 "$root" "$root/releases" "$release"
find "$release" -maxdepth 1 -type f -exec chmod 644 {} +
cat > "$candidate" <<EOF
services:
  game:
    environment:
      DIB_OFFICIAL_MODS_DIR: /srv/official-mods
    volumes:
      - type: bind
        source: $release
        target: /srv/official-mods
        read_only: true
        bind:
          create_host_path: false
EOF
container="$(compose "${previous[@]}" ps -q game)"
running_image="$(docker inspect --format '{{.Image}}' "$container")"
tagged_image="$(docker image inspect dib-game:latest --format '{{.Id}}')"
[[ "$running_image" == "$tagged_image" ]] || { echo 'Running game differs from deployment image tag; resolve before publishing' >&2; exit 1; }
compose -f "$candidate" config --quiet
compose -f "$candidate" run --rm --no-deps game config:check
# Activate only the game service; the shared proxy and its connections are left running.
install -m 0644 "$candidate" "$override.next"
activated=true
mv -f "$override.next" "$override"
compose -f "$override" up -d --no-build --no-deps --wait --wait-timeout 120 game
container="$(compose -f "$override" ps -q game)"
docker exec -i "$container" node --input-type=module - http://127.0.0.1:8788 /srv/official-mods/publish-manifest.json < "$stage/verify-mods.mjs"
accepted=true
echo "Activated official catalog $hash"
echo "Previous catalogs remain under $root/releases for rollback."
