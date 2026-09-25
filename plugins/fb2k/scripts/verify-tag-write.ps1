# Writes a rating to every file in the test playlist through foo_jean, then reads each one back from the player.
# Run on the player.
#
# The read-back is the assertion: the failure this component exists to avoid is a write the player performed but its own
# database did not learn about, and a playlist row's %rating% column is evaluated against that database, so it is the read
# that tells the two apart. The stream row in the playlist has no file to write and is left out.
#
# Each row is addressed the way a client addresses it, so that what this script exercises is what ships.
#
#   scripts\verify-tag-write.ps1              set every fixture to 3
#   scripts\verify-tag-write.ps1 -Rating 5    put them back
param(
  [string]$FooJean = 'http://127.0.0.1:8881/api',
  [string]$PlaylistTitle = '#foo_jean test',
  [string]$Rating = '3',
  # A guard, not a limit: if this is ever pointed at a playlist holding a real library, the item count gives it away before anything is written.
  [int]$MaxItems = 20
)

$ErrorActionPreference = 'Stop'

# foo_jean answers 'application/json' with no charset parameter, and PowerShell 5.1 then falls back to ISO-8859-1,
# turning every accented path into mojibake that no longer names a file. Decode the raw bytes as UTF-8 by hand.
function Get-Json($uri, $headers = @{}) {
  $resp = Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 30
  [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
}

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

$before = @(Get-Fixtures)
Write-Output "Writing rating=$Rating to $($before.Count) tracks in '$PlaylistTitle'"

foreach ($target in $before) {
  $body = ((Get-Address $target) + @{ fields = @{ rating = $Rating } }) | ConvertTo-Json -Compress
  # UTF-8 bytes rather than a string: the default is ISO-8859-1 on the way out too, which would corrupt an accented address before foo_jean saw it.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

  try {
    $resp = Invoke-WebRequest -Uri "$FooJean/tags" -Method Post `
      -Body $bytes -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60
    $status = $resp.StatusCode
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $detail = $_.ErrorDetails.Message
  }

  Write-Output "  POST $status  $($target.Codec.PadRight(5)) $([System.IO.Path]::GetFileName($target.Path))"
  Write-Output "        sent  $body"
  if ($detail) { Write-Output "        reply $detail"; $detail = $null }
}

$after = @(Get-Fixtures)

Write-Output ""
Write-Output "Read back from the player:"
$failures = 0
foreach ($track in $after) {
  $was = ($before | Where-Object { $_.Index -eq $track.Index }).Rating
  $ok = $track.Rating -eq $Rating
  if (-not $ok) { $failures++ }
  $mark = if ($ok) { 'ok  ' } else { 'FAIL' }
  Write-Output "  $mark $($track.Codec.PadRight(5)) $was -> $($track.Rating)   $([System.IO.Path]::GetFileName($track.Path))"
}

Write-Output ""
if ($failures -gt 0) { throw "$failures of $($after.Count) tracks did not come back with rating=$Rating." }
Write-Output "All $($after.Count) tracks report rating=$Rating read back from the player."
