<#
.SYNOPSIS
  Copies this repo's two REDnode packages into the game: EDGEmobile and EDGEphone.

.DESCRIPTION
  Mirrors edgemobile/ into <game>\red4ext\plugins\REDnode\apps\edgemobile, keeping the
  mobile apps a player installed in its mobile-apps folder, and edgephone/ (the phone in
  the game) into apps\edgephone. Deploy REDnode first, with its own
  tools\deploy-native.ps1. Close the game first.

.EXAMPLE
  .\tools\deploy.ps1 -GameDir 'E:\SteamLibrary\steamapps\common\Cyberpunk 2077'
#>
param(
    [string] $GameDir = 'C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$package = Join-Path $repo 'edgemobile'
$apps = Join-Path $GameDir 'red4ext\plugins\REDnode\apps'

if (-not (Test-Path $apps)) { throw "REDnode's apps folder is not at $apps. Deploy REDnode first." }

# The package's libraries (ws, qrcode-generator) ship in its node_modules.
if (-not (Test-Path (Join-Path $package 'node_modules\ws'))) {
    Push-Location $package
    try { npm ci --omit=dev } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $package." }
}

$target = Join-Path $apps 'edgemobile'
# /XD keeps installed mobile apps: /MIR would delete folders the repo does not have.
robocopy $package $target /MIR /NFL /NDL /NJH /NJS /NP /XF '*.bak' /XD (Join-Path $package 'mobile-apps') | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying failed (robocopy $LASTEXITCODE)." }
robocopy (Join-Path $package 'mobile-apps') (Join-Path $target 'mobile-apps') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying mobile-apps failed (robocopy $LASTEXITCODE)." }
Write-Output "Deployed EDGEmobile to $target"

$phone = Join-Path $apps 'edgephone'
robocopy (Join-Path $repo 'edgephone') $phone /MIR /NFL /NDL /NJH /NJS /NP /XF '*.bak' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying edgephone failed (robocopy $LASTEXITCODE)." }
Write-Output "Deployed EDGEphone to $phone"
exit 0 # robocopy leaves 1 for "files copied"
