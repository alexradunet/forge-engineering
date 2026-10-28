#requires -Version 7.0
<#
.SYNOPSIS
  Sets up the forge plugin in VS Code on this machine.
.DESCRIPTION
  The forge plugin carries the rules, skills, and scripts. This
  script does the per-machine parts that a plugin cannot carry:

  1. Sets the user variables FORGE_WIKI_ROOT and FORGE_HOME.
  2. Registers the plugin in VS Code:
       -Mode Local        chat.pluginLocations -> this checkout (live edits)
       -Mode Marketplace  chat.plugins.marketplaces += -MarketplaceRepo
                          (then install "forge" from @agentPlugins)

  Credentials are not part of this script.
  The script is idempotent. Restart VS Code fully after it changes a variable.
.EXAMPLE
  & .\Install-Forge.ps1                       # local checkout, live plugin
  & .\Install-Forge.ps1 -Mode Marketplace -WikiRoot D:\wiki
  & .\Install-Forge.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$WikiRoot,
    [string]$ForgeHome,
    [ValidateSet('Local', 'Marketplace')]
    [string]$Mode,
    # owner/repo of the marketplace. A fork passes its own repository.
    [string]$MarketplaceRepo = 'alexradunet/forge-engineering'
)

$ErrorActionPreference = 'Stop'
$marketplaceRepo = $MarketplaceRepo
$pluginRoot = Split-Path -Parent $PSScriptRoot
$checkoutRoot = Split-Path -Parent (Split-Path -Parent $pluginRoot)
$isCheckout = (Test-Path -LiteralPath (Join-Path $checkoutRoot '.github\plugin\marketplace.json')) -and
    (Test-Path -LiteralPath (Join-Path $checkoutRoot '.git')) -and
    ($checkoutRoot -notmatch '\\(agent-plugins|agentPlugins)\\')

function Write-Step([string]$Text) { Write-Host "• $Text" }

function Get-UserVariable([string]$Name) { [Environment]::GetEnvironmentVariable($Name, 'User') }

function Set-UserVariable([string]$Name, [string]$Value) {
    if ((Get-UserVariable $Name) -eq $Value) { Write-Step "$Name already set"; return }
    if ($PSCmdlet.ShouldProcess("user variable $Name", "set to $Value")) {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
        Set-Item "env:$Name" $Value
        Write-Step "$Name = $Value"
    }
}

# --- 1. Machine paths -------------------------------------------------------
if (-not $ForgeHome) { $ForgeHome = Get-UserVariable 'FORGE_HOME' }
if (-not $ForgeHome -and $isCheckout) { $ForgeHome = $checkoutRoot }
if (-not $ForgeHome) { throw 'Set -ForgeHome to your forge checkout.' }

if (-not $WikiRoot) { $WikiRoot = Get-UserVariable 'FORGE_WIKI_ROOT' }
if (-not $WikiRoot) { throw 'Set -WikiRoot to the folder of your engineering wiki.' }
foreach ($path in @($WikiRoot, $ForgeHome)) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Folder not found: $path" }
}
Set-UserVariable 'FORGE_WIKI_ROOT' $WikiRoot
Set-UserVariable 'FORGE_HOME' $ForgeHome

# --- 2. VS Code registration -------------------------------------------------
if (-not $Mode) { $Mode = if ($isCheckout) { 'Local' } else { 'Marketplace' } }
$settingsPath = Join-Path $env:APPDATA 'Code\User\settings.json'
if (Test-Path -LiteralPath $settingsPath) {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json -AsHashtable
} else {
    $settings = [ordered]@{}
}
$changed = $false
if ($Mode -eq 'Local') {
    if (-not $isCheckout) { throw '-Mode Local needs the plugin inside a forge checkout.' }
    $locations = $settings['chat.pluginLocations'] ?? [ordered]@{}
    if ($locations[$pluginRoot] -ne $true) { $locations[$pluginRoot] = $true; $changed = $true }
    $settings['chat.pluginLocations'] = $locations
    # VS Code keys its plugin copy on the folder time, not on file times.
    # Touch the folder so that the next start copies the edited files.
    if ($PSCmdlet.ShouldProcess($pluginRoot, 'refresh the VS Code plugin copy')) {
        (Get-Item -LiteralPath $pluginRoot).LastWriteTime = Get-Date
        Write-Step 'VS Code: plugin copy refreshes at the next start'
    }
} else {
    $marketplaces = [Collections.Generic.List[string]]@($settings['chat.plugins.marketplaces'] ?? @())
    if (-not $marketplaces.Contains($marketplaceRepo)) { $marketplaces.Add($marketplaceRepo); $changed = $true }
    $settings['chat.plugins.marketplaces'] = $marketplaces.ToArray()
}
if ($changed -and $PSCmdlet.ShouldProcess($settingsPath, "register the forge plugin ($Mode)")) {
    Copy-Item -LiteralPath $settingsPath -Destination "$settingsPath.forge-backup" -Force -ErrorAction SilentlyContinue
    $settings | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $settingsPath -Encoding utf8
    Write-Step "VS Code: plugin registered ($Mode). Backup: $settingsPath.forge-backup"
} elseif (-not $changed) {
    Write-Step "VS Code: plugin already registered ($Mode)"
}
if ($Mode -eq 'Marketplace') {
    Write-Step 'VS Code: open Extensions, search @agentPlugins, and install "forge".'
}

Write-Host ''
Write-Host 'Done. Restart VS Code fully, then run Test-ForgeSetup.ps1.'
