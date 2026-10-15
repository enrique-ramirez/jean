# Runs clang-tidy over src/fb2k/, to the checks in .clang-tidy and src/fb2k/.clang-tidy, with the
# defines and include paths src/foo_jean.vcxproj compiles it with. It is the lint against MSVC's
# headers, and the only one that reaches the files in fb2k_unparsed_sources
# (scripts/lib/compile-flags.sh). scripts/lint.sh covers src/core/ and tests/ anywhere, and
# src/fb2k/ on a Mac.
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

$flagsText = Get-Content -LiteralPath (Join-Path $root 'scripts\lib\compile-flags.sh') -Raw
$generatedMatch = [regex]::Match($flagsText, '(?m)^fb2k_generated_sources=\(([^)]*)\)')
if (-not $generatedMatch.Success) { throw "scripts/lib/compile-flags.sh no longer holds a fb2k_generated_sources=( ... ) list." }
$generated = @($generatedMatch.Groups[1].Value -split '\s+' | Where-Object { $_ })

if ($Files.Count -eq 0) {
  $Files = Get-ChildItem (Join-Path $src 'fb2k') -Filter *.cpp |
    Where-Object { $_.Name -notin @('PCH.cpp', 'aac_encoder_mac.cpp') -and $generated -notcontains $_.Name } |
    Sort-Object Name | ForEach-Object FullName
  # The one core file with _WIN32 branches, which no other lint reaches.
  $Files += Join-Path $src 'core\http_server.cpp'
} else {
  $Files = $Files | ForEach-Object {
    $file = if ([IO.Path]::IsPathRooted($_)) { $_ } else { Join-Path $root $_ }
    if (-not (Test-Path -LiteralPath $file)) { throw "No such file: $file" }
    if ($generated -contains (Split-Path -Leaf $file)) {
      Write-Warning "$file was skipped: it is in fb2k_generated_sources in scripts/lib/compile-flags.sh."
    } else {
      $file
    }
  }
  if (-not $Files) { throw "Nothing to lint." }
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
Remove-Item -Recurse -Force -LiteralPath $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $out | Out-Null

# clang-tidy finds MSVC's headers through the INCLUDE that vcvars64.bat sets, so its environment
# is read once and handed to every clang-tidy rather than run again per file.
$vcEnvironment = @{}
foreach ($line in (cmd /c "`"$vcvars`" >nul && set")) {
  $at = $line.IndexOf('=')
  if ($at -gt 0) { $vcEnvironment[$line.Substring(0, $at)] = $line.Substring($at + 1) }
}
if ($LASTEXITCODE -ne 0 -or -not $vcEnvironment.ContainsKey('INCLUDE')) { throw "$vcvars did not set INCLUDE." }

$jobs = [Environment]::ProcessorCount
Write-Output "Linting $($Files.Count) file(s) with $tidy, $jobs at a time."

$runs = for ($index = 0; $index -lt $Files.Count; $index++) {
  $file = $Files[$index]
  $responseFile = Join-Path $out "$index.rsp"
  # --driver-mode=cl goes first after --: clang-tidy otherwise parses what follows as a GNU command
  # line, and /std and /I have no effect (-v shows -std=c++14 and no include path).
  $arguments = @('--quiet', '--warnings-as-errors=*', "`"$file`"", '--', '--driver-mode=cl') + $flags
  # clang-tidy reads a response file GNU-style: a path with backslashes does not resolve.
  Set-Content -LiteralPath $responseFile -Value ($arguments | ForEach-Object { $_ -replace '\\', '/' }) -Encoding Ascii
  [pscustomobject]@{ File = $file; ResponseFile = $responseFile; Log = Join-Path $out "$index.log"; Process = $null }
}

# Each clang-tidy writes to a file of its own through cmd, so nothing it prints reaches this
# console until it has finished: clang-tidy reports progress on stderr, which Windows PowerShell
# turns into errors under a caller that redirects it, and parallel runs would interleave.
function Start-Lint($run) {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $env:ComSpec
  $start.Arguments = "/d /s /c `"`"$tidy`" @`"$($run.ResponseFile)`" > `"$($run.Log)`" 2>&1`""
  $start.UseShellExecute = $false
  foreach ($name in $vcEnvironment.Keys) { $start.EnvironmentVariables[$name] = $vcEnvironment[$name] }
  $run.Process = [System.Diagnostics.Process]::Start($start)
}

$pending = [System.Collections.Generic.Queue[object]]::new()
foreach ($run in $runs) { $pending.Enqueue($run) }
$running = [System.Collections.Generic.List[object]]::new()
while ($pending.Count -gt 0 -or $running.Count -gt 0) {
  while ($pending.Count -gt 0 -and $running.Count -lt $jobs) {
    $run = $pending.Dequeue()
    Start-Lint $run
    $running.Add($run)
  }
  Start-Sleep -Milliseconds 100
  foreach ($run in @($running)) {
    if ($run.Process.HasExited) { [void]$running.Remove($run) }
  }
}

$failed = @($runs | Where-Object { $_.Process.ExitCode -ne 0 })
foreach ($run in $failed) {
  Write-Output "--- $($run.File) (exit $($run.Process.ExitCode)) ---"
  Get-Content -LiteralPath $run.Log
}
if ($failed) { throw "clang-tidy reported findings in $($failed.Count) of $($Files.Count) file(s)." }
Write-Output "clang-tidy is clean."
