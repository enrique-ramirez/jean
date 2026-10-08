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

$cmd = "`"$vcvars`" >nul && msbuild `"$proj`"" +
       " /p:Configuration=$Configuration /p:Platform=$Platform" +
       " /v:minimal /nologo /m"

$output = cmd /c $cmd 2>&1
$failed = $LASTEXITCODE -ne 0

# Matched loosely because rc.exe does not format its errors like the compiler does.
$errors = $output | Select-String -Pattern 'error|fatal' -CaseSensitive:$false
if ($errors) { "--- errors ---"; $errors | Select-Object -First 15 }
else { $output | Select-Object -Last 10 }

if ($failed) { throw "Build failed (exit $LASTEXITCODE)." }

if ((Split-Path -Leaf $proj) -eq 'foo_jean.vcxproj') {
  $dll = Join-Path $root "bin\$Platform\$Configuration\foo_jean.dll"
  $dumpCmd = "`"$vcvars`" >nul && dumpbin /nologo /dependents `"$dll`""
  $dumpOutput = cmd /c $dumpCmd 2>&1
  if ($LASTEXITCODE -ne 0) { throw "dumpbin failed on $dll (exit $LASTEXITCODE)." }
  $forbidden = $dumpOutput | Select-String -Pattern '^\s*(MSVCP140|VCRUNTIME140|ucrtbase|api-ms-win-crt-)' -CaseSensitive:$false
  if ($forbidden) {
    $names = ($forbidden | ForEach-Object { $_.ToString().Trim() }) -join ', '
    throw "foo_jean.dll imports a runtime DLL it must link statically instead: $names"
  }

  if ($Configuration -eq 'Release') {
    $hardeningCmd = "`"$vcvars`" >nul && dumpbin /nologo /headers /loadconfig `"$dll`""
    $hardeningOutput = cmd /c $hardeningCmd 2>&1
    if ($LASTEXITCODE -ne 0) { throw "dumpbin failed on $dll (exit $LASTEXITCODE)." }
    $missing = @()
    if (-not ($hardeningOutput | Select-String -SimpleMatch 'CF instrumented')) { $missing += 'Control Flow Guard (/guard:cf)' }
    if (-not ($hardeningOutput | Select-String -SimpleMatch 'CET compatible')) { $missing += 'CET compatibility (/CETCOMPAT)' }
    if ($missing) { throw "foo_jean.dll was built without $($missing -join ' and '); see Directory.Build.targets." }
  }

  & (Join-Path $PSScriptRoot 'lint.ps1')
}

Write-Output "Build succeeded."
