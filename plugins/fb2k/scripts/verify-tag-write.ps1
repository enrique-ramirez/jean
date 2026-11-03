# Writes a rating to every file in the test playlist through foo_jean, reads each one back from the player, then puts back
# whatever rating each file held before, removing the tag from a file that had none.
# Run on the disposable install scripts\test-fixtures.ps1 built, never on the player.
#
# The read-back is the assertion: the failure this component exists to avoid is a write the player performed but its own
# database did not learn about, and a playlist row's %rating% column is evaluated against that database, so it is the read
# that tells the two apart. The stream row in the playlist has no file to write and is left out.
#
# Each row is addressed the way a client addresses it, so that what this script exercises is what ships.
#
#   scripts\verify-tag-write.ps1
#   scripts\verify-tag-write.ps1 -Rating 5
#   scripts\verify-tag-write.ps1 -FixtureDir D:\path\foo_jean-test
param(
  [string]$FooJean = 'http://127.0.0.1:8881/api',
  [string]$PlaylistTitle = '#foo_jean test',
  [string]$Rating = '3',
  # A guard, not a limit: if this is ever pointed at a playlist holding a real library, the item count gives it away before anything is written.
  [int]$MaxItems = 20,
  # The -Dest scripts\test-fixtures.ps1 was given, if it was given one.
  [string]$FixtureDir,
  [string]$Foobar2000Dir = $env:FOOBAR2000_DIR
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib\fixtures.ps1"
. "$PSScriptRoot\lib\http.ps1"

$fixtureRoot = Get-FixtureRoot -Dest $FixtureDir -Foobar2000Dir $Foobar2000Dir

$matching = @((Get-Json "$FooJean/playlists").playlists | Where-Object { $_.title -eq $PlaylistTitle })
if ($matching.Count -eq 0) { throw "No playlist titled '$PlaylistTitle'. Run scripts\test-fixtures.ps1 first." }
if ($matching.Count -ne 1) {
  throw "foo_jean reports $($matching.Count) playlists titled '$PlaylistTitle'; the write needs exactly one to address rows in."
}
$fooJeanPlaylist = $matching[0]
if ($fooJeanPlaylist.itemCount -gt $MaxItems) {
  throw "Playlist '$PlaylistTitle' holds $($fooJeanPlaylist.itemCount) items, which is more than -MaxItems ($MaxItems). Refusing: this script writes tags."
}

function Get-Rows {
  $columns = ('%path%', '%codec%', '%rating%' | ForEach-Object { 'columns=' + [System.Uri]::EscapeDataString($_) }) -join '&'
  $page = Get-Json "$FooJean/playlists/$($fooJeanPlaylist.id)/items?offset=0&count=$MaxItems&$columns"
  $rows = @($page.items)
  for ($index = 0; $index -lt $rows.Count; $index++) {
    [pscustomobject]@{
      Path = $rows[$index].columns[0]
      Codec = $rows[$index].columns[1]
      Rating = $rows[$index].columns[2]
      LibraryPath = $rows[$index].libraryPath
      Subsong = [int]$rows[$index].subsong
      Index = $index
      Structure = $page.structure
    }
  }
}

function Get-Fixtures { Get-Rows | Where-Object { $_.Path -notmatch '^https?://' } }

function Get-Address($target) {
  if ($target.LibraryPath) {
    $address = @{ track = $target.LibraryPath }
    if ($target.Subsong -gt 0) { $address.subsong = $target.Subsong }
    return $address
  }
  return @{ playlist = $fooJeanPlaylist.id; index = $target.Index; structure = $target.Structure }
}

# foo_jean answers '?' for a field the file does not carry, and POST /api/tags removes a field sent as an empty string.
function Get-StoredRating($row) {
  if ($row.Rating -eq '?') { return '' }
  return $row.Rating
}

function Send-Rating($target, $value) {
  $address = Get-Address $target
  Send-Address $target $address $value
  # foo_jean answers 409 for a library address two media library roots both hold, and writes nothing.
  if ($script:lastStatus -eq 409 -and $address.track) {
    Send-Address $target @{ playlist = $fooJeanPlaylist.id; index = $target.Index; structure = $target.Structure } $value
  }
}

function Send-Address($target, $address, $value) {
  $body = ($address + @{ fields = @{ rating = $value } }) | ConvertTo-Json -Compress
  # UTF-8 bytes rather than a string: the default is ISO-8859-1 on the way out too, which would corrupt an accented address before foo_jean saw it.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $detail = $null

  try {
    $resp = Invoke-WebRequest -Uri "$FooJean/tags" -Method Post `
      -Body $bytes -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60
    $status = $resp.StatusCode
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $detail = $_.ErrorDetails.Message
  }
  $script:lastStatus = $status

  Write-Output "  POST $status  $($target.Codec.PadRight(5)) $([System.IO.Path]::GetFileName($target.Path))"
  Write-Output "        sent  $body"
  if ($detail) { Write-Output "        reply $detail" }
}

function Show-Row($ok, $track, $was) {
  $mark = if ($ok) { 'ok  ' } else { 'FAIL' }
  Write-Output "  $mark $($track.Codec.PadRight(5)) $was -> $($track.Rating)   $([System.IO.Path]::GetFileName($track.Path))"
}

$before = @(Get-Fixtures)
$strays = @($before | Where-Object { -not (Test-PathUnder -Path $_.Path -Root $fixtureRoot) })
if ($strays.Count -gt 0) {
  throw "$($strays.Count) of $($before.Count) rows in '$PlaylistTitle' sit outside $fixtureRoot, refusing to write any of them. First: $($strays[0].Path)"
}

# foo_jean resolves a library address against its media library snapshot, and builds none until a client declares
# columns, so on a player no client has asked since it started every library address answers 404. One that exists is
# left as declared.
if (-not (Get-Json "$FooJean/state").library.ready) {
  Write-Output "No media library snapshot yet; asking foo_jean to build one"
  $declaration = @{ columns = @('%rating%'); structure = '0'; ordinals = @(0) } | ConvertTo-Json -Compress
  Invoke-WebRequest -Uri "$FooJean/library/rows" -Method Post -Body $declaration -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 | Out-Null
  $deadline = (Get-Date).AddSeconds(120)
  while (-not (Get-Json "$FooJean/state").library.ready) {
    if ((Get-Date) -gt $deadline) { throw "foo_jean built no media library snapshot within 120s" }
    Start-Sleep -Milliseconds 500
  }
}

$failures = 0
$unrestored = 0
try {
  Write-Output "Writing rating=$Rating to $($before.Count) tracks in '$PlaylistTitle'"
  foreach ($target in $before) { Send-Rating $target $Rating }

  $after = @(Get-Fixtures)
  Write-Output ""
  Write-Output "Read back from the player:"
  foreach ($track in $after) {
    $was = ($before | Where-Object { $_.Index -eq $track.Index }).Rating
    $ok = $track.Rating -eq $Rating
    if (-not $ok) { $failures++ }
    Show-Row $ok $track $was
  }
}
finally {
  Write-Output ""
  Write-Output "Putting back the rating each track held:"
  foreach ($target in $before) { Send-Rating $target (Get-StoredRating $target) }

  foreach ($track in @(Get-Fixtures)) {
    $original = $before | Where-Object { $_.Index -eq $track.Index }
    $ok = (Get-StoredRating $track) -eq (Get-StoredRating $original)
    if (-not $ok) { $unrestored++ }
    Show-Row $ok $track $original.Rating
  }
}

Write-Output ""
if ($unrestored -gt 0) { throw "$unrestored of $($before.Count) tracks did not get their original rating back." }
if ($failures -gt 0) { throw "$failures of $($before.Count) tracks did not come back with rating=$Rating." }
Write-Output "All $($before.Count) tracks report rating=$Rating read back from the player, and each holds its original rating again."
