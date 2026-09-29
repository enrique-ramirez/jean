# The tree scripts\test-fixtures.ps1 copies its corpus into, and the only place a tag write may land.
#
# Dot-source it:  . "$PSScriptRoot\lib\fixtures.ps1"

# A folder of its own beside the player, never inside the music library.
function Get-FixtureRoot {
    param(
        [string]$Dest,
        [string]$Foobar2000Dir
    )

    if ($Dest) { return $Dest }
    if ($env:FOO_JEAN_FIXTURE_DIR) { return $env:FOO_JEAN_FIXTURE_DIR }
    if (-not $Foobar2000Dir) {
        throw "Set -Foobar2000Dir or the FOOBAR2000_DIR environment variable, or name the fixture tree through FOO_JEAN_FIXTURE_DIR"
    }
    Join-Path (Split-Path -Parent $Foobar2000Dir.TrimEnd('\')) 'foo_jean-test'
}

function ConvertTo-FullPath([string]$Path) {
    $backslashed = $Path.Replace('/', '\')
    if ($backslashed -notmatch '^([A-Za-z]:\\|\\\\[^\\?.])') { return $null }
    # .NET Framework's GetFullPath throws on a character Windows forbids in a path, which names no file under the root.
    try { [System.IO.Path]::GetFullPath($backslashed).TrimEnd('\') } catch { $null }
}

function Test-PathUnder {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $full = ConvertTo-FullPath $Path
    $base = ConvertTo-FullPath $Root
    if (-not $full -or -not $base) { return $false }
    $full.StartsWith($base + '\', [System.StringComparison]::OrdinalIgnoreCase)
}
