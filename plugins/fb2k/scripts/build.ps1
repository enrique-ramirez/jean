# Builds a project against the foobar2000 SDK, x64 Release by default.
#
# Never pass /p:UseEnv=true: it quietly breaks the resource compiler. WTL reaches the compiler through Directory.Build.targets.
# Never override the compiler flags wholesale: /d2notypeopt is set inside the SDK's project files and is mandatory, or release builds miscompile SDK code.
param(
  [string]$Project = 'sdk\foobar2000\foo_sample\foo_sample.vcxproj',
  [string]$Configuration = 'Release',
  [string]$Platform = 'x64'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
# -products * is required, or Build Tools installations are not matched and this silently finds nothing.
$vsPath = & $vswhere -products * -latest -property installationPath
if (-not $vsPath) { throw "No Visual Studio installation found. See README." }

$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
$wtl = Join-Path $root 'sdk\wtl\Include'
if (-not (Test-Path (Join-Path $wtl 'atlapp.h'))) {
  throw "WTL not found at $wtl -- run scripts/fetch-wtl.ps1 first."
}

$proj = Join-Path $root $Project

# Building the SDK's own foo_sample needs no ui\dist and must not be made to require one.
if ((Split-Path -Leaf $proj) -eq 'foo_jean.vcxproj') {
  & (Join-Path $PSScriptRoot 'embed-ui.ps1')
}

Write-Output "Building $Project ($Configuration|$Platform)"

# PlatformToolset is forced to v143 on the command line: the SDK's projects target v142 and fail MSB8020 under VS 2022 alone.
# Overriding here rather than retargeting keeps sdk/ exactly as downloaded.
$cmd = "`"$vcvars`" >nul && msbuild `"$proj`"" +
       " /p:Configuration=$Configuration /p:Platform=$Platform" +
       " /p:PlatformToolset=v143 /p:WindowsTargetPlatformVersion=10.0" +
       " /v:minimal /nologo /m"

$output = cmd /c $cmd 2>&1
$failed = $LASTEXITCODE -ne 0

# Matched loosely because rc.exe does not format its errors like the compiler does.
$errors = $output | Select-String -Pattern 'error|fatal' -CaseSensitive:$false
if ($errors) { "--- errors ---"; $errors | Select-Object -First 15 }
else { $output | Select-Object -Last 10 }

if ($failed) { throw "Build failed (exit $LASTEXITCODE)." }
Write-Output "Build succeeded."
