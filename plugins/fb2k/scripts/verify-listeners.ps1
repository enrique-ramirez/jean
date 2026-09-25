# Exercises the audience against the running player: a device's connections group into one row, the player is silenced while
# somebody listens, a person undoing that is left alone, and the player gets its sound back at the end.
#
# Run on the player. Playback need not be going -- the mute follows connections, not audio -- but with the player playing
# you can hear the thing this is about.
#
#   scripts\verify-listeners.ps1
#   scripts\verify-listeners.ps1 -Linger 8
param(
  [string]$Beefweb = 'http://127.0.0.1:8880/api',
  [string]$FooJean = 'http://127.0.0.1:8881/api',
  # kMuteLingerSeconds in core/settings.h. A departure is only really a departure once this has run out.
  [int]$Linger = 8
)

$ErrorActionPreference = 'Stop'
$failures = 0

function Get-Json($uri, $headers = @{}, $method = 'GET', $body = $null) {
  $call = @{ Uri = $uri; Headers = $headers; Method = $method; UseBasicParsing = $true; TimeoutSec = 30 }
  if ($null -ne $body) { $call.Body = $body }
  if ($method -ieq 'POST') { $call.ContentType = 'application/json' }
  $resp = Invoke-WebRequest @call
  if ($resp.RawContentStream.Length -eq 0) { return $null }
  [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
}

function Check($what, $ok, $detail = '') {
  if ($ok) {
    Write-Host ("  ok    " + $what)
  } else {
    Write-Host ("  FAIL  " + $what + $(if ($detail) { " -- $detail" } else { '' })) -ForegroundColor Red
    $script:failures++
  }
}

function Get-PlayerVolume { (Get-Json "$Beefweb/player").player.volume }
function Get-Listeners { Get-Json "$FooJean/stream/listeners" }

function New-Ticket($deviceId, $name) {
  $body = @{ deviceId = $deviceId; name = $name } | ConvertTo-Json -Compress
  (Get-Json "$FooJean/stream/ticket" @{} 'POST' $body).ticket
}

# A socket written by hand rather than an HttpWebRequest, so that closing one connection closes exactly that connection:
# .NET pools by service point, and this script's whole subject is what the component does as connections come and go.
$open = New-Object System.Collections.ArrayList

function Open-Stream($path) {
  $uri = [Uri]"$FooJean$path"
  $client = New-Object System.Net.Sockets.TcpClient($uri.Host, $uri.Port)
  $stream = $client.GetStream()

  $request = "GET $($uri.PathAndQuery) HTTP/1.1`r`nHost: $($uri.Host):$($uri.Port)`r`n`r`n"
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($request)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()

  $connection = @{ Client = $client; Stream = $stream }
  [void]$open.Add($connection)
  $connection
}

function Close-Stream($connection) {
  $open.Remove($connection)
  $connection.Stream.Close()
  $connection.Client.Close()
}

# A socket nobody reads fills up, and the writer then blocks and is eventually lapped -- which is a different thing from
# the departure this measures. Read what has arrived and throw it away.
function Read-Waiting {
  foreach ($connection in @($open)) {
    while ($connection.Client.Connected -and $connection.Client.Available -gt 0) {
      $buffer = New-Object byte[] $connection.Client.Available
      [void]$connection.Stream.Read($buffer, 0, $buffer.Length)
    }
  }
}

# The component notices a departure on its own schedule, so wait for the state rather than sleeping for a guessed interval.
function Wait-For($predicate, $seconds = 10) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    Read-Waiting
    if (& $predicate) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

Write-Host "capabilities"
$caps = Get-Json "$FooJean/capabilities"
Check "canStream is true" ($caps.canStream -eq $true)
if (-not $caps.canStream) { exit 1 }
Check "canMuteWhileStreaming is reported" ($null -ne $caps.canMuteWhileStreaming)
$mutes = $caps.canMuteWhileStreaming -eq $true
if (-not $mutes) { Write-Host "  note  muteWhileStreaming is off in config.json; the player keeps its sound" }

$before = Get-PlayerVolume
Write-Host ("player is at " + $before.value + " dB, muted: " + $before.isMuted)
if ($before.isMuted) {
  Write-Host "  the player is already muted by hand; unmute it and run this again" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "an empty audience"
$idle = Get-Listeners
Check "nobody is listening" ($idle.devices.Count -eq 0) "found $($idle.devices.Count)"
Check "the cap is published" ($idle.maxConnections -gt 0)
Check "the player is not held" ($idle.playerMuted -eq $false)

Write-Host ""
Write-Host "one device, two connections"
$ticket = New-Ticket 'verify-1' 'Verification device'
$first = Open-Stream "/stream?ticket=$ticket"
$second = Open-Stream "/stream?ticket=$ticket"

Check "both connections arrive" (Wait-For { (Get-Listeners).connections -eq 2 })
$roster = Get-Listeners
Check "they are one device, not two" ($roster.devices.Count -eq 1) "roster has $($roster.devices.Count)"
Check "the device kept the name it sent" ($roster.devices[0].name -eq 'Verification device') "got '$($roster.devices[0].name)'"
Check "the row counts both sockets" ($roster.devices[0].connections -eq 2)
Check "it has been listening for a moment" ($roster.devices[0].listeningFor -ge 0)

if ($mutes) {
  Write-Host ""
  Write-Host "the hold"
  Check "the roster says the player was silenced" (Wait-For { (Get-Listeners).playerMuted -eq $true })

  # foobar2000 has no mute flag: mute is the volume at -100 dB, which is why beefweb sees it at all.
  $during = Get-PlayerVolume
  Check "beefweb reports the player muted" ($during.isMuted -eq $true) "volume is $($during.value)"
}

Write-Host ""
Write-Host "a reconnect is not a departure"
Close-Stream $first
Check "one connection is left" (Wait-For { (Get-Listeners).connections -eq 1 })
if ($mutes) {
  Check "the player is still held for the one that stayed" ((Get-Listeners).playerMuted -eq $true)
}

Close-Stream $second
Check "the roster empties" (Wait-For { (Get-Listeners).connections -eq 0 })

if ($mutes) {
  # The linger is what stops the player unmuting into the gap a client is about to reconnect across.
  Check "the player is still held through the linger" ((Get-Listeners).playerMuted -eq $true)
  Check "the player gets its sound back once the linger runs out" (Wait-For { (Get-Listeners).playerMuted -eq $false } ($Linger + 6))
}

Write-Host ""
Write-Host "a device that says it meant to stop"
$ticket = New-Ticket 'verify-2' 'Verification device'
$third = Open-Stream "/stream?ticket=$ticket"
Check "it connects" (Wait-For { (Get-Listeners).connections -eq 1 })

Close-Stream $third
Check "it disconnects" (Wait-For { (Get-Listeners).connections -eq 0 })

if ($mutes) {
  Check "the hold is still on" ((Get-Listeners).playerMuted -eq $true)
  Get-Json "$FooJean/stream/leave" @{} 'POST' (@{ deviceId = 'verify-2' } | ConvertTo-Json -Compress) | Out-Null

  # A handoff back to the player and a dropped connection close the same socket; only one of them should wait.
  Check "saying so ends the linger at once" (Wait-For { (Get-Listeners).playerMuted -eq $false } 3)
}

if ($mutes) {
  Write-Host ""
  Write-Host "the person at the player wins"
  $ticket = New-Ticket 'verify-3' 'Verification device'
  $fourth = Open-Stream "/stream?ticket=$ticket"
  Check "the hold is taken" (Wait-For { (Get-Listeners).playerMuted -eq $true })

  # Anything that moves the fader is an unmute, because the mute is the fader.
  Get-Json "$Beefweb/player?volume=$($before.value)" @{} 'POST' | Out-Null
  Check "the roster stops claiming the player" (Wait-For { (Get-Listeners).playerMuted -eq $false })

  Start-Sleep -Seconds 2
  $stillOn = Get-PlayerVolume
  Check "it is not muted again while the listener stays" ($stillOn.isMuted -eq $false) "volume is $($stillOn.value)"

  Close-Stream $fourth
  Start-Sleep -Seconds ($Linger + 3)
  $afterwards = Get-PlayerVolume
  Check "and nothing is restored that was already given back" ($afterwards.isMuted -eq $false)
}

Write-Host ""
$after = Get-PlayerVolume
Check "the player is left where it was found" ($after.isMuted -eq $false -and [Math]::Abs($after.value - $before.value) -lt 0.01) `
  "was $($before.value) dB, now $($after.value) dB, muted: $($after.isMuted)"

Write-Host ""
if ($failures -eq 0) {
  Write-Host "all checks passed" -ForegroundColor Green
} else {
  Write-Host "$failures check(s) failed" -ForegroundColor Red
  exit 1
}
