# Fetches WTL into sdk/wtl. Run on the build machine, after fetch-sdk.ps1.
#
# The SDK needs WTL and does not ship it. libPPUI and foobar2000_sdk_helpers include <atlapp.h>, which is WTL's rather than ATL's --
# installing Visual Studio's ATL component gets you atlbase.h and leaves you exactly one error further on.
#
# From a GitHub mirror rather than SourceForge, whose download endpoints answer unreliably, and pinned to a commit because a mirror's master is somebody else's branch to move.
param(
  [string]$Commit = '065ef5597383c1231bd4892cf8e94331b29bdb97',
  [string]$Release = 'WTL10_10320_Final',
  [string]$Sha = '13DE5CD7ED41454B8F287E9BCC4525234C6AC8C85905E4D4FE1A0776709FD78F'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib\download.ps1"

$root = Split-Path -Parent $PSScriptRoot
$wtl = Join-Path $root 'sdk\wtl'
$archive = Join-Path $env:TEMP "$Release.zip"

$record = "$Commit $Release $($Sha.ToLower())"
$recordFile = Join-Path $wtl '.fetched'
if ((Test-Path $recordFile) -and ((Get-Content -LiteralPath $recordFile -Raw).Trim() -ceq $record)) {
  Write-Output "$Release is current"
  exit 0
}

Write-Output "Fetching $Release ..."
$url = "https://raw.githubusercontent.com/Win32-WTL/WTL/$Commit/Releases/$Release.zip"

Save-VerifiedDownload -Uri $url -OutFile $archive -Sha256 $Sha

# The archive is verified, so the old copy goes only now.
if (Test-Path $wtl) { Remove-Item -Recurse -Force $wtl }
New-Item -ItemType Directory -Force -Path $wtl | Out-Null
Expand-Archive -Path $archive -DestinationPath $wtl -Force

# Expand-Archive restores the release's file times; the SDK libraries built against the last copy
# must see this one as newer.
$now = Get-Date
Get-ChildItem -LiteralPath $wtl -Recurse -Force | ForEach-Object { $_.LastWriteTime = $now }

if (-not (Test-Path (Join-Path $wtl 'Include\atlapp.h'))) {
  throw "atlapp.h not found under $wtl after unpacking -- the archive layout may have changed."
}
# A bare LF, byte-identical to the records the other fetchers write.
[System.IO.File]::WriteAllText($recordFile, "$record`n")
Write-Output "WTL unpacked into $wtl"
