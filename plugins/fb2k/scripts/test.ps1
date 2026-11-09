# Builds and runs the test suite on Windows with cl.exe. Needs no WTL, and the foobar2000 SDK only for the AAC encoder: everything else it covers lives in src/core/.
# With the SDK fetched it also compiles src/fb2k/aac_encoder.cpp, so the AAC encoder is tested.
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
. "$PSScriptRoot\lib\version-header.ps1"

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
# -products * is required, or Build Tools installations are not matched and this silently finds nothing.
$vsPath = & $vswhere -products * -latest -property installationPath
if (-not $vsPath) { throw "No Visual Studio installation found. See README." }
$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'

$out = Join-Path $root 'bin\tests'
$opus = Join-Path $root 'third_party\opus'
$ogg = Join-Path $root 'third_party\ogg'
$zlib = Join-Path $root 'third_party\zlib'
$codec = Join-Path $root 'bin\codec'
$codecLib = Join-Path $codec 'codec.lib'
$deflate = Join-Path $root 'bin\zlib'
$zlibLib = Join-Path $deflate 'zlib.lib'
# Only the SDK's headers are needed, not a library: pfc::com_ptr_t is a template.
$sdk = Join-Path $root 'sdk'
$haveSdk = Test-Path (Join-Path $sdk 'foobar2000\SDK\foobar2000.h')

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

function Require-CodecSources {
  if (-not (Test-Path $opus) -or -not (Test-Path $ogg)) {
    throw "libopus and libogg are missing. Run scripts\fetch-opus.ps1"
  }
}

# An archive older than any of its sources is rebuilt from an empty object directory, so a refetch
# that drops a source cannot leave its object behind in the archive.
function Test-ArchiveStale($Archive, $SourceDirs) {
  if (-not (Test-Path $Archive)) { return $true }
  $built = (Get-Item $Archive).LastWriteTime
  $newer = $SourceDirs | ForEach-Object { Get-ChildItem $_ -Recurse -File } |
    Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1
  return [bool]$newer
}

function Build-CodecArchiveIfStale {
  if (-not (Test-ArchiveStale $codecLib @($opus, $ogg))) { return }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $codec
  New-Item -ItemType Directory -Force -Path $codec | Out-Null

  # The demo programs carry their own main(). qext_compare.c includes mini_kfft.c, which has none.
  $sources = @(
    Get-ChildItem (Join-Path $opus 'src') -Filter *.c
    Get-ChildItem (Join-Path $opus 'celt') -Filter *.c
    Get-ChildItem (Join-Path $opus 'silk') -Filter *.c
    Get-ChildItem (Join-Path $opus 'silk\float') -Filter *.c
    Get-ChildItem (Join-Path $ogg 'src') -Filter *.c
  ) | Where-Object { $_.Name -notmatch '(_demo|opus_compare|qext_compare|mini_kfft)\.c$' }

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

function Build-ZlibArchiveIfStale {
  if (-not (Test-ArchiveStale $zlibLib @($zlib))) { return }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $deflate
  New-Item -ItemType Directory -Force -Path $deflate | Out-Null

  $sources = Get-ChildItem $zlib -Filter *.c | ForEach-Object { "`"$($_.FullName)`"" }
  Invoke-Tool -Tool 'cl' -ResponseFile (Join-Path $deflate 'compile.rsp') -Failure 'zlib build failed' -Arguments (@(
      "/c /nologo /O2 /W0 /MD",
      "/Fo:`"$deflate\\`""
    ) + $sources)

  $objects = Get-ChildItem $deflate -Filter *.obj | ForEach-Object { "`"$($_.FullName)`"" }
  Invoke-Tool -Tool 'lib' -ResponseFile (Join-Path $deflate 'archive.rsp') -Failure 'zlib archive failed' -Arguments (
    @("/nologo /OUT:`"$zlibLib`"") + $objects)
}

# scripts/lib/compile-flags.sh is the one list of defines and include paths the suite compiles with,
# so it is read here and spelled the way cl takes it rather than copied.
function Read-CompileFlags {
  $text = Get-Content -LiteralPath (Join-Path $root 'scripts\lib\compile-flags.sh') -Raw
  $list = [regex]::Match($text, '(?ms)^compile_flags=\((.*?)^\)').Groups[1].Value
  if (-not $list) { throw "scripts/lib/compile-flags.sh no longer holds a compile_flags=( ... ) list." }

  $list -split "`n" | ForEach-Object { ($_ -replace '#.*$', '').Trim().Trim('"') } | Where-Object { $_ } | ForEach-Object {
    $flag = $_.Replace('$vendor_include', '-I').Replace('$root', $root)
    if ($flag -eq '-std=c++20') { '/std:c++20' }
    elseif ($flag.StartsWith('-D')) { "/D$($flag.Substring(2))" }
    elseif ($flag.StartsWith('-I')) { "/I`"$($flag.Substring(2))`"" }
    else { throw "scripts/lib/compile-flags.sh holds '$flag', which this script does not know how to hand to cl." }
  }
}

# The flags are copied from src\foo_jean.vcxproj, so a change there is a change here: /permissive- is its ConformanceMode, /DUNICODE its
# CharacterSet, /DNDEBUG its Release configuration (without which the SDK's pfc-lite.h warns), NOMINMAX because the SDK pulls in
# <windows.h>, and the SDK is external so its warnings stay off while ours stay on.
function Build-AacEncoder {
  $obj = Join-Path $out 'fb2k'
  New-Item -ItemType Directory -Force -Path $obj | Out-Null

  Invoke-Tool -Tool 'cl' -ResponseFile (Join-Path $obj 'compile.rsp') -Failure 'AAC encoder build failed' -Arguments @(
    "/c /nologo /EHsc /W3 /MD /Zc:lambda /permissive- /std:c++20 /DNOMINMAX /DUNICODE /D_UNICODE /DNDEBUG",
    "/external:W0 /external:anglebrackets /external:I`"$sdk`" /external:I`"$root\third_party`"",
    "/I`"$root\src`" /I`"$sdk`" /I`"$root`"",
    "/Fo:`"$obj\\`" `"$root\src\fb2k\aac_encoder.cpp`"")
}

function Build-Tests {
  New-Item -ItemType Directory -Force -Path $out | Out-Null

  $sources = @(
    Get-ChildItem (Join-Path $root 'tests') -Filter *.cpp
    Get-ChildItem (Join-Path $root 'tests\support') -Filter *.cpp
    Get-ChildItem (Join-Path $root 'src\core') -Filter *.cpp
  )
  $main = $sources | Where-Object { $_.FullName -eq (Join-Path $root 'tests\main.cpp') }
  $users = $sources | Where-Object { $_.FullName -ne $main.FullName }

  $aacDefine = @()
  $aacLink = @()
  if ($haveSdk) {
    Build-AacEncoder
    $aacDefine = @("/DJEAN_TESTS_HAVE_AAC")
    $aacLink = @("`"$out\fb2k\aac_encoder.obj`"", "ole32.lib")
  }
  else {
    Write-Host "The AAC encoder was left out of this run: the foobar2000 SDK is not fetched (scripts\fetch-sdk.ps1)."
  }

  # /W3 rather than /W4 because these translation units include the vendored headers. /Zc:lambda is MSVC's
  # conforming lambda processor: without it a lambda reading a constexpr local it never captured fails as C3493,
  # which clang accepts and the suite relies on.
  $flags = @("/c /nologo /EHsc /W3 /MD /Zc:lambda") + @(Read-CompileFlags) + $aacDefine

  # cl matches /Yc, /Yu and /FI by the header's spelling, so all three take the same path string.
  $header = Join-Path $root 'tests\support\precompiled.h'
  $pchFlags = "/Fp`"$out\precompiled.pch`" /FI`"$header`""
  $stub = Join-Path $out 'precompiled.cpp'
  Set-Content -LiteralPath $stub -Value '' -Encoding Ascii
  Invoke-Tool -Tool 'cl' -ResponseFile (Join-Path $out 'pch.rsp') -Failure 'Precompiled header build failed' -Arguments (
    $flags + @("/Yc`"$header`" $pchFlags /Fo:`"$out\precompiled.obj`" `"$stub`""))

  # The object directory ends in a doubled backslash: cl needs the trailing separator to treat /Fo: as a directory,
  # and a single one before the closing quote escapes it, failing as "D8036: not allowed with multiple source files".
  Invoke-Tool -Tool 'cl' -ResponseFile (Join-Path $out 'compile.rsp') -Failure 'Test build failed' -Arguments (
    $flags + @("/MP /Yu`"$header`" $pchFlags /Fo:`"$out\\`"") + ($users | ForEach-Object { "`"$($_.FullName)`"" }))
  Invoke-Tool -Tool 'cl' -ResponseFile (Join-Path $out 'main.rsp') -Failure 'Test build failed' -Arguments (
    $flags + @("/Fo:`"$out\\`" `"$($main.FullName)`""))

  $objects = @($sources | ForEach-Object { "`"$out\$($_.BaseName).obj`"" }) + @("`"$out\precompiled.obj`"")
  Invoke-Tool -Tool 'link' -ResponseFile (Join-Path $out 'link.rsp') -Failure 'Test link failed' -Arguments (
    @("/nologo /OUT:`"$exe`"") + $objects + $aacLink + @("`"$codecLib`" `"$zlibLib`" ws2_32.lib"))
}

$exe = Join-Path $out 'foo_jean_tests.exe'

Write-VersionHeader
Require-CodecSources
Build-CodecArchiveIfStale
Build-ZlibArchiveIfStale
Build-Tests

& $exe @DoctestArgs
if ($LASTEXITCODE -ne 0) { throw "Tests failed (exit $LASTEXITCODE)." }
