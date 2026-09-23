# Builds the test corpus every live script writes to, and a playlist holding all of it.
#
# Never point a tag write at a real music library. The sources are files kept for the purpose, under -Corpus, and this
# copies them into a tree of its own, so everything foo_jean writes goes to a copy.
#
# One each of mp3, flac and m4a on purpose: a rating is an ID3v2 frame, a Vorbis comment and an MP4 atom respectively,
# written by three different code paths inside foobar2000.
#
# The tree is two media library roots and a folder outside both. 'one' and 'two' hold a different recording at the same
# library-relative path, so that address names a track under each and a client has to retry positionally. 'loose' sits
# outside the library, so what is in it has no library-relative address at all and only the positional form reaches it.
#
#   scripts\test-fixtures.ps1 -Corpus D:\path\corpus
param(
  [string]$Corpus = $env:FOO_JEAN_CORPUS_DIR,
  [string]$Dest,
  [string]$Beefweb = 'http://127.0.0.1:8880/api',
  [string]$PlaylistTitle = '#foo_jean test',
  [string]$Foobar2000Dir = $env:FOOBAR2000_DIR
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib\player.ps1"

if (-not $Foobar2000Dir) {
  throw "Set -Foobar2000Dir or the FOOBAR2000_DIR environment variable to the folder holding foobar2000.exe"
}
if (-not $Corpus) {
  throw "Set -Corpus or the FOO_JEAN_CORPUS_DIR environment variable to the folder holding the fixture media"
}
if (-not (Test-Path -LiteralPath $Corpus)) { throw "No corpus folder at $Corpus" }

# A folder of its own beside the player, never inside the music library.
if (-not $Dest) { $Dest = $env:FOO_JEAN_FIXTURE_DIR }
if (-not $Dest) { $Dest = Join-Path (Split-Path -Parent $Foobar2000Dir.TrimEnd('\')) 'foo_jean-test' }

$rootOne = Join-Path $Dest 'one'
$rootTwo = Join-Path $Dest 'two'
$outsideLibrary = Join-Path $Dest 'loose'

$sharedRelativePath = 'shared\ambiguous.flac'

# Built from code points rather than written out, for the reason CONTRIBUTING.md, *PowerShell scripts*, gives.
$accentedName = 'accent' + [char]0x00E9 + '.mp3'

# vorbis-cue.flac is the fixture whose subsongs number from 1, and cue-99-subsongs.flac is the one that looks like a
# cue sheet and is a single track, for the reason ARCHITECTURE.md, *Facts about the player*, gives.
$layout = @(
  [pscustomobject]@{ Source = 'mono.flac'; Target = Join-Path $rootOne $sharedRelativePath }
  [pscustomobject]@{ Source = 'silence.flac'; Target = Join-Path $rootTwo $sharedRelativePath }
  [pscustomobject]@{ Source = 'vorbis-cue.flac'; Target = Join-Path $rootOne 'vorbis-cue.flac' }
  [pscustomobject]@{ Source = 'cue-99-subsongs.flac'; Target = Join-Path $rootOne 'cue-99-subsongs.flac' }
  [pscustomobject]@{ Source = 'silence.m4a'; Target = Join-Path $rootOne 'silence.m4a' }
  [pscustomobject]@{ Source = 'mono.mp3'; Target = Join-Path $rootOne $accentedName }
  [pscustomobject]@{ Source = 'silence.mp3'; Target = Join-Path $outsideLibrary 'silence.mp3' }
)

$missing = @($layout.Source | Sort-Object -Unique | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Corpus $_)) })
if ($missing.Count -gt 0) { throw "The corpus at $Corpus is missing $($missing -join ', ')" }

# beefweb answers 'application/json' with no charset parameter, and PowerShell 5.1 then falls back to ISO-8859-1,
# turning any accented filename into mojibake that no longer names a file on disk. Decode the raw bytes as UTF-8 by hand.
function Get-Json($uri) {
  $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 30
  [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
}

function Copy-Fixture($source, $target) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
  # A copy inherits the read-only flag, and a read-only fixture is a confusing way to discover that a tag write failed.
  Set-ItemProperty -LiteralPath $target -Name IsReadOnly -Value $false
  Write-Output "copied -> $target"
}

foreach ($fixture in $layout) {
  Copy-Fixture (Join-Path $Corpus $fixture.Source) $fixture.Target
}

# Rebuilt from scratch each run, so running this twice does not leave two playlists of the same name with half the fixtures in each.
$existing = @((Get-Json "$Beefweb/playlists").playlists | Where-Object { $_.title -eq $PlaylistTitle })
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

$made = @((Get-Json "$Beefweb/playlists").playlists | Where-Object { $_.title -eq $PlaylistTitle })
Write-Output "playlist $($made[0].id) now holds $($made[0].itemCount) items"

Write-Output ""
Write-Output "Register these two as media library folders in foobar2000:"
Write-Output "  $rootOne"
Write-Output "  $rootTwo"
Write-Output "Leave $outsideLibrary out of the library. What is in it is what has no library-relative address."
