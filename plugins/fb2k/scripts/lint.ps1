# Runs clang-tidy over src/fb2k/, to the checks in .clang-tidy and src/fb2k/.clang-tidy, with the
# defines and include paths src/foo_jean.vcxproj compiles it with. Only here, because it needs the
# foobar2000 SDK and the Windows SDK; scripts/lint.sh covers src/core/ and tests/ anywhere.
#
#   scripts\lint.ps1                        everything
#   scripts\lint.ps1 src\fb2k\library.cpp   one file
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Files = @()
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$requiredMajor = 23

function Get-Major([string] $Tool) {
  $version = & $Tool --version 2>$null | Select-String -Pattern 'version (\d+)' | Select-Object -First 1
  if ($version) { return [int]$version.Matches[0].Groups[1].Value }
  return $null
}

$candidates = if ($env:CLANG_TIDY) { @($env:CLANG_TIDY) } else {
  @((Join-Path $env:ProgramFiles 'LLVM\bin\clang-tidy.exe'), 'clang-tidy.exe')
}
$tidy = $candidates |
  Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } |
  Where-Object { (Get-Major $_) -eq $requiredMajor } |
  Select-Object -First 1
if (-not $tidy) {
  throw "clang-tidy $requiredMajor not found. 'winget install LLVM.LLVM' installs it; set CLANG_TIDY to point at one elsewhere."
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
# -products * is required, or Build Tools installations are not matched and this silently finds nothing.
$vsPath = & $vswhere -products * -latest -property installationPath
if (-not $vsPath) { throw "No Visual Studio installation found. See README." }
$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'

$src = Join-Path $root 'src'
$sdk = Join-Path $root 'sdk'
if (-not (Test-Path (Join-Path $sdk 'foobar2000'))) { throw "The foobar2000 SDK is missing. Run scripts\fetch-sdk.ps1" }

if ($Files.Count -eq 0) {
  $Files = Get-ChildItem (Join-Path $src 'fb2k') -Filter *.cpp | Where-Object Name -ne 'PCH.cpp' |
    Sort-Object Name | ForEach-Object FullName
  # The one core file with _WIN32 branches, which no other lint reaches.
  $Files += Join-Path $src 'core\http_server.cpp'
} else {
  $Files = $Files | ForEach-Object {
    $file = if ([IO.Path]::IsPathRooted($_)) { $_ } else { Join-Path $root $_ }
    if (-not (Test-Path -LiteralPath $file)) { throw "No such file: $file" }
    $file
  }
}

# /imsvc marks a directory as a system one to clang-tidy, so warnings in the SDK, WTL and the
# vendored libraries stay out of the findings.
$flags = @(
  '/std:c++20', '/EHsc', '/MT',
  '/DUNICODE', '/D_UNICODE', '/DNOMINMAX', '/DCPPHTTPLIB_ZLIB_SUPPORT', '/DNDEBUG', '/D_WINDLL',
  "/I`"$src`"",
  "/imsvc`"$root`"",
  "/imsvc`"$sdk`"",
  "/imsvc`"$(Join-Path $sdk 'foobar2000')`"",
  "/imsvc`"$(Join-Path $sdk 'wtl\Include')`"",
  "/imsvc`"$(Join-Path $root 'third_party\opus\include')`"",
  "/imsvc`"$(Join-Path $root 'third_party\ogg\include')`"",
  "/imsvc`"$(Join-Path $root 'third_party\zlib')`""
)

$out = Join-Path $root 'bin\lint'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$responseFile = Join-Path $out 'clang-tidy.rsp'
# --driver-mode=cl goes first after --: clang-tidy otherwise parses what follows as a GNU command
# line, and /std and /I have no effect (-v shows -std=c++14 and no include path).
$arguments = @('--quiet', '--warnings-as-errors=*') +
  ($Files | ForEach-Object { "`"$_`"" }) + @('--', '--driver-mode=cl') + $flags
# clang-tidy reads a response file GNU-style: a path with backslashes does not resolve.
Set-Content -LiteralPath $responseFile -Value ($arguments | ForEach-Object { $_ -replace '\\', '/' }) -Encoding Ascii

Write-Output "Linting $($Files.Count) file(s) with $tidy. This is slow: every file parses the whole SDK."
# clang-tidy reports progress on stderr, which Windows PowerShell turns into errors under a caller that redirects it.
cmd /c "`"$vcvars`" >nul && `"$tidy`" @`"$responseFile`" 2>&1"
if ($LASTEXITCODE -ne 0) { throw "clang-tidy reported findings (exit $LASTEXITCODE)." }
Write-Output "clang-tidy is clean."
