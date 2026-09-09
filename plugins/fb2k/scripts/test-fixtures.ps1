# Builds a small test corpus for foo_jean and registers it with foobar2000.
#
# Never point a tag write at a real music library. This copies one file per container format into a folder of its own,
# outside the library, and adds the copies to a playlist of their own. Everything foo_jean writes goes to those copies.
#
# One each of mp3, flac and m4a on purpose: a rating is an ID3v2 frame, a Vorbis comment and an MP4 atom respectively,
# written by three different code paths inside foobar2000.
#
# Sources come from a playlist rather than from walking the disk, because beefweb already knows where the music is.
param(
  [string]$Dest,
  [string]$Beefweb = 'http://127.0.0.1:8880/api',
  [string]$SourcePlaylist = 'p2',
  [int]$SourceCount = 375,
  [string]$PlaylistTitle = '#foo_jean test',
  [string]$Foobar2000Dir = $env:FOOBAR2000_DIR
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib\player.ps1"

if (-not $Foobar2000Dir) {
  throw "Set -Foobar2000Dir or the FOOBAR2000_DIR environment variable to the folder holding foobar2000.exe"
}

# A folder of its own beside the player, never inside the music library.
if (-not $Dest) { $Dest = $env:FOO_JEAN_FIXTURE_DIR }
if (-not $Dest) { $Dest = Join-Path (Split-Path -Parent $Foobar2000Dir.TrimEnd('\')) 'foo_jean-test' }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

# beefweb answers 'application/json' with no charset parameter, and PowerShell 5.1 then falls back to ISO-8859-1,
# turning any accented filename into mojibake that no longer names a file on disk. Decode the raw bytes as UTF-8 by hand.
function Get-Json($uri) {
  $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 30
  [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
}

$items = (Get-Json "$Beefweb/playlists/$SourcePlaylist/items/0:$SourceCount`?columns=%path%").playlistItems.items
$paths = $items | ForEach-Object { $_.columns[0] }

$firstPathPerFormat = [ordered]@{}
foreach ($path in $paths) {
  $ext = [System.IO.Path]::GetExtension($path).TrimStart('.').ToLower()
  if (($ext -in 'mp3', 'flac', 'm4a') -and -not $firstPathPerFormat.Contains($ext)) { $firstPathPerFormat[$ext] = $path }
}

function Copy-Fixture($source, $target) {
  Copy-Item -LiteralPath $source -Destination $target -Force
  # A copy inherits the read-only flag, and a read-only fixture is a confusing way to discover that a tag write failed.
  Set-ItemProperty -LiteralPath $target -Name IsReadOnly -Value $false
  Write-Output "copied -> $target"
}

foreach ($ext in $firstPathPerFormat.Keys) {
  Copy-Fixture $firstPathPerFormat[$ext] (Join-Path $Dest "sample.$ext")
}

# A fourth fixture whose filename is not ASCII, because track identity is the path and three files called sample.* exercise none of it.
# The name is taken from the source playlist rather than written literally: PowerShell 5.1 reads a BOM-less .ps1 as Windows-1252,
# so a non-ASCII literal in this file would arrive as mojibake naming a file nobody asked for.
$accented = $paths | Where-Object { $_ -cmatch '[^\x00-\x7F]' } | Select-Object -First 1
if ($accented) {
  Copy-Fixture $accented (Join-Path $Dest ([System.IO.Path]::GetFileName($accented)))
} else {
  Write-Output "no non-ASCII filename in the source playlist; skipping that fixture"
}

# Rebuilt from scratch each run, so running this twice does not leave two playlists of the same name with half the fixtures in each.
$existing = (Get-Json "$Beefweb/playlists").playlists | Where-Object { $_.title -eq $PlaylistTitle }
foreach ($old in $existing) {
  # POST .../playlists/remove/{id}, not DELETE .../playlists/{id}: beefweb answers 405 for the latter.
  Invoke-RestMethod -Uri "$Beefweb/playlists/remove/$($old.id)" -Method Post -TimeoutSec 20 | Out-Null
  Write-Output "removed previous playlist $($old.id)"
}

# setCurrent, because /add below adds to the current playlist.
$body = @{ title = $PlaylistTitle; index = -1; setCurrent = $true } | ConvertTo-Json
$playlist = Invoke-RestMethod -Uri "$Beefweb/playlists/add" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20
Write-Output "created playlist $($playlist.id) '$($playlist.title)'"

# Not POST /api/playlists/{id}/items/add: beefweb refuses paths outside its own music-directory allowlist.
Invoke-PlayerCommand -Foobar2000Dir $Foobar2000Dir -Arguments @('/add', $Dest) `
  -TaskName 'foo_jean_addfiles' -SettleSeconds 8

$made = (Get-Json "$Beefweb/playlists").playlists | Where-Object { $_.title -eq $PlaylistTitle }
Write-Output "playlist $($made.id) now holds $($made.itemCount) items"
