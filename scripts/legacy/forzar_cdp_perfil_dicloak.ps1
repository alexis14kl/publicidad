param(
  [string]$EnvId = "",
  [int]$PreferredPort = 9225,
  [int]$TimeoutSec = 60,
  [string]$SerialNumber = "41",
  [switch]$OpenDebugWindow
)

$ErrorActionPreference = "SilentlyContinue"
$Script:RoamingAppData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $HOME "AppData\Roaming" }

function Get-MainGinsProcess {
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -ieq "ginsbrowser.exe" -and
      $_.CommandLine -and
      $_.CommandLine -notmatch "--type="
    } |
    Select-Object ProcessId,Name,CommandLine

  if (!$procs) { return $null }

  # Prioriza procesos con user-data-dir y mayor longitud de cmdline.
  $best = $procs |
    Sort-Object @{
      Expression = { [int]([regex]::IsMatch([string]$_.CommandLine, "--user-data-dir", "IgnoreCase")) }
      Descending = $true
    }, @{
      Expression = { ([string]$_.CommandLine).Length }
      Descending = $true
    } |
    Select-Object -First 1

  return $best
}

function Parse-EnvIdFromCmd {
  param([string]$CommandLine)
  $m = [regex]::Match(
    [string]$CommandLine,
    '\.DICloakCache[\\/](\d{10,})[\\/]ud_\1',
    'IgnoreCase'
  )
  if ($m.Success) { return $m.Groups[1].Value }
  return ""
}

function Parse-ExePathFromCmd {
  param([string]$CommandLine)
  $cmd = [string]$CommandLine
  $m1 = [regex]::Match($cmd, '^"([^"]+\.exe)"', 'IgnoreCase')
  if ($m1.Success) { return $m1.Groups[1].Value }
  $m2 = [regex]::Match($cmd, '^([^\s"]+\.exe)\b', 'IgnoreCase')
  if ($m2.Success) { return $m2.Groups[1].Value }
  return ""
}

function Parse-UserDataDirFromCmd {
  param([string]$CommandLine)
  $m = [regex]::Match(
    [string]$CommandLine,
    '--user-data-dir(?:=|\s+)(?:"([^"]+)"|''([^'']+)''|([^\s]+))',
    'IgnoreCase'
  )
  if (!$m.Success) { return "" }
  foreach ($idx in 1..3) {
    if ($m.Groups[$idx].Value) { return $m.Groups[$idx].Value }
  }
  return ""
}

function Test-CdpPort {
  param([int]$Port)
  if ($Port -lt 1 -or $Port -gt 65535) { return $false }
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300 -and $r.Content -match "webSocketDebuggerUrl") {
      return $true
    }
  } catch {}
  return $false
}

function Get-FreePort {
  param([int]$StartPort = 9225, [int]$Span = 200)
  for ($p = $StartPort; $p -le ($StartPort + $Span); $p++) {
    if (!(Test-CdpPort -Port $p)) {
      $inUse = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -eq $p } |
        Select-Object -First 1
      if (!$inUse) { return $p }
    }
  }
  return $StartPort
}

function Upsert-CdpDebugInfo {
  param(
    [string]$TargetEnvId,
    [int]$Port,
    [string]$WsUrl,
    [int]$Pid,
    [string]$Serial
  )
  $path = Join-Path $Script:RoamingAppData "DICloak\cdp_debug_info.json"
  $obj = @{}

  if (Test-Path $path) {
    try {
      $raw = Get-Content $path -Raw
      if (![string]::IsNullOrWhiteSpace($raw)) {
        $parsed = $raw | ConvertFrom-Json
        if ($parsed) {
          foreach ($prop in $parsed.PSObject.Properties) {
            $obj[$prop.Name] = $prop.Value
          }
        }
      }
    } catch {}
  }

  if ([string]::IsNullOrWhiteSpace($TargetEnvId)) {
    $TargetEnvId = "unknown_env"
  }

  $obj[$TargetEnvId] = [pscustomobject]@{
    debugPort = $Port
    webSocketUrl = $WsUrl
    pid = $Pid
    serialNumber = $Serial
    envId = $TargetEnvId
  }

  $json = $obj | ConvertTo-Json -Depth 8
  $dir = Split-Path -Parent $path
  if ($dir -and !(Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $written = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      Set-Content -Path $path -Value $json -Encoding UTF8 -Force
      $written = $true
      break
    } catch {
      Start-Sleep -Milliseconds 150
    }
  }

  if (!$written) {
    return ""
  }
  return $path
}

function Open-DebugWindowInProfile {
  param(
    [string]$ExePath,
    [string]$UserDataDir,
    [int]$Port
  )
  if ([string]::IsNullOrWhiteSpace($ExePath) -or !(Test-Path $ExePath)) { return $false }
  $url = "http://127.0.0.1:$Port/json"
  try {
    if ($UserDataDir) {
      Start-Process -FilePath $ExePath -ArgumentList @("--user-data-dir=$UserDataDir", "--new-window", $url) | Out-Null
    } else {
      Start-Process -FilePath $ExePath -ArgumentList @("--new-window", $url) | Out-Null
    }
    return $true
  } catch {
    return $false
  }
}

$main = Get-MainGinsProcess
if (!$main) {
  Write-Output "ERROR=NO_MAIN_GINS_PROCESS"
  exit 1
}

$cmd = [string]$main.CommandLine
$envFromCmd = Parse-EnvIdFromCmd -CommandLine $cmd
if ([string]::IsNullOrWhiteSpace($EnvId)) { $EnvId = $envFromCmd }
$exePath = Parse-ExePathFromCmd -CommandLine $cmd
$userDataDir = Parse-UserDataDirFromCmd -CommandLine $cmd

$debugMatch = [regex]::Match($cmd, '--remote-debugging-port(?:=|\s+)(\d{2,5})', 'IgnoreCase')
  if ($debugMatch.Success) {
    $existingPort = [int]$debugMatch.Groups[1].Value
    if (Test-CdpPort -Port $existingPort) {
      $ver = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$existingPort/json/version" -TimeoutSec 3
      $vObj = $ver.Content | ConvertFrom-Json
    $pathOut = Upsert-CdpDebugInfo -TargetEnvId $EnvId -Port $existingPort -WsUrl ([string]$vObj.webSocketDebuggerUrl) -Pid ([int]$main.ProcessId) -Serial $SerialNumber
    if ([string]::IsNullOrWhiteSpace($pathOut)) { $pathOut = Join-Path $Script:RoamingAppData "DICloak\cdp_debug_info.json" }
      Write-Output "DEBUG_PORT=$existingPort"
    Write-Output "CDP_JSON_PATH=$pathOut"
      if ($OpenDebugWindow) {
        [void](Open-DebugWindowInProfile -ExePath $exePath -UserDataDir $userDataDir -Port $existingPort)
        Write-Output "DEBUG_URL_OPENED=http://127.0.0.1:$existingPort/json"
      }
      exit 0
  }
}

$targetPort = Get-FreePort -StartPort $PreferredPort -Span 120

# Reinicia el perfil real con el mismo comando, agregando debug port.
taskkill /F /IM ginsbrowser.exe > $null 2>&1
Start-Sleep -Seconds 1

$baseCmd = $cmd
if ([regex]::IsMatch($baseCmd, '--remote-debugging-port(?:=|\s+)\d+', 'IgnoreCase')) {
  $baseCmd = [regex]::Replace($baseCmd, '--remote-debugging-port(?:=|\s+)\d+', "--remote-debugging-port=$targetPort", 'IgnoreCase')
} else {
  $baseCmd = "$baseCmd --remote-debugging-port=$targetPort"
}

$create = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $baseCmd }
if ($create.ReturnValue -ne 0) {
  Write-Output "ERROR=CREATE_FAILED RC=$($create.ReturnValue)"
  exit 1
}

$newPid = [int]$create.ProcessId
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$ok = $false
while ((Get-Date) -lt $deadline) {
  if (Test-CdpPort -Port $targetPort) {
    $ok = $true
    break
  }
  Start-Sleep -Milliseconds 600
}

if (!$ok) {
  Write-Output "ERROR=DEBUG_PORT_NOT_READY PORT=$targetPort"
  exit 1
}

$version = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$targetPort/json/version" -TimeoutSec 3
$versionObj = $version.Content | ConvertFrom-Json
$ws = [string]$versionObj.webSocketDebuggerUrl
$outPath = Upsert-CdpDebugInfo -TargetEnvId $EnvId -Port $targetPort -WsUrl $ws -Pid $newPid -Serial $SerialNumber
if ([string]::IsNullOrWhiteSpace($outPath)) { $outPath = Join-Path $Script:RoamingAppData "DICloak\cdp_debug_info.json" }

Write-Output "DEBUG_PORT=$targetPort"
Write-Output "DEBUG_WS=$ws"
Write-Output "PID=$newPid"
Write-Output "ENV_ID=$EnvId"
Write-Output "CDP_JSON_PATH=$outPath"

if ($OpenDebugWindow) {
  [void](Open-DebugWindowInProfile -ExePath $exePath -UserDataDir $userDataDir -Port $targetPort)
  Write-Output "DEBUG_URL_OPENED=http://127.0.0.1:$targetPort/json"
}

exit 0
