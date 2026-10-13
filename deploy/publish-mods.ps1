#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9.-]+$')][string]$RemoteHost,
    [ValidatePattern('^[A-Za-z_][A-Za-z0-9_-]*$')][string]$RemoteUser,
    [string]$IdentityFile,
    [ValidatePattern('^/[A-Za-z0-9._/-]+$')][string]$AppRoot,
    [uri]$HealthUrl,
    [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
    } finally { $ErrorActionPreference = $previous }
}
$repo = Split-Path -Parent $PSScriptRoot
$scratchRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$scratch = [IO.Path]::GetFullPath((Join-Path $scratchRoot ('dib-mods-' + [guid]::NewGuid().ToString('N'))))
if (-not $scratch.StartsWith($scratchRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging path' }
Push-Location $repo
try {
    New-Item -ItemType Directory -Path $scratch | Out-Null
    Invoke-Checked pnpm @('mods:examples')
    $snapshot = Join-Path $scratch 'catalog'
    Invoke-Checked pnpm @('--filter', '@dib/game-server', 'exec', 'tsx', '../../deploy/prepare-mods.mts', (Join-Path $repo 'examples/mods/dist/official'), $snapshot)
    $archive = Join-Path $scratch 'catalog.tar.gz'
    Invoke-Checked tar @('-czf', $archive, '-C', $snapshot, '.')
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    Write-Host "Catalog archive SHA-256: $hash"
    if ($DryRun) { Write-Host 'Dry run: catalog built and validated; nothing transferred.'; return }
    $remote = "$RemoteUser@$RemoteHost"
    $ssh = @('-i', $IdentityFile, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes')
    $remoteStage = '/tmp/dib-mods-' + [guid]::NewGuid().ToString('N')
    Invoke-Checked ssh ($ssh + @($remote, "mkdir -m 700 '$remoteStage'"))
    # Git may check text out as CRLF on Windows; remote Bash always receives LF.
    foreach ($name in @('publish-mods.sh', 'verify-mods.mjs')) {
        $text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $name)).Replace("`r`n", "`n")
        [IO.File]::WriteAllText((Join-Path $scratch $name), $text, (New-Object Text.UTF8Encoding($false)))
    }
    Invoke-Checked scp ($ssh + @($archive, (Join-Path $scratch 'publish-mods.sh'), (Join-Path $scratch 'verify-mods.mjs'), "${remote}:${remoteStage}/"))
    Invoke-Checked ssh ($ssh + @('-o', 'ServerAliveInterval=15', $remote, "bash '$remoteStage/publish-mods.sh' '$AppRoot' '$remoteStage' '$hash'"))
    try {
        Invoke-Checked node @((Join-Path $PSScriptRoot 'verify-mods.mjs'), $HealthUrl.GetLeftPart([UriPartial]::Authority), (Join-Path $snapshot 'publish-manifest.json'))
    } catch {
        throw "Catalog $hash is active and passed server-side checks, but public verification failed: $($_.Exception.Message)"
    }
    Write-Host 'Official mod catalog published and verified over public HTTPS.'
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}
