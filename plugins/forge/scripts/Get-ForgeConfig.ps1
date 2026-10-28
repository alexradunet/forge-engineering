#requires -Version 7
<#
.SYNOPSIS
  Returns the forge settings as a hashtable.
.DESCRIPTION
  Machine paths come from user environment variables:
    FORGE_WIKI_ROOT  folder of the wiki (also holds the ticket folders)
    FORGE_HOME       local checkout of your forge fork
  The process value wins. When a process started before Install-Forge.ps1 set
  the variable, the persistent user value is used.

  Team settings come from the Markdown files in the config folder:
  tracker.md, repo.md, ci.md, and policy.md. The config folder is
  <FORGE_HOME>\plugins\forge\config when it exists (the live checkout), else
  the config folder of this plugin copy. The result has these extra keys:
    ConfigDir    the config folder
    Config       tracker, repo, ci, policy: the frontmatter over the defaults.
                 tracker.queries comes from the Queries table and
                 repo.checkouts from the Checkouts table.
    ConfigFiles  the config files that exist
  A missing file gives the defaults. Invalid values throw.
.EXAMPLE
  $wikiRoot = (& "$PSScriptRoot\Get-ForgeConfig.ps1").FORGE_WIKI_ROOT
.EXAMPLE
  (& "$PSScriptRoot\Get-ForgeConfig.ps1").Config.repo.changeName
#>
[CmdletBinding()]
param(
    [string[]]$Required = @('FORGE_WIKI_ROOT'),
    [string]$ConfigDir
)

$result = [ordered]@{}
foreach ($key in @('FORGE_WIKI_ROOT', 'FORGE_HOME')) {
    $value = $null
    foreach ($scope in 'Process', 'User') {
        if (-not $value) { $value = [Environment]::GetEnvironmentVariable($key, $scope) }
    }
    if ($value) { $result[$key] = $value }
}

foreach ($key in $Required) {
    if (-not $result[$key]) {
        throw "$key is not set. Run Install-Forge.ps1 from the forge plugin's scripts folder."
    }
}

if (-not $ConfigDir) {
    $live = if ($result.FORGE_HOME) { Join-Path $result.FORGE_HOME 'plugins\forge\config' }
    $ConfigDir = if ($live -and (Test-Path -LiteralPath $live -PathType Container)) { $live }
                 else { Join-Path (Split-Path -Parent $PSScriptRoot) 'config' }
}

function ConvertFrom-ForgeScalar([string]$Text) {
    $v = $Text.Trim()
    if ($v -eq '' -or $v -eq 'null' -or $v -eq '~') { return $null }
    if ($v -match '^"(.*)"$' -or $v -match "^'(.*)'$") { return $Matches[1] }
    if ($v -eq 'true') { return $true }
    if ($v -eq 'false') { return $false }
    if ($v -match '^-?\d+$') { return [int]$v }
    if ($v -match '^\[(.*)\]$') {
        $inner = $Matches[1].Trim()
        if (-not $inner) { return , @() }
        return , @($inner -split ',' | ForEach-Object { ConvertFrom-ForgeScalar $_ })
    }
    $v
}

# Flat frontmatter only: "key: value", with inline lists [a, b].
function Read-ForgeConfigFile([string]$Path) {
    $text = (Get-Content -LiteralPath $Path -Raw -Encoding UTF8) -replace "`r`n", "`n"
    $data = [ordered]@{}
    $body = $text
    if ($text -match '^\uFEFF?---\n([\s\S]*?)\n---(\n|$)') {
        $body = $text.Substring($Matches[0].Length)
        foreach ($line in $Matches[1] -split "`n") {
            if ($line -match '^\s*(#|$)') { continue }
            if ($line -notmatch '^([A-Za-z][A-Za-z0-9_-]*):(.*)$') {
                throw "${Path}: the frontmatter line ""$line"" is not ""key: value"". forge config uses flat keys only."
            }
            $data[$Matches[1]] = ConvertFrom-ForgeScalar $Matches[2]
        }
    }
    @{ Data = $data; Body = $body }
}

# Rows of the first Markdown table under the heading that contains $Title.
function Read-ForgeTable([string]$Body, [string]$Title) {
    $rows = [Collections.Generic.List[object]]::new()
    $inSection = $false
    $header = $null
    foreach ($line in $Body -split "`n") {
        if ($line -match '^#{1,6}\s') {
            if ($inSection -and $header) { break }
            $inSection = $line -match [regex]::Escape($Title)
            continue
        }
        if (-not $inSection -or $line -notmatch '^\s*\|') { if ($header) { break } else { continue } }
        $cells = @(($line.Trim() -replace '^\||\|$', '') -split '\|' | ForEach-Object { $_.Trim() -replace '^`(.*)`$', '$1' })
        if (-not $header) { $header = $cells; continue }
        if ($cells[0] -match '^:?-+:?$') { continue }
        $row = [ordered]@{}
        for ($i = 0; $i -lt $header.Count; $i++) {
            $row[$header[$i].ToLowerInvariant() -replace 'basebranch', 'baseBranch'] = if ($i -lt $cells.Count -and $cells[$i]) { $cells[$i] } else { $null }
        }
        $rows.Add($row)
    }
    $rows.ToArray()
}

$config = [ordered]@{
    tracker = [ordered]@{ provider = 'other'; queries = [ordered]@{} }
    repo    = [ordered]@{ provider = 'other'; branchPattern = '{KEY}-{slug}'; baseBranch = 'main'; checkouts = @() }
    ci      = [ordered]@{ provider = 'other' }
    policy  = [ordered]@{
        noMergeWeekdays        = @()
        evidenceOnDeployedEnv  = $false
        qaHandover             = $false
        adversarialReviewModel = $null
        maxImplementers        = 6
    }
}

$problems = [Collections.Generic.List[string]]::new()
$files = [Collections.Generic.List[string]]::new()
foreach ($kind in @($config.Keys)) {
    $path = Join-Path $ConfigDir "$kind.md"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $files.Add($path)
    $file = Read-ForgeConfigFile $path
    foreach ($k in $file.Data.Keys) { if ($null -ne $file.Data[$k]) { $config[$kind][$k] = $file.Data[$k] } }
    if ($kind -eq 'tracker') {
        foreach ($row in @(Read-ForgeTable $file.Body 'Queries')) { if ($row.name) { $config.tracker.queries[$row.name] = $row.query } }
    }
    if ($kind -eq 'repo') {
        $config.repo.checkouts = @(Read-ForgeTable $file.Body 'Checkouts' | Where-Object { $_.path })
    }
}

$t = $config.tracker; $r = $config.repo; $p = $config.policy
if ($t.prefix -and "$($t.prefix)" -cnotmatch '^[A-Z][A-Z0-9]*$') { $problems.Add('tracker.md: prefix must be upper case, for example APP') }
if ($t.itemUrl -and "$($t.itemUrl)" -notmatch '^https?://.*\{(KEY|number)\}') { $problems.Add('tracker.md: itemUrl must be http(s) and contain {KEY} or {number}') }
if (-not $r.changeName) { $r.changeName = if ($r.provider -eq 'gitlab') { 'MR' } else { 'PR' } }
if (@('PR', 'MR') -cnotcontains $r.changeName) { $problems.Add('repo.md: changeName must be PR or MR') }
if ("$($r.branchPattern)" -notmatch '\{(KEY|key)\}') { $problems.Add('repo.md: branchPattern must contain {KEY} or {key}') }
$days = 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
foreach ($d in @($p.noMergeWeekdays)) { if ($days -notcontains $d) { $problems.Add("policy.md: noMergeWeekdays has ""$d"", use a day name such as Thursday") } }
if ($p.maxImplementers -isnot [int] -or $p.maxImplementers -lt 1) { $problems.Add('policy.md: maxImplementers must be a whole number of 1 or more') }
foreach ($k in 'evidenceOnDeployedEnv', 'qaHandover') { if ($p[$k] -isnot [bool]) { $problems.Add("policy.md: $k must be true or false") } }
if ($problems.Count) { throw "$ConfigDir`: $($problems -join '; ')" }

$result.ConfigDir = $ConfigDir
$result.Config = $config
$result.ConfigFiles = $files.ToArray()
$result