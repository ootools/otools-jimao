# Copy this standalone plugin into the local OTools repo for a manual test run.
# Usage: pwsh -File scripts/deploy-to-otools.ps1 -OtoolsRoot <OTools repo path>
# Note: this writes into the OTools main repo (plugins/<packid>). Run it only when you want to test locally.
param(
  [string]$OtoolsRoot = $env:OTOOLS_ROOT
)

$ErrorActionPreference = "Stop"
if (-not $OtoolsRoot) {
  Write-Error "Pass -OtoolsRoot or set OTOOLS_ROOT to the OTools main repo."
}

$pluginRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $pluginRoot "plugin.json") -Raw | ConvertFrom-Json
$packid = $manifest.packid
if (-not $packid) { Write-Error "plugin.json has no packid" }
$target = Join-Path $OtoolsRoot "plugins\$packid"

if (-not (Test-Path (Join-Path $OtoolsRoot "vendor\otools-plugin-sdk\src\index.ts"))) {
  Write-Error "Not an OTools repo: $OtoolsRoot"
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($item in @("plugin.json", "logo.svg", "dist")) {
  $from = Join-Path $pluginRoot $item
  if (-not (Test-Path $from)) { continue }
  $to = Join-Path $target $item
  if (Test-Path $to) { Remove-Item -LiteralPath $to -Recurse -Force }
  Copy-Item -LiteralPath $from -Destination $target -Recurse -Force
}

Write-Host "Synced to $target"
Write-Host "Reload OTools to see the plugin: $($manifest.displayName)"
