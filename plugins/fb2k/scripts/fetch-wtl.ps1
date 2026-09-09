# Fetches WTL into sdk/wtl. Run on the build machine, after fetch-sdk.ps1.
#
# The SDK needs WTL and does not ship it. libPPUI and foobar2000_sdk_helpers include <atlapp.h>, which is WTL's rather than ATL's --
# installing Visual Studio's ATL component gets you atlbase.h and leaves you exactly one error further on.
#
# From a GitHub mirror rather than SourceForge, whose download endpoints answer unreliably, and pinned to a commit because a mirror's master is somebody else's branch to move.
param(
  [string]$Commit = '065ef5597383c1231bd4892cf8e94331b29bdb97',
  [string]$Release = 'WTL10_10320_Final'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$wtl = Join-Path $root 'sdk\wtl'
$archive = Join-Path $env:TEMP "$Release.zip"

if (Test-Path (Join-Path $wtl 'Include\atlapp.h')) {
  Write-Output "WTL already present in $wtl -- delete it to re-fetch."
  exit 0
}

Write-Output "Fetching $Release ..."
$url = "https://raw.githubusercontent.com/Win32-WTL/WTL/$Commit/Releases/$Release.zip"

# curl.exe rather than Invoke-WebRequest, which throws a bare WebException on the redirect.
& curl.exe -sSL --fail -o $archive $url
if ($LASTEXITCODE -ne 0) { throw "Download failed (curl exit $LASTEXITCODE)." }

New-Item -ItemType Directory -Force -Path $wtl | Out-Null
Expand-Archive -Path $archive -DestinationPath $wtl -Force

if (-not (Test-Path (Join-Path $wtl 'Include\atlapp.h'))) {
  throw "atlapp.h not found under $wtl after unpacking -- the archive layout may have changed."
}
Write-Output "WTL unpacked into $wtl"
