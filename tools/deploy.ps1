<#
.SYNOPSIS
  Copies the EDGEmobile package into the game, as a REDnode package.

.DESCRIPTION
  Mirrors edgemobile/ into <game>\red4ext\plugins\REDnode\apps\edgemobile, keeping the
  mobile apps a player installed in its mobile-apps folder. Deploy REDnode first, with
  its own tools\deploy-native.ps1. Close the game first.

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

$target = Join-Path $apps 'edgemobile'
# /XD keeps installed mobile apps: /MIR would delete folders the repo does not have.
robocopy $package $target /MIR /NFL /NDL /NJH /NJS /NP /XF '*.bak' /XD (Join-Path $package 'mobile-apps') | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying failed (robocopy $LASTEXITCODE)." }
robocopy (Join-Path $package 'mobile-apps') (Join-Path $target 'mobile-apps') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying mobile-apps failed (robocopy $LASTEXITCODE)." }
Write-Output "Deployed EDGEmobile to $target"
exit 0 # robocopy leaves 1 for "files copied"
