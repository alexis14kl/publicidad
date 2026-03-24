$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
if (-not $root) {
    $root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
}
if (-not $root -or -not (Test-Path $root)) {
    $root = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$launcher = Join-Path $root "iniciar_poller_background.bat"
if (-not (Test-Path $launcher)) {
    throw "No existe el launcher: $launcher"
}

Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$launcher`"" -WindowStyle Hidden
