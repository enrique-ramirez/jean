# Installs the built DLL into a foobar2000 profile. Runs on the player.
#
# foobar2000 flattens the package's x64\ folder on install, so an installed component is
# <profile>\user-components-x64\foo_jean\foo_jean.dll -- which is why this copies the DLL rather than unzipping the package.
#
# foobar2000 must not be running: a loaded component DLL is locked. Pass -StopPlayer to have this ask it to exit first.
# It does not start the player again; see scripts/lib/player.ps1.
param(
  [string]$Foobar2000Dir = $env:FOOBAR2000_DIR,
  [string]$Configuration = 'Release',
  [string]$Platform = 'x64',
  [switch]$StopPlayer
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\lib\player.ps1"

if (-not $Foobar2000Dir) {
  throw "Set -Foobar2000Dir or the FOOBAR2000_DIR environment variable to the folder holding foobar2000.exe"
}
if (-not (Test-Path (Join-Path $Foobar2000Dir 'foobar2000.exe'))) {
  throw "No foobar2000.exe in $Foobar2000Dir"
}

$dll = Join-Path $root "bin\$Platform\$Configuration\foo_jean.dll"
if (-not (Test-Path $dll)) { throw "No DLL at $dll -- run scripts/build.ps1 first." }

# The marker file is how foobar2000 itself decides where its profile lives, so it is how we decide.
if (Test-Path (Join-Path $Foobar2000Dir 'portable_mode_enabled')) {
  $profileDir = Join-Path $Foobar2000Dir 'profile'
} else {
  $profileDir = Join-Path $env:APPDATA 'foobar2000-v2'
}
if (-not (Test-Path $profileDir)) { throw "No profile directory at $profileDir" }

$componentsDir = if ($Platform -eq 'Win32') { 'user-components' } else { "user-components-$Platform" }
$target = Join-Path $profileDir "$componentsDir\foo_jean"

if (Get-Process foobar2000 -EA SilentlyContinue) {
  if (-not $StopPlayer) {
    throw "foobar2000 is running. Close it, or pass -StopPlayer to ask it to exit."
  }
  Write-Output "Asking foobar2000 to exit ..."
  Stop-Player -Foobar2000Dir $Foobar2000Dir
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item $dll (Join-Path $target 'foo_jean.dll') -Force

Write-Output "Installed $((Get-Item $dll).Length) bytes to $target\foo_jean.dll"
Write-Output "Start foobar2000 from the machine itself, or from a scheduled task that runs in the console session."
