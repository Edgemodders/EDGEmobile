<#
.SYNOPSIS
  Copies this repo's REDnode packages and mobile apps into the game: EDGEmobile, EDGEphone and Chooms!.

.DESCRIPTION
  Mirrors into <game>\red4ext\plugins\REDnode\:
    edgemobile\        -> apps\edgemobile       (the server, the OS, the Connect window)
    edgephone\         -> apps\edgephone        (the phone in the game)
    chooms\rednode\    -> apps\chooms           (Chooms!'s package: its feed, its settings window)
    chooms\mobile\     -> mobile-apps\chooms    (Chooms!'s mobile app)
  Other mobile apps a player installed in mobile-apps\ are left alone. Deploy REDnode first,
  with its own tools\deploy-native.ps1. Close the game first.

.EXAMPLE
  .\tools\deploy.ps1 -GameDir 'E:\SteamLibrary\steamapps\common\Cyberpunk 2077'
#>
param(
    [string] $GameDir = 'C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$package = Join-Path $repo 'edgemobile'
$root = Join-Path $GameDir 'red4ext\plugins\REDnode'
$apps = Join-Path $root 'apps'

if (-not (Test-Path $apps)) { throw "REDnode's apps folder is not at $apps. Deploy REDnode first." }
if (Get-Process Cyberpunk2077 -ErrorAction SilentlyContinue) { throw 'Close the game first.' }

# The package's libraries (ws, qrcode-generator) ship in its node_modules.
if (-not (Test-Path (Join-Path $package 'node_modules\ws'))) {
    Push-Location $package
    try { npm ci --omit=dev } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $package." }
}

function Mirror([string] $from, [string] $to, [string] $name) {
    robocopy $from $to /MIR /NFL /NDL /NJH /NJS /NP /XF '*.bak' | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying $name failed (robocopy $LASTEXITCODE)." }
    Write-Output "Deployed $name to $to"
}

Mirror $package (Join-Path $apps 'edgemobile') 'EDGEmobile'
Mirror (Join-Path $repo 'edgephone') (Join-Path $apps 'edgephone') 'EDGEphone'
Mirror (Join-Path $repo 'chooms\rednode') (Join-Path $apps 'chooms') "Chooms!'s package"
Mirror (Join-Path $repo 'chooms\mobile') (Join-Path $root 'mobile-apps\chooms') "Chooms!'s mobile app"
exit 0 # robocopy leaves 1 for "files copied"
