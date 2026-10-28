#requires -Version 7.0
<#
.SYNOPSIS
  Checks the forge plugin setup on this machine. Read only.
.DESCRIPTION
  Prints one line per check with ok, warn, or fail. Never prints a secret:
  for credential variables it reports only whether they are set.
  Exits 1 when a check fails.
#>
[CmdletBinding()]
param()

$pluginRoot = Split-Path -Parent $PSScriptRoot
$results = [Collections.Generic.List[object]]::new()
function Add-Result([string]$Check, [string]$Status, [string]$Detail) {
    $results.Add([pscustomobject]@{ Status = $Status; Check = $Check; Detail = $Detail })
}

# Machine paths
foreach ($name in 'FORGE_WIKI_ROOT', 'FORGE_HOME') {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if (-not $value) { Add-Result $name 'fail' 'Not set. Run Install-Forge.ps1.' }
    elseif (-not (Test-Path -LiteralPath $value -PathType Container)) { Add-Result $name 'fail' "Folder not found: $value" }
    else { Add-Result $name 'ok' $value }
    if ($value -and [Environment]::GetEnvironmentVariable($name, 'Process') -ne $value) {
        Add-Result "$name (this process)" 'warn' 'Not visible yet. Restart VS Code fully.'
    }
}

# Plugin content
foreach ($relative in 'plugin.json', 'mcp.json', 'com.github.copilot\rules', 'skills') {
    $path = Join-Path $pluginRoot $relative
    if (Test-Path -LiteralPath $path) { Add-Result "plugin:$relative" 'ok' '' } else { Add-Result "plugin:$relative" 'fail' "Missing $path" }
}
foreach ($skill in Get-ChildItem -LiteralPath (Join-Path $pluginRoot 'skills') -Directory) {
    $skillFile = Join-Path $skill.FullName 'SKILL.md'
    $name = if (Test-Path -LiteralPath $skillFile) {
        (Select-String -LiteralPath $skillFile -Pattern '^name:\s*(\S+)' | Select-Object -First 1).Matches.Groups[1].Value
    }
    if ($name -eq $skill.Name) { Add-Result "skill:$($skill.Name)" 'ok' '' }
    else { Add-Result "skill:$($skill.Name)" 'fail' 'SKILL.md missing or its name does not match the folder.' }
}

# Team config (Markdown files in the config folder)
try {
    $loaded = & (Join-Path $PSScriptRoot 'Get-ForgeConfig.ps1') -Required @()
    Add-Result 'config:folder' 'ok' $loaded.ConfigDir
    $cli = @{ github = 'gh'; 'github-actions' = 'gh'; gitlab = 'glab'; 'gitlab-ci' = 'glab'; 'azure-pipelines' = 'az' }
    foreach ($kind in 'tracker', 'repo', 'ci', 'policy') {
        $file = Join-Path $loaded.ConfigDir "$kind.md"
        if (-not (Test-Path -LiteralPath $file)) {
            Add-Result "config:$kind.md" 'warn' "Missing. forge uses the defaults. Copy a file from templates\config\ (see the forge-setup skill)."
            continue
        }
        $provider = $loaded.Config[$kind].provider
        Add-Result "config:$kind.md" 'ok' $(if ($provider) { "provider: $provider" } else { '' })
        $tool = if ($provider) { $cli[$provider] }
        if ($tool -and -not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            Add-Result "config:$kind.md" 'warn' "$tool is not on PATH. The $provider commands need it."
        }
    }
    $checkouts = @($loaded.Config.repo.checkouts)
    if (-not $checkouts.Count) { Add-Result 'config:repo.checkouts' 'warn' 'The Checkouts table in repo.md is empty.' }
    foreach ($checkout in $checkouts) {
        if ($checkout.path -and -not (Test-Path -LiteralPath $checkout.path -PathType Container)) {
            Add-Result "config:checkout:$($checkout.name)" 'warn' "Folder not found: $($checkout.path). Edit the Checkouts table in repo.md."
        } elseif ($checkout.remote -match '^(owner|group)/app$') {
            Add-Result "config:checkout:$($checkout.name)" 'warn' "Remote $($checkout.remote) is the template example. Edit the Checkouts table in repo.md."
        }
    }
} catch { Add-Result 'config' 'fail' $_.Exception.Message }
# VS Code registration
$settingsPath = Join-Path $env:APPDATA 'Code\User\settings.json'
$settings = if (Test-Path -LiteralPath $settingsPath) { Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
$local = $settings['chat.pluginLocations']
$market = @($settings['chat.plugins.marketplaces'])
if ($local -and $local.Keys -contains $pluginRoot -and $local[$pluginRoot]) { Add-Result 'vscode:registration' 'ok' "chat.pluginLocations -> $pluginRoot" }
elseif (@($market -match 'forge-engineering').Count -or $pluginRoot -match '\\agent-plugins\\') { Add-Result 'vscode:registration' 'ok' 'Marketplace install' }
else { Add-Result 'vscode:registration' 'fail' 'The plugin is not registered. Run Install-Forge.ps1.' }
if ($settings['chat.plugins.enabled'] -eq $false) { Add-Result 'vscode:chat.plugins.enabled' 'fail' 'Agent plugins are disabled.' }
if ($local -and $local[$pluginRoot]) {
    # VS Code copies a local plugin only when the plugin folder time changes.
    $folderTime = (Get-Item -LiteralPath $pluginRoot).LastWriteTime
    $newest = Get-ChildItem -LiteralPath $pluginRoot -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest -and $newest.LastWriteTime -gt $folderTime.AddSeconds(2)) {
        Add-Result 'vscode:plugin-copy' 'warn' "$($newest.Name) changed after the last copy. Run Install-Forge.ps1, then restart VS Code."
    } else { Add-Result 'vscode:plugin-copy' 'ok' 'Up to date.' }
}

# Runtime tools
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = (& node --version) -replace '^v', ''
    if ([int]($nodeVersion -split '\.')[0] -ge 20) { Add-Result 'tool:node' 'ok' "v$nodeVersion" }
    else { Add-Result 'tool:node' 'fail' "v$nodeVersion. The ticket board needs Node.js 20 or later." }
} else { Add-Result 'tool:node' 'fail' 'Not on PATH. Install Node.js 20 or later.' }
if (Get-Command pwsh -ErrorAction SilentlyContinue) { Add-Result 'tool:pwsh' 'ok' '' } else { Add-Result 'tool:pwsh' 'fail' 'Not on PATH.' }

$results | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
if ($results.Status -contains 'fail') { exit 1 }
