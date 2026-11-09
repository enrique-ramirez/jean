# Writes src\core\version.h from the `info` block of contract\openapi.yaml, the same bytes
# scripts/lib/version-header.sh writes on a Mac. Dot-source it:  . "$PSScriptRoot\lib\version-header.ps1"

$versionHeaderRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$versionHeaderContract = Join-Path (Split-Path -Parent (Split-Path -Parent $versionHeaderRoot)) 'contract\openapi.yaml'

function Get-ContractInfo {
  param([Parameter(Mandatory = $true)][string]$Key)

  $match = Select-String -LiteralPath $versionHeaderContract -Pattern "^  ${Key}: *(.+?) *$" | Select-Object -First 1
  if (-not $match) { throw "contract/openapi.yaml: no '$Key' under info" }
  $match.Matches[0].Groups[1].Value
}

function Write-VersionHeader {
  $header = Join-Path $versionHeaderRoot 'src\core\version.h'
  $name = Get-ContractInfo title
  $version = Get-ContractInfo version
  $api = Get-ContractInfo x-api-version
  if ($api -notmatch '^[0-9]+$') { throw "contract/openapi.yaml: x-api-version is '$api', not an integer" }

  $text = @(
    '// Written from the `info` block of contract/openapi.yaml by scripts/lib/version-header.sh and',
    '// scripts/lib/version-header.ps1 before every build. Gitignored: edit the contract.',
    '#pragma once',
    '',
    'namespace jean {',
    '',
    "constexpr char kComponentName[] = `"$name`";",
    "constexpr char kVersion[] = `"$version`";",
    "constexpr int kApiVersion = $api;",
    '',
    '}  // namespace jean',
    ''
  ) -join "`n"

  # .NET resolves a relative path against the process directory, so the path is absolute, and
  # WriteAllText without an encoding is UTF-8 with no byte order mark.
  if (-not (Test-Path -LiteralPath $header) -or [System.IO.File]::ReadAllText($header) -ne $text) {
    [System.IO.File]::WriteAllText($header, $text)
  }
}
