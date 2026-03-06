param(
  [string]$EnvId = "",
  [int]$TimeoutSec = 120,
  [switch]$OpenInProfile
)

$ErrorActionPreference = "SilentlyContinue"

function Test-CdpPort {
  param([int]$Port)
  if ($Port -lt 1 -or $Port -gt 65535) { return $false }
  try {
    $u = "http://127.0.0.1:$Port/json/version"
    $r = Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2
    if (
      $r.StatusCode -ge 200 -and
      $r.StatusCode -lt 300 -and
      $r.Content -match "webSocketDebuggerUrl" -and
      $r.Content -match '"Browser"\s*:'
    ) {
      return $true
    }
  } catch {}
  return $false
}

function Get-PortFromCdpJson {
  param([string]$Path, [string]$TargetEnvId)
  if (!(Test-Path $Path)) { return $null }

  try {
    $raw = Get-Content $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    $obj = $raw | ConvertFrom-Json
    if ($null -eq $obj) { return $null }

    if (![string]::IsNullOrWhiteSpace($TargetEnvId)) {
      $entry = $obj.$TargetEnvId
      if ($entry -and $entry.debugPort) {
        $p = [int]$entry.debugPort
        if (Test-CdpPort -Port $p) { return $p }
      }
    }

    foreach ($prop in $obj.PSObject.Properties) {
      $entry = $prop.Value
      if ($entry -and $entry.debugPort) {
        $p = [int]$entry.debugPort
        if (Test-CdpPort -Port $p) { return $p }
      }
    }
  } catch {}

  return $null
}

function Get-PortFromGinsFallback {
  $gps = Get-Process ginsbrowser -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
  if (!$gps) { return $null }

  $ports = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $gps -contains $_.OwningProcess } |
    Select-Object -ExpandProperty LocalPort -Unique

  foreach ($p in $ports) {
    $pi = [int]$p
    if (Test-CdpPort -Port $pi) { return $pi }
  }
  return $null
}

function Get-ProfileBrowserContext {
  try {
    $proc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ieq "ginsbrowser.exe" -or $_.Name -ieq "chrome.exe" } |
      Select-Object ProcessId,Name,ExecutablePath,CommandLine
    if (!$proc) { return $null }

    $best = $null
    foreach ($p in $proc) {
      $cmd = [string]$p.CommandLine
      if ([string]::IsNullOrWhiteSpace($cmd)) { continue }

      $mUdd = [regex]::Match($cmd, '--user-data-dir(?:=|\s+)(?:"([^"]+)"|''([^'']+)''|([^\s]+))', 'IgnoreCase')
      if (!$mUdd.Success) { continue }
      $udd = ($mUdd.Groups[1].Value, $mUdd.Groups[2].Value, $mUdd.Groups[3].Value | Where-Object { $_ })[0]
      if ([string]::IsNullOrWhiteSpace($udd)) { continue }

      $exe = [string]$p.ExecutablePath
      if ([string]::IsNullOrWhiteSpace($exe)) {
        $mExe = [regex]::Match($cmd, '^"([^"]+\.exe)"', 'IgnoreCase')
        if (!$mExe.Success) { $mExe = [regex]::Match($cmd, '^([^\s"]+\.exe)\b', 'IgnoreCase') }
        if ($mExe.Success) { $exe = $mExe.Groups[1].Value }
      }
      if ([string]::IsNullOrWhiteSpace($exe)) { continue }

      $score = 0
      if ($p.Name -match 'ginsbrowser') { $score += 30 }
      if ($cmd -notmatch '--type=') { $score += 40 }
      if ($cmd -match '--proxy-server') { $score += 10 }

      $candidate = [PSCustomObject]@{
        ExePath = $exe
        UserDataDir = $udd
        Score = $score
      }
      if ($null -eq $best -or $candidate.Score -gt $best.Score) {
        $best = $candidate
      }
    }

    return $best
  } catch {
    return $null
  }
}

function Open-DebugJsonInProfile {
  param([int]$Port)
  $url = "http://127.0.0.1:$Port/json"
  $ctx = Get-ProfileBrowserContext
  if ($ctx -and $ctx.ExePath) {
    try {
      Start-Process -FilePath $ctx.ExePath -ArgumentList @("--user-data-dir=$($ctx.UserDataDir)", "--new-window", $url) | Out-Null
      Write-Output "DEBUG_URL_OPENED=$url"
      return $true
    } catch {}
  }

  try {
    Start-Process $url | Out-Null
    Write-Output "DEBUG_URL_OPENED=$url"
    return $true
  } catch {}

  return $false
}

$cdpPath = Join-Path $env:APPDATA "DICloak\cdp_debug_info.json"
$deadline = (Get-Date).AddSeconds($TimeoutSec)

while ((Get-Date) -lt $deadline) {
  $port = Get-PortFromCdpJson -Path $cdpPath -TargetEnvId $EnvId
  if ($port) {
    Write-Output "DEBUG_PORT=$port"
    if ($OpenInProfile) { [void](Open-DebugJsonInProfile -Port $port) }
    exit 0
  }

  $fallback = Get-PortFromGinsFallback
  if ($fallback) {
    Write-Output "DEBUG_PORT=$fallback"
    if ($OpenInProfile) { [void](Open-DebugJsonInProfile -Port $fallback) }
    exit 0
  }

  Start-Sleep -Milliseconds 800
}

Write-Output "ERROR=NO_DEBUG_PORT_DETECTED"
exit 1
