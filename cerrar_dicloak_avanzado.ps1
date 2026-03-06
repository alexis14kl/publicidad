param(
  [int]$Port = 9333,
  [int]$TimeoutSec = 45,
  [switch]$Quiet
)

$ErrorActionPreference = 'SilentlyContinue'

function Write-Log {
  param([string]$Message)
  if (-not $Quiet) {
    Write-Host $Message
  }
}

function Get-AllProcesses {
  Get-CimInstance Win32_Process |
    Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine
}

function Get-ServiceCandidates {
  Get-CimInstance Win32_Service | Where-Object {
    ($_.Name -match '(?i)dicloak') -or
    ($_.DisplayName -match '(?i)dicloak') -or
    ($_.PathName -match '(?i)\\DICloak\\')
  }
}

function Stop-DicloakServices {
  $services = @(Get-ServiceCandidates)
  foreach ($svc in $services) {
    if ($svc.State -in @('Running', 'Start Pending', 'Stop Pending')) {
      Write-Log ("[KILL] Service: {0}" -f $svc.Name)
      try { Stop-Service -Name $svc.Name -Force -ErrorAction Stop } catch {}
      try { & sc.exe stop $svc.Name | Out-Null } catch {}
    }
  }
}

function Get-SeedPids {
  param([array]$Processes)

  $pathRegex = '(?i)(\\|/)DICloak(\\|/)|\.DICloakCache|\\AppData\\Roaming\\DICloak\\'
  $result = New-Object System.Collections.Generic.List[int]

  foreach ($p in $Processes) {
    $name = [string]$p.Name
    $exePath = [string]$p.ExecutablePath
    $cmd = [string]$p.CommandLine

    $byName = $name -match '^(?i)(DICloak|gost|ginsbrowser|chrome)(\.exe)?$'
    $byPath = ($exePath -match $pathRegex) -or ($cmd -match $pathRegex)
    $byCmdHint = $cmd -match '(?i)\bDICloak\b'

    if ($byName -or $byPath -or $byCmdHint) {
      $result.Add([int]$p.ProcessId) | Out-Null
    }
  }

  @($result | Sort-Object -Unique)
}

function Expand-WithDescendants {
  param(
    [array]$Processes,
    [int[]]$SeedPids
  )

  $childrenByParent = @{}
  foreach ($p in $Processes) {
    $ppid = [int]$p.ParentProcessId
    if (-not $childrenByParent.ContainsKey($ppid)) {
      $childrenByParent[$ppid] = New-Object System.Collections.Generic.List[int]
    }
    $childrenByParent[$ppid].Add([int]$p.ProcessId) | Out-Null
  }

  $seen = New-Object 'System.Collections.Generic.HashSet[int]'
  $queue = New-Object 'System.Collections.Generic.Queue[int]'

  foreach ($pid in $SeedPids) {
    if ($seen.Add([int]$pid)) {
      $queue.Enqueue([int]$pid)
    }
  }

  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($childrenByParent.ContainsKey($current)) {
      foreach ($child in $childrenByParent[$current]) {
        if ($seen.Add([int]$child)) {
          $queue.Enqueue([int]$child)
        }
      }
    }
  }

  @($seen.ToArray() | Sort-Object -Unique)
}

function Kill-Pids {
  param([int[]]$Pids)

  foreach ($pid in $Pids) {
    try {
      Stop-Process -Id $pid -Force -ErrorAction Stop
      Write-Log ("[KILL] PID {0} (Stop-Process)" -f $pid)
    } catch {}

    try {
      & taskkill.exe /F /T /PID $pid > $null 2> $null
      Write-Log ("[KILL] PID {0} (taskkill /T)" -f $pid)
    } catch {}
  }
}

function Get-PortListenerPids {
  param([int]$ListenPort)

  $pids = New-Object System.Collections.Generic.List[int]
  $lines = & netstat.exe -ano -p tcp 2> $null

  foreach ($line in $lines) {
    $tokens = @($line -split '\s+' | Where-Object { $_ -and $_.Trim().Length -gt 0 })
    if ($tokens.Count -lt 5) { continue }

    $proto = $tokens[0]
    $localEndpoint = $tokens[1]
    $state = $tokens[3]
    $pidToken = $tokens[4]

    if ($proto -ne 'TCP') { continue }
    if ($state -ne 'LISTENING') { continue }
    if ($localEndpoint -notmatch ":$ListenPort$") { continue }
    if ($localEndpoint -notmatch '^(127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\])') { continue }
    if ($pidToken -notmatch '^\d+$') { continue }

    $pid = [int]$pidToken
    if ($pid -gt 0) {
      $pids.Add($pid) | Out-Null
    }
  }

  @($pids | Sort-Object -Unique)
}

function Kill-PortListeners {
  param([int]$ListenPort)

  $pids = @(Get-PortListenerPids -ListenPort $ListenPort)
  foreach ($pid in $pids) {
    try {
      Stop-Process -Id $pid -Force -ErrorAction Stop
      Write-Log ("[KILL] Port {0} owner PID {1} (Stop-Process)" -f $ListenPort, $pid)
    } catch {}
    try {
      & taskkill.exe /F /T /PID $pid > $null 2> $null
      Write-Log ("[KILL] Port {0} owner PID {1} (taskkill /T)" -f $ListenPort, $pid)
    } catch {}
  }
}

function Get-Survivors {
  $all = @(Get-AllProcesses)
  $seed = @(Get-SeedPids -Processes $all)
  $expanded = @(Expand-WithDescendants -Processes $all -SeedPids $seed)
  if ($expanded.Count -eq 0) { return @() }

  $byPid = @{}
  foreach ($p in $all) { $byPid[[int]$p.ProcessId] = $p }

  $survivors = New-Object System.Collections.Generic.List[object]
  foreach ($pid in $expanded) {
    if ($byPid.ContainsKey([int]$pid)) {
      $survivors.Add($byPid[[int]$pid]) | Out-Null
    }
  }
  @($survivors)
}

Write-Log ("[INFO] Limpieza avanzada de DICloak iniciada (timeout: {0}s, puerto: {1})" -f $TimeoutSec, $Port)
$deadline = (Get-Date).AddSeconds([Math]::Max($TimeoutSec, 8))
$pass = 0

do {
  $pass++
  Write-Log ("[INFO] Pass {0}" -f $pass)

  Stop-DicloakServices

  $all = @(Get-AllProcesses)
  $seed = @(Get-SeedPids -Processes $all)
  $targets = @(Expand-WithDescendants -Processes $all -SeedPids $seed)
  if ($targets.Count -gt 0) {
    Write-Log ("[INFO] Targets detectados: {0}" -f ($targets -join ', '))
    Kill-Pids -Pids $targets
  }

  Kill-PortListeners -ListenPort $Port

  Start-Sleep -Milliseconds 700

  $survivors = @(Get-Survivors)
  $portOwners = @(Get-PortListenerPids -ListenPort $Port)
  if ($survivors.Count -eq 0 -and $portOwners.Count -eq 0) {
    Write-Log "[OK] Limpieza completa: sin procesos residuales y sin listener en el puerto."
    exit 0
  }
} while ((Get-Date) -lt $deadline)

$finalSurvivors = @(Get-Survivors)
$finalPortOwners = @(Get-PortListenerPids -ListenPort $Port)

Write-Host "[ERROR] No se pudo limpiar por completo DICloak."
if ($finalSurvivors.Count -gt 0) {
  Write-Host "[ERROR] Procesos residuales:"
  $finalSurvivors |
    Select-Object ProcessId, ParentProcessId, Name, ExecutablePath |
    Format-Table -AutoSize | Out-String | Write-Host
}
if ($finalPortOwners.Count -gt 0) {
  Write-Host ("[ERROR] PID(s) escuchando puerto {0}: {1}" -f $Port, ($finalPortOwners -join ', '))
}

exit 1
