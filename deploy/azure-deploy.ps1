#Requires -Version 5.1

<#
.SYNOPSIS
Deploys the clean committed HEAD to the Dragon Island Blue Azure VM.

.DESCRIPTION
Creates a content-addressed release from `git archive`, transfers it and a temporary Bash driver
over SSH, verifies the archive checksum and Docker build context on the VM, builds both production
images before changing the active release, atomically switches `/opt/dib/current`, starts the
Compose stack, and confirms the public readiness endpoint.

The production `.env`, authoritative state volume, extracted mechanical data, HMAC secret, Caddy
data, and backups are not placed in the archive. The existing `.env` is copied into the new release
on the VM. This script is for redeploying an already-bootstrapped host; it is not a first-deploy
provisioner.

#>

[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [Parameter(Mandatory = $true)]
    [string]$RemoteHost,

    [ValidatePattern('^[A-Za-z_][A-Za-z0-9_-]*$')]
    [Parameter(Mandatory = $true)]
    [string]$RemoteUser,

    [string]$IdentityFile = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),

    [ValidatePattern('^/[A-Za-z0-9._/-]+$')]
    [string]$AppRoot = '/opt/dib',

    [Parameter(Mandatory = $true)]
    [uri]$HealthUrl,

    [switch]$SkipChecks,

    # Publish the curated, operator-owned catalog without rebuilding the application.
    [switch]$PublishMods,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList
    )

    # Windows PowerShell 5.1 turns redirected native stderr into ErrorRecords. Docker/SSH
    # write normal build progress there; only the native exit code decides success.
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $FilePath @ArgumentList
        $nativeExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($nativeExitCode -ne 0) {
        throw "$FilePath failed with exit code $nativeExitCode."
    }
}

function Assert-CommandExists {
    param([Parameter(Mandatory = $true)][string]$Name)

    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command is not available on PATH: $Name"
    }
}

if ($AppRoot -eq '/' -or $AppRoot.Contains('..')) {
    throw "AppRoot must be a specific absolute path without '..': $AppRoot"
}
if ($HealthUrl.Scheme -ne 'https') {
    throw "HealthUrl must use HTTPS: $HealthUrl"
}

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $scriptDirectory '..')).Path
$temporaryDirectory = $null

if ($PublishMods) {
    & (Join-Path $scriptDirectory 'publish-mods.ps1') -RemoteHost $RemoteHost -RemoteUser $RemoteUser `
        -IdentityFile $IdentityFile -AppRoot $AppRoot -HealthUrl $HealthUrl -DryRun:$DryRun
    return
}

Push-Location $repositoryRoot
try {
    Assert-CommandExists git
    Assert-CommandExists pnpm

    if (-not $DryRun) {
        Assert-CommandExists ssh
        Assert-CommandExists scp
        if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
            throw "SSH identity file does not exist: $IdentityFile"
        }
        $IdentityFile = (Resolve-Path -LiteralPath $IdentityFile).Path
    }

    $trackedChanges = @(& git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect the Git worktree.'
    }
    if ($trackedChanges.Count -ne 0) {
        throw "Tracked worktree changes are present. Commit or stash them before deployment.`n$($trackedChanges -join "`n")"
    }

    $revision = (& git rev-parse --short=12 HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[0-9a-f]{12}$') {
        throw 'Unable to resolve a 12-character Git revision for HEAD.'
    }

    Write-Host "Preparing Dragon Island Blue release $revision"

    if (-not $SkipChecks) {
        Invoke-NativeCommand pnpm @('test')
        Invoke-NativeCommand pnpm @('typecheck')
        Invoke-NativeCommand pnpm @('content:boundary')
    }
    else {
        Write-Warning 'Skipping local tests, typechecks, and content-boundary verification.'
    }

    $temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $temporaryDirectory = Join-Path $temporaryBase ("dib-azure-deploy-" + [guid]::NewGuid().ToString('N'))
    $temporaryDirectory = [System.IO.Path]::GetFullPath($temporaryDirectory)
    if (-not $temporaryDirectory.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing unexpected temporary directory: $temporaryDirectory"
    }
    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

    $nonce = [guid]::NewGuid().ToString('N')
    $archiveName = "dib-$revision-$nonce.tar.gz"
    $driverName = "dib-deploy-$revision-$nonce.sh"
    $archivePath = Join-Path $temporaryDirectory $archiveName
    $driverPath = Join-Path $temporaryDirectory $driverName

    Invoke-NativeCommand git @('archive', '--format=tar.gz', "--output=$archivePath", 'HEAD')
    $archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()

    $remoteDriver = @'
#!/usr/bin/env bash
set -euo pipefail

revision="$1"
archive="$2"
app_root="$3"
expected_hash="$4"
driver="${BASH_SOURCE[0]}"

# Serialize catalog activation with application releases. The catalog override lives outside
# release trees and must be carried through preflight, activation, and rollback alike.
exec 9>"$app_root/.deploy.lock"
flock -n 9 || { echo "another deployment is running" >&2; exit 1; }
catalog_args=()
if [ -f "$app_root/official-mods/compose.yaml" ]; then
	catalog_args=(-f "$app_root/official-mods/compose.yaml")
fi
compose() {
	local tree="$1"
	shift
	docker compose -f "$tree/deploy/compose.yaml" --env-file "$tree/deploy/.env" "${catalog_args[@]}" "$@"
}

release="$app_root/releases/$revision"
current="$app_root/current"
audit_directory="$app_root/context-audit-$revision"

cleanup() {
	rm -f -- "$archive" "$driver"
	if [ -d "$audit_directory" ]; then
		rmdir "$audit_directory" 2>/dev/null || true
	fi
}
trap cleanup EXIT

if [[ ! "$revision" =~ ^[0-9a-f]{12}$ ]]; then
	echo "invalid revision: $revision" >&2
	exit 2
fi
if [[ ! "$expected_hash" =~ ^[0-9a-f]{64}$ ]]; then
	echo "invalid expected SHA-256" >&2
	exit 2
fi
if [[ "$app_root" != /* || "$app_root" == "/" || "$app_root" == *".."* ]]; then
	echo "unsafe app root: $app_root" >&2
	exit 2
fi
if [[ "$archive" != /tmp/dib-*.tar.gz ]]; then
	echo "unexpected archive path: $archive" >&2
	exit 2
fi
if [ ! -L "$current" ] || [ ! -f "$current/deploy/.env" ]; then
	echo "current release or its production environment is missing: $current" >&2
	exit 1
fi
if [ -e "$release" ]; then
	echo "release already exists; refusing to overlay it: $release" >&2
	exit 1
fi

actual_hash="$(sha256sum "$archive" | awk '{print $1}')"
if [ "$actual_hash" != "$expected_hash" ]; then
	echo "archive checksum mismatch: expected $expected_hash, got $actual_hash" >&2
	exit 1
fi

mkdir "$release"
tar -xzf "$archive" -C "$release"
test -x "$release/deploy/backup.sh"
test -x "$release/deploy/generate-secret.sh"
bash -n "$release/deploy/verify-build-context.sh"
install -m 0600 "$current/deploy/.env" "$release/deploy/.env"

if [ -e "$audit_directory" ]; then
	echo "audit directory already exists: $audit_directory" >&2
	exit 1
fi
mkdir "$audit_directory"
(
	cd "$release"
	TMPDIR="$audit_directory" bash deploy/verify-build-context.sh
)
rmdir "$audit_directory"

cd "$release"
compose "$release" config --quiet
# Preserve running image identities before the build replaces the mutable Compose tags. A failed
# activation must restore the already-proven images, without rebuilding during an outage.
previous_game_container="$(compose "$current" ps -q game)"
previous_proxy_container="$(compose "$current" ps -q proxy)"
previous_game_image="$(docker inspect --format '{{.Image}}' "$previous_game_container")"
previous_proxy_image="$(docker inspect --format '{{.Image}}' "$previous_proxy_container")"
compose "$release" build
# Validate the real mounted production configuration while the old containers still serve traffic.
compose "$release" run --rm --no-deps game config:check

previous_target="$(readlink "$current")"
next_link="$app_root/.current-$revision"
if [ -e "$next_link" ] || [ -L "$next_link" ]; then
	echo "temporary release link already exists: $next_link" >&2
	exit 1
fi
ln -s "releases/$revision" "$next_link"
mv -Tf "$next_link" "$current"

if ! compose "$release" up -d --no-build; then
	echo "activation failed; restoring $previous_target" >&2
	rollback_link="$app_root/.rollback-$revision"
	ln -s "$previous_target" "$rollback_link"
	mv -Tf "$rollback_link" "$current"
	cd "$current"
	docker tag "$previous_game_image" dib-game:latest
	docker tag "$previous_proxy_image" dib-proxy:latest
	compose "$current" up -d --no-build
	exit 1
fi

echo "activated release $revision"
compose "$release" ps
'@

    $remoteDriver = $remoteDriver.Replace("`r`n", "`n")
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($driverPath, $remoteDriver, $utf8WithoutBom)

    Write-Host "Archive SHA-256: $archiveHash"
    if ($DryRun) {
        Write-Host 'Dry run complete; nothing was transferred or changed on the VM.'
        return
    }

    $remoteTarget = "$RemoteUser@$RemoteHost"
    $remoteArchivePath = "/tmp/$archiveName"
    $remoteDriverPath = "/tmp/$driverName"
    $sshOptions = @(
        '-i', $IdentityFile,
        '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes'
    )

    Invoke-NativeCommand scp ($sshOptions + @($archivePath, $driverPath, "${remoteTarget}:/tmp/"))

    $remoteCommand = "bash '$remoteDriverPath' '$revision' '$remoteArchivePath' '$AppRoot' '$archiveHash'"
    Invoke-NativeCommand ssh ($sshOptions + @('-o', 'ServerAliveInterval=15', $remoteTarget, $remoteCommand))

    $ready = $false
    $lastHealthError = $null
    for ($attempt = 1; $attempt -le 15; $attempt++) {
        try {
            $response = Invoke-RestMethod -Method Get -Uri $HealthUrl -TimeoutSec 10
            if ($response.ready -eq $true) {
                $ready = $true
                break
            }
            $lastHealthError = "Readiness returned without ready=true: $($response | ConvertTo-Json -Compress)"
        }
        catch {
            $lastHealthError = $_.Exception.Message
        }
        Start-Sleep -Seconds 2
    }

    if (-not $ready) {
        throw "Release $revision was activated, but public readiness did not recover: $lastHealthError"
    }

    Write-Host "Deployment complete: $revision"
    Write-Host "Readiness: $HealthUrl"
}
finally {
    Pop-Location
    if ($null -ne $temporaryDirectory -and (Test-Path -LiteralPath $temporaryDirectory)) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
}
