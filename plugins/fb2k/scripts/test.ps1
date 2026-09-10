# Builds and runs the test suite on Windows with cl.exe. Needs neither the foobar2000 SDK nor WTL: everything it covers lives in src/core/.
#
#   scripts/test.ps1                        everything
#   scripts/test.ps1 "-sf=*cors_test.cpp"   one file
#
# doctest's source-file filter is -sf and needs the glob. -ts is test *suite*, matches nothing here and reports success.
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$DoctestArgs = @()
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent (Split-Path -Parent $root)

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
# -products * is required, or Build Tools installations are not matched and this silently finds nothing.
$vsPath = & $vswhere -products * -latest -property installationPath
if (-not $vsPath) { throw "No Visual Studio installation found. See README." }
$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'

$out = Join-Path $root 'bin\tests'
$opus = Join-Path $root 'third_party\opus'
$ogg = Join-Path $root 'third_party\ogg'
$codec = Join-Path $root 'bin\codec'
$codecLib = Join-Path $codec 'codec.lib'

# cl's command line runs past the limit long before this many sources fit on it.
function Invoke-Tool {
  param([string] $Tool, [string[]] $Arguments, [string] $ResponseFile, [string] $Failure)

  Set-Content -LiteralPath $ResponseFile -Value $Arguments -Encoding Ascii
  $output = cmd /c "`"$vcvars`" >nul && $Tool @`"$ResponseFile`"" 2>&1
  if ($LASTEXITCODE -ne 0) {
    $output | Select-String -Pattern 'error' -CaseSensitive:$false | Select-Object -First 20
    throw "$Failure (exit $LASTEXITCODE)."
  }
}

function Assert-OpenApiVersionMatchesCode {
  $specVersion = (Select-String -Path (Join-Path $repo 'contract\openapi.yaml') -Pattern '^  version: *(.+)$' |
    Select-Object -First 1).Matches[0].Groups[1].Value.Trim()
  $codeVersion = (Select-String -Path (Join-Path $root 'src\core\version.h') -Pattern 'kVersion\[\] *= *"([^"]*)"' |
    Select-Object -First 1).Matches[0].Groups[1].Value

  if ($specVersion -ne $codeVersion) {
    throw "contract/openapi.yaml says version '$specVersion'; plugins/fb2k/src/core/version.h says '$codeVersion'"
  }
}

function Require-CodecSources {
  if (-not (Test-Path $opus) -or -not (Test-Path $ogg)) {
    throw "libopus and libogg are missing. Run scripts\fetch-opus.ps1"
  }
}

function Build-CodecArchiveIfMissing {
  if (Test-Path $codecLib) { return }
  New-Item -ItemType Directory -Force -Path $codec | Out-Null

  # The demo programs carry their own main().
  $sources = @(
    Get-ChildItem (Join-Path $opus 'src') -Filter *.c
    Get-ChildItem (Join-Path $opus 'celt') -Filter *.c
    Get-ChildItem (Join-Path $opus 'silk') -Filter *.c
    Get-ChildItem (Join-Path $opus 'silk\float') -Filter *.c
    Get-ChildItem (Join-Path $ogg 'src') -Filter *.c
  ) | Where-Object { $_.Name -notmatch '(_demo|opus_compare)\.c$' }

  # Every object lands in one directory, so two sources sharing a basename would silently
  # overwrite each other and the archive would be missing whichever compiled first.
  $collision = $sources | Group-Object Name | Where-Object { $_.Count -gt 1 } | Select-Object -First 1
  if ($collision) { throw "Two codec sources are both named $($collision.Name); they cannot share an object directory." }

  # /MD to match the C++ side, or the two disagree about the CRT at link time.
  Invoke-Tool -Tool 'cl' -ResponseFile (Join-Path $codec 'compile.rsp') -Failure 'Codec build failed' -Arguments (@(
      "/c /nologo /O2 /W0 /MD /DOPUS_BUILD /DUSE_ALLOCA /DHAVE_LRINTF",
      "/I`"$opus`" /I`"$opus\include`" /I`"$opus\celt`" /I`"$opus\silk`" /I`"$opus\silk\float`" /I`"$ogg\include`"",
      "/Fo:`"$codec\\`""
    ) + ($sources | ForEach-Object { "`"$($_.FullName)`"" }))

  $objects = Get-ChildItem $codec -Filter *.obj | ForEach-Object { "`"$($_.FullName)`"" }
  Invoke-Tool -Tool 'lib' -ResponseFile (Join-Path $codec 'archive.rsp') -Failure 'Codec archive failed' -Arguments (
    @("/nologo /OUT:`"$codecLib`"") + $objects)
}

function Build-Tests {
  New-Item -ItemType Directory -Force -Path $out | Out-Null

  $sources = @(
    Get-ChildItem (Join-Path $root 'tests') -Filter *.cpp
    Get-ChildItem (Join-Path $root 'tests\support') -Filter *.cpp
    Get-ChildItem (Join-Path $root 'src\core') -Filter *.cpp
  ) | ForEach-Object { "`"$($_.FullName)`"" }

  # /W3 rather than /W4 because these translation units include the vendored headers.
  # The object directory ends in a doubled backslash: cl needs the trailing separator to treat /Fo: as a directory,
  # and a single one before the closing quote escapes it, failing as "D8036: not allowed with multiple source files".
  Invoke-Tool -Tool 'cl' -ResponseFile (Join-Path $out 'compile.rsp') -Failure 'Test build failed' -Arguments (@(
      "/nologo /std:c++17 /EHsc /W3 /MD",
      "/I`"$root`" /I`"$root\src`" /I`"$root\tests`" /I`"$opus\include`" /I`"$ogg\include`""
    ) + $sources + @(
      "/Fe:`"$exe`" /Fo:`"$out\\`" `"$codecLib`" ws2_32.lib"))
}

$exe = Join-Path $out 'foo_jean_tests.exe'

Assert-OpenApiVersionMatchesCode
Require-CodecSources
Build-CodecArchiveIfMissing
Build-Tests

& $exe @DoctestArgs
if ($LASTEXITCODE -ne 0) { throw "Tests failed (exit $LASTEXITCODE)." }
