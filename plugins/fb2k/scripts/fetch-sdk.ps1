# Fetches the foobar2000 SDK into sdk/. Run on the build machine.
# Fetched rather than vendored because the SDK's licence does not permit redistributing it.
# The version is a pinned release date: the SDK carries no other version, and a silent bump breaks the build.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib\download.ps1"

$version = '2026-10-01'
$sha = 'D4C55077336FAE81BF8DF0259B5B2748FA45EA84132C656EAD93EB123CBCDC26'

$root = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $root 'sdk'
$archive = Join-Path $env:TEMP "foobar2000-SDK-$version.7z"

if (Test-Path (Join-Path $sdk 'foobar2000')) {
  Write-Output "SDK already present in $sdk -- delete it to re-fetch."
  exit 0
}

Write-Output "Fetching foobar2000 SDK $version ..."
Save-VerifiedDownload -Uri "https://www.foobar2000.org/downloads/SDK-$version.7z" -OutFile $archive -Sha256 $sha

# The SDK ships as .7z, which Expand-Archive cannot read.
$sevenZip = Get-Command 7z.exe -EA SilentlyContinue
if (-not $sevenZip) {
  Write-Output "7-Zip not found; installing it."
  winget install --id 7zip.7zip --accept-package-agreements --accept-source-agreements | Out-Null
  $sevenZip = Get-Command 7z.exe -EA SilentlyContinue
  if (-not $sevenZip) { $sevenZip = @{ Source = "$env:ProgramFiles\7-Zip\7z.exe" } }
}

& $sevenZip.Source x $archive "-o$sdk" -y | Out-Null
Write-Output "SDK unpacked into $sdk"
Get-ChildItem $sdk | Select-Object -ExpandProperty Name
