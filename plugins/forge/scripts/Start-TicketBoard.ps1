#requires -Version 5.1
<#
.SYNOPSIS
  Starts (or reuses) the local ticket board and prints its URL.
.DESCRIPTION
  The board is a read-only Node server (..\board\server.mjs) on 127.0.0.1. It reads
  the frontmatter of every ticket folder in <wiki>\raw\tickets and pushes changes to
  open pages, so there is nothing to regenerate after a file edit.
  - Reuses a running board on the port. Starts a hidden node process when none runs.
  - -Check validates the ticket frontmatter and exits 1 on problems (no server).
  - -Restart stops the board on the port first (use it after a plugin update).
.EXAMPLE
  .\Start-TicketBoard.ps1                    # board URL
  .\Start-TicketBoard.ps1 -Ticket app-42  # ticket URL
  .\Start-TicketBoard.ps1 -Check -Ticket app-42
  .\Start-TicketBoard.ps1 -Stop
#>
[CmdletBinding()]
param(
    [string]$Ticket,
    [int]$Port = 4517,
    [switch]$Check,
    [switch]$Restart,
    [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$forge = & (Join-Path $PSScriptRoot 'Get-ForgeConfig.ps1')
$wikiRoot = $forge.FORGE_WIKI_ROOT
$configDir = $forge.ConfigDir
$server = Join-Path (Split-Path $PSScriptRoot -Parent) 'board\server.mjs'
if (-not (Test-Path $server)) { throw "Missing $server. Build it: npm run build in <forge-home>\apps\ticket-board." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH. Install Node.js 20 or later.' }
if ([int](((& $node --version) -replace '^v', '') -split '\.')[0] -lt 20) { throw 'The ticket board needs Node.js 20 or later.' }

if ($Check) {
    $nodeArgs = @($server, '--check')
    if ($Ticket) { $nodeArgs += $Ticket }
    & $node @nodeArgs --wiki $wikiRoot --config $configDir
    exit $LASTEXITCODE
}

function Get-Board([int]$p) {
    try { Invoke-RestMethod "http://127.0.0.1:$p/api/health" -TimeoutSec 2 } catch { $null }
}

function Stop-Board([int]$p) {
    $h = Get-Board $p
    if (-not $h -or $h.app -ne 'forge-ticket-board') { return $false }
    $owner = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
    if ($owner) { Stop-Process -Id $owner; Start-Sleep -Milliseconds 300; return $true }
    $false
}

if ($Stop) {
    if (Stop-Board $Port) { Write-Host "Ticket board on port $Port stopped." } else { Write-Host "No ticket board on port $Port." }
    return
}
if ($Restart) { $null = Stop-Board $Port }

$health = Get-Board $Port
if ($health -and ($health.app -ne 'forge-ticket-board' -or $health.wiki -ne $wikiRoot)) {
    throw "Port $Port is in use by another server. Run again with -Port <other>."
}
if (-not $health) {
    $null = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { throw "Port $Port is in use (PID $($_.OwningProcess)). Run again with -Port <other>." }
    Start-Process -FilePath $node -ArgumentList @("`"$server`"", '--wiki', "`"$wikiRoot`"", '--config', "`"$configDir`"", '--port', $Port) -WindowStyle Hidden
    for ($i = 0; $i -lt 25 -and -not $health; $i++) { Start-Sleep -Milliseconds 200; $health = Get-Board $Port }
    if (-not $health) { throw "The ticket board did not start on port $Port. Run: node `"$server`" --wiki `"$wikiRoot`" --port $Port" }
}

$url = "http://127.0.0.1:$Port/"
if ($Ticket) { $url += "#/$($Ticket.ToUpperInvariant())" }
Write-Host "Ticket board: $url"
