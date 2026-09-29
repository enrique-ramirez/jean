# Exercises the live stream against the running player: two listeners share one encoder, a ticket works more than once,
# both formats are well formed, and the timeline moves.
#
# Run on the player, muted and with playback going -- a stopped player looks exactly like a broken stream from here, and a
# muted one streams at full level (src/core/output_hold.h has why). -SkipTrack and -Seek put the track and the place in
# it back afterwards, pass or fail.
#
#   scripts\verify-stream.ps1
#   scripts\verify-stream.ps1 -Seconds 8 -SkipTrack
param(
  [string]$FooJean = 'http://127.0.0.1:8881/api',
  [int]$Seconds = 6,
  # Skips a track partway through, so a timeline mark is created while a listener is attached. Off by default: it changes what the player is doing.
  [switch]$SkipTrack,
  # Seeks instead of skipping: the track does not change but the place in it does, which marks for a different reason.
  [switch]$Seek,
  [int]$SeekTo = 90
)

$ErrorActionPreference = 'Stop'
$failures = 0

function Get-Json($uri, $headers = @{}, $method = 'GET') {
  $resp = if ($method -eq 'POST') {
    Invoke-WebRequest -Uri $uri -Headers $headers -Method $method -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30
  } else {
    Invoke-WebRequest -Uri $uri -Headers $headers -Method $method -UseBasicParsing -TimeoutSec 30
  }
  [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
}

function Send-Command($path, $body = $null) {
  $call = @{ Uri = "$FooJean$path"; Method = 'POST'; ContentType = 'application/json'; UseBasicParsing = $true; TimeoutSec = 10 }
  if ($null -ne $body) { $call.Body = [System.Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress)) }
  Invoke-WebRequest @call | Out-Null
}

function Check($what, $ok, $detail = '') {
  if ($ok) {
    Write-Host ("  ok    " + $what)
  } else {
    Write-Host ("  FAIL  " + $what + $(if ($detail) { " -- $detail" } else { '' })) -ForegroundColor Red
    $script:failures++
  }
}

# HttpWebRequest rather than Invoke-WebRequest: the response never ends, so anything waiting for completion waits for ever.
function Read-Stream($uri, $seconds) {
  $request = [System.Net.HttpWebRequest]::Create($uri)
  $request.Timeout = 10000
  $request.ReadWriteTimeout = 10000
  try { $response = $request.GetResponse() } catch [System.Net.WebException] {
    return @{ Status = [int]$_.Exception.Response.StatusCode; Bytes = @(); Type = '' }
  }

  $stream = $response.GetResponseStream()
  $buffer = New-Object byte[] 65536
  $collected = New-Object System.IO.MemoryStream
  $deadline = (Get-Date).AddSeconds($seconds)

  try {
    while ((Get-Date) -lt $deadline) {
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { break }
      $collected.Write($buffer, 0, $read)
    }
  } catch { }

  $type = $response.ContentType
  $stream.Close(); $response.Close()
  @{ Status = 200; Bytes = $collected.ToArray(); Type = $type }
}

function New-Ticket {
  (Get-Json "$FooJean/stream/ticket" @{} 'POST').ticket
}

# Walks ADTS frames: every length field must land exactly on the next syncword, which is what proves the headers were written correctly rather than merely present.
# Arithmetic rather than -shl/-band chains: PowerShell's bitwise operators share one precedence level with comparison and associate left to right.
function Test-Adts($bytes) {
  $i = 0; $frames = 0
  while ($i + 7 -le $bytes.Length) {
    $b1 = [int]$bytes[$i + 1]
    if ([int]$bytes[$i] -ne 0xFF -or ($b1 -band 0xF0) -ne 0xF0) {
      return @{ Frames = $frames; Clean = $false }
    }

    $length = (([int]$bytes[$i + 3] -band 3) * 2048) +
              ([int]$bytes[$i + 4] * 8) +
              [math]::Floor([int]$bytes[$i + 5] / 32)

    if ($length -lt 7) { return @{ Frames = $frames; Clean = $false } }
    $i += $length; $frames++
  }

  @{ Frames = $frames; Clean = $true }
}

function Get-PlaybackPlace {
  $now = (Get-Json "$FooJean/state").player
  [pscustomobject]@{
    Location = $now.playingLocation
    Seconds = $now.position.seconds + $now.position.ageSeconds
    Focused = $now.currentPlaylistId
  }
}

function Test-PlayingRow($player, $row) {
  ($player.playback -eq 'playing' -and $null -ne $player.playingLocation -and
    $player.playingLocation.playlistId -eq $row.playlistId -and $player.playingLocation.index -eq $row.index)
}

function Wait-ForRow($row, $seconds = 10) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PlayingRow (Get-Json "$FooJean/state").player $row) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Restore-PlaybackPlace($place) {
  Write-Host "putting playback back"
  $row = $place.Location
  if (-not $row) {
    Check "the track playing before is playing again" $false "it had left its playlist before the $(if ($Seek) { 'seek' } else { 'skip' })"
    return
  }
  if (-not (Test-PlayingRow (Get-Json "$FooJean/state").player $row)) {
    Send-Command "/playlists/$($row.playlistId)/items/$($row.index)/play"
  }
  if (-not (Wait-ForRow $row)) {
    Check "the track playing before is playing again" $false "wanted row $($row.index) of $($row.playlistId)"
    return
  }

  Send-Command '/playback/seek' @{ seconds = [double]$place.Seconds }
  $landed = Get-PlaybackPlace
  Check "playback is back where it was" ([Math]::Abs($landed.Seconds - $place.Seconds) -lt 5) `
    "was at $($place.Seconds)s, now at $($landed.Seconds)s"
  # foo_jean plays a row by making its playlist the active one, for the reason plugins/fb2k/ARCHITECTURE.md gives.
  if ($landed.Focused -ne $place.Focused) {
    Write-Host "  note  foobar2000 now shows playlist $($landed.Focused) rather than $($place.Focused); switch back by hand"
  }
}

Write-Host "player"
$player = (Get-Json "$FooJean/state").player
Check "foobar2000 is playing" ($player.playback -eq 'playing') "state is '$($player.playback)'; start playback and run this again"
if ($player.playback -ne 'playing') { exit 1 }
if (-not $player.muted) {
  Write-Host "  the player is not muted; mute it and run this again" -ForegroundColor Red
  exit 1
}
if ($SkipTrack -or $Seek) {
  if (-not $player.playingLocation) {
    Write-Host "  -SkipTrack and -Seek need the playing track to sit in a playlist, to play it again afterwards" -ForegroundColor Red
    exit 1
  }
  # foobar2000 plays the head of its playback queue next and takes it off, whether a skip or a seek past the end got there.
  if (@((Get-Json "$FooJean/queue").entries).Count -gt 0) {
    Write-Host "  -SkipTrack and -Seek would spend the playback queue's first entry; empty the queue and run this again" -ForegroundColor Red
    exit 1
  }
}

Write-Host "capabilities"
$caps = Get-Json "$FooJean/capabilities"
Check "canStream is true" ($caps.canStream -eq $true)
Check "opus is offered first" ($caps.streamFormats[0] -eq 'opus') "got '$($caps.streamFormats -join ', ')'"
$hasAac = $caps.streamFormats -contains 'aac'
if (-not $hasAac) { Write-Host "  note  this Windows has no AAC encoder; Safari would not be served" }

Write-Host "tickets"
$ticket = New-Ticket
$first = Read-Stream "$FooJean/stream?ticket=$ticket" 2
Check "a ticket opens the stream" ($first.Status -eq 200 -and $first.Bytes.Length -gt 0)

# Safari probes with a Range request before fetching for real, so one playback start is two requests.
$again = Read-Stream "$FooJean/stream?ticket=$ticket" 2
Check "the same ticket serves a second request" ($again.Status -eq 200) "got $($again.Status)"

$stale = Read-Stream "$FooJean/stream?ticket=0000000000000000000000000000000000000000000000000000000000000000" 2
Check "an unknown ticket is refused" ($stale.Status -eq 401) "got $($stale.Status)"
$bad = Read-Stream "$FooJean/stream?ticket=$(New-Ticket)&format=flac" 2
Check "an unknown format is refused" ($bad.Status -eq 400) "got $($bad.Status)"

$place = $null
try {
  Write-Host "two listeners, one encoder"
  $before = (Get-Json "$FooJean/stream/timeline").streamTime
  $jobs = @(
    Start-Job -ArgumentList "$FooJean/stream?ticket=$(New-Ticket)", $Seconds, ${function:Read-Stream} -ScriptBlock {
      param($uri, $seconds, $reader)
      (& ([scriptblock]::Create($reader)) $uri $seconds).Bytes.Length
    }
    Start-Job -ArgumentList "$FooJean/stream?ticket=$(New-Ticket)", $Seconds, ${function:Read-Stream} -ScriptBlock {
      param($uri, $seconds, $reader)
      (& ([scriptblock]::Create($reader)) $uri $seconds).Bytes.Length
    }
  )

  $beforeSkip = $null
  if ($SkipTrack -or $Seek) {
    Start-Sleep -Seconds ([Math]::Max(1, [int]($Seconds / 2)))
    $place = Get-PlaybackPlace
    # Sampled immediately before, so the mark it produces is the only one that can land after it.
    $beforeSkip = (Get-Json "$FooJean/stream/timeline").streamTime

    if ($Seek) {
      Send-Command '/playback/seek' @{ seconds = $SeekTo }
    } else {
      Send-Command '/playback/next'
    }
  }

  $sizes = $jobs | Wait-Job | Receive-Job
  $jobs | Remove-Job
  Check "both listeners received audio" ($sizes[0] -gt 0 -and $sizes[1] -gt 0) "got $($sizes -join ' and ')"
  if ($sizes[0] -gt 0 -and $sizes[1] -gt 0) {
    $spread = [Math]::Abs($sizes[0] - $sizes[1]) / [double]([Math]::Max($sizes[0], $sizes[1]))
    Check "they read the same encoder" ($spread -lt 0.25) "sizes differ by $([int]($spread * 100))%"
  }

  Write-Host "formats"
  $ogg = Read-Stream "$FooJean/stream?ticket=$(New-Ticket)&format=opus" $Seconds
  Check "opus is served as audio/ogg" ($ogg.Type -like 'audio/ogg*') "got '$($ogg.Type)'"
  Check "opus begins with an Ogg page" ($ogg.Bytes.Length -gt 4 -and
    [System.Text.Encoding]::ASCII.GetString($ogg.Bytes[0..3]) -eq 'OggS')

  if ($hasAac) {
    $aac = Read-Stream "$FooJean/stream?ticket=$(New-Ticket)&format=aac" $Seconds
    Check "aac is served as audio/aac" ($aac.Type -like 'audio/aac*') "got '$($aac.Type)'"
    $adts = Test-Adts $aac.Bytes
    Check "aac framing walks cleanly" ($adts.Clean -and $adts.Frames -gt 0) "$($adts.Frames) frames"
  }

  Write-Host "timeline"
  $timeline = Get-Json "$FooJean/stream/timeline"
  Check "the stream clock advanced" ($timeline.streamTime -gt $before) "$before then $($timeline.streamTime)"
  if ($SkipTrack -or $Seek) {
    $recent = @($timeline.marks | Where-Object { $_.at -ge $beforeSkip })
    $what = if ($Seek) { 'seek' } else { 'skip' }
    Check "the $what left a mark where the audio changed" ($recent.Count -ge 1) `
      "clock was $beforeSkip; marks at $($timeline.marks.at -join ', ')"

    if ($Seek -and $recent.Count -ge 1) {
      $landed = $recent[-1].position
      Check "the seek mark carries the new position" ([Math]::Abs($landed - $SeekTo) -lt 5) `
        "asked for $SeekTo, mark says $landed"
    }
  }

  # A client joins the timeline to GET /api/state on the path, which works only while both name the file the same way.
  $nowPlaying = (Get-Json "$FooJean/state").player.path
  if ($timeline.marks.Count -ge 1 -and $nowPlaying) {
    $mine = $timeline.marks[-1].path
    Check "the timeline path matches the player's" ($mine -eq $nowPlaying) `
      "timeline says '$mine', state says '$nowPlaying'"
  }
}
finally {
  if ($place) { Restore-PlaybackPlace $place }
}

Write-Host ""
if ($failures -eq 0) {
  Write-Host "all checks passed" -ForegroundColor Green
} else {
  Write-Host "$failures check(s) failed" -ForegroundColor Red
  exit 1
}
