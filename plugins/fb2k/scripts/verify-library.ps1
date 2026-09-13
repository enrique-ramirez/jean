# Runs the checks the automated suite cannot make: they need a real player and a real library.
# Writes no tag, no playlist and nothing aimed at the library root. The one file it writes is the
# library export, and only where JEAN_LIBRARY_EXPORT names a destination.
#
#   scripts\verify-library.ps1
#   scripts\verify-library.ps1 -Full
#   $env:JEAN_LIBRARY_EXPORT = 'D:\path\export.jlib'; scripts\verify-library.ps1
param(
  [string]$Beefweb = 'http://127.0.0.1:8880/api',
  [string]$FooJean = 'http://127.0.0.1:8881/api',
  [string]$Token,
  [string]$Foobar2000Dir = $env:FOOBAR2000_DIR,
  [switch]$Full,
  [string]$LibraryExport = $env:JEAN_LIBRARY_EXPORT
)

$ErrorActionPreference = 'Stop'

if (-not $Token) {
  if (-not $Foobar2000Dir) {
    throw "Pass -Token, or set -Foobar2000Dir / FOOBAR2000_DIR so the token can be read from config.json"
  }
  $configPath = Join-Path $Foobar2000Dir 'profile\foo_jean\config.json'
  if (-not (Test-Path $configPath)) { throw "No foo_jean config at $configPath" }
  $Token = (Get-Content $configPath -Raw | ConvertFrom-Json).authToken
}
if (-not $Token) { throw "foo_jean has no auth token configured; it will not be serving." }

$auth = @{ Authorization = "Bearer $Token" }

$script:passed = 0
$script:failed = 0
$script:skipped = 0
$script:libraryExportBytes = $null

function Invoke-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Body
  )

  try {
    & $Body
    Write-Host ("  ok    " + $Name)
    $script:passed++
  } catch {
    $message = $_.Exception.Message
    if ($message.StartsWith($script:SkipMarker)) {
      Write-Host ("  skip  " + $Name + "  (" + $message.Substring($script:SkipMarker.Length) + ")")
      $script:skipped++
    } else {
      Write-Host ("  FAIL  " + $Name + "  -- " + $message) -ForegroundColor Red
      $script:failed++
    }
  }
}

$script:SkipMarker = 'SKIP: '
function Skip-Check([string]$Reason) {
  throw "$($script:SkipMarker)$Reason"
}

# Every probe in this script is a small JSON status check on a LAN; this is a generous guess at
# that budget rather than a measurement.
$script:ApiProbeTimeoutSeconds = 30

# PowerShell 5.1 throws on any status outside 2xx, a 304 included, so a probe reads status,
# headers and body off whichever response came back rather than only off a success. On the
# success path the body is read off the raw bytes and decoded as UTF-8 by hand, the way
# verify-tag-write.ps1 does for RawContentStream, because both servers
# answer application/json with no charset and 5.1 would otherwise decode it as ISO-8859-1. On the
# error path the body comes from $_.ErrorDetails.Message instead of a second read of the response
# stream: Invoke-WebRequest already consumed the stream to populate it, and reading it again finds
# it exhausted. ContentLength is read off the response object rather than off either decoded body,
# because a 304 is expected to carry none and a decoded string cannot tell an empty body from one
# that failed to decode.
function Invoke-ApiProbe($uri, $method, $headers) {
  try {
    $resp = Invoke-WebRequest -Uri $uri -Method $method -Headers $headers -UseBasicParsing -TimeoutSec $script:ApiProbeTimeoutSeconds
    $body = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
    return @{ StatusCode = [int]$resp.StatusCode; Headers = $resp.Headers; Body = $body; ContentLength = $resp.BaseResponse.ContentLength }
  } catch {
    $errorResponse = $_.Exception.Response
    if (-not $errorResponse) { throw }
    return @{ StatusCode = [int]$errorResponse.StatusCode; Headers = $errorResponse.Headers; Body = $_.ErrorDetails.Message; ContentLength = $errorResponse.ContentLength }
  }
}

function Get-MissingHeaderNames($value, [string[]]$required) {
  $present = @()
  if ($value) { $present = $value -split ',' | ForEach-Object { $_.Trim() } }
  $required | Where-Object {
    $name = $_
    -not ($present | Where-Object { $_ -ieq $name })
  }
}

# TRACK_EXPRESSIONS in ui/src/domain/track/fields.ts, transcribed rather than read from ui/ at
# run time: scripts/deploy.local.sh syncs only src/, scripts/, third_party/ and tests/ to the
# player, so neither ui/ nor node ever reaches this machine. Regenerate by importing
# TRACK_EXPRESSIONS from that file in a throwaway node script run from ui/ and pasting one
# expression per line back here if fields.ts changes. This is the one place both this probe and
# the export a later check takes read the declared columns.
$script:DeclaredColumns = @(
  '%tracknumber%', '%discnumber%', '%title%', '%artist%', '%album%', '%album artist%',
  '%length_seconds%', '%lastfm_play_count%', '%lastfm_last_played%', '%rating%', '%year%',
  '%genre%', '%codec%', '%bitrate%', '%play_count%', '%last_played%'
)

function Test-SameColumns([string[]]$a, [string[]]$b) {
  $left = ($a | Sort-Object) -join "`n"
  $right = ($b | Sort-Object) -join "`n"
  return $left -ceq $right
}

$script:librarySnapshot = $null
Invoke-Check -Name "GET /library answers before anything else and never starts a build" -Body {
  $probe = Invoke-ApiProbe "$FooJean/library" 'Get' $auth
  if ($probe.StatusCode -ne 200) {
    throw "GET /library answered $($probe.StatusCode), not 200"
  }
  $parsed = $probe.Body | ConvertFrom-Json
  if ($null -eq $parsed.ready) {
    throw "GET /library answered with no 'ready' field"
  }
  $script:librarySnapshot = @{ Ready = [bool]$parsed.ready; Columns = @($parsed.columns) }
}
$script:snapshotWarm = $false
if ($script:librarySnapshot -and $script:librarySnapshot.Ready) {
  $script:snapshotWarm = Test-SameColumns $script:librarySnapshot.Columns $script:DeclaredColumns
}

$corsOrigin = 'https://jean.example'

Invoke-Check -Name "the preflight allows Authorization, Content-Type and If-None-Match" -Body {
  $preflight = Invoke-ApiProbe "$FooJean/library" 'Options' @{
    Origin                           = $corsOrigin
    'Access-Control-Request-Method'  = 'GET'
    'Access-Control-Request-Headers' = 'if-none-match'
  }
  if ($preflight.StatusCode -ne 204) {
    throw "OPTIONS /library answered $($preflight.StatusCode), not 204"
  }
  $allowed = $preflight.Headers['Access-Control-Allow-Headers']
  $missing = @(Get-MissingHeaderNames $allowed @('Authorization', 'Content-Type', 'If-None-Match'))
  if ($missing.Count -gt 0) {
    throw "Access-Control-Allow-Headers is missing $($missing -join ', ') (was '$allowed')"
  }
}

Invoke-Check -Name "every answer exposes ETag and Retry-After, preflight and plain alike" -Body {
  $required = @('ETag', 'Retry-After')

  $preflight = Invoke-ApiProbe "$FooJean/library" 'Options' @{ Origin = $corsOrigin }
  $missingOnPreflight = @(Get-MissingHeaderNames $preflight.Headers['Access-Control-Expose-Headers'] $required)
  if ($missingOnPreflight.Count -gt 0) {
    throw "the preflight answer is missing $($missingOnPreflight -join ', ') from Access-Control-Expose-Headers"
  }

  # /status carries no bearer requirement, so this is a plain answer rather than a second preflight.
  $plain = Invoke-ApiProbe "$FooJean/status" 'Get' @{ Origin = $corsOrigin }
  $missingOnPlain = @(Get-MissingHeaderNames $plain.Headers['Access-Control-Expose-Headers'] $required)
  if ($missingOnPlain.Count -gt 0) {
    throw "a plain GET is missing $($missingOnPlain -join ', ') from Access-Control-Expose-Headers"
  }
}

function Get-ArtworkProbe($track) {
  $uri = "$FooJean/artwork?track=" + [System.Uri]::EscapeDataString($track)
  Invoke-ApiProbe $uri 'Get' $auth
}

function Assert-ArtworkRefusal($track, $expectedStatus, $expectedError, $label) {
  $probe = Get-ArtworkProbe $track
  if ($probe.StatusCode -ne $expectedStatus) {
    throw "$label answered $($probe.StatusCode), not $expectedStatus"
  }
  if ($expectedError) {
    $got = ($probe.Body | ConvertFrom-Json).error
    if ($got -ne $expectedError) {
      throw "$label answered error '$got', not '$expectedError'"
    }
  }
}

Invoke-Check -Name "a traversal-shaped address is an unmatched key, not a path to refuse" -Body {
  Assert-ArtworkRefusal '../../../Windows/win.ini' 404 'no artwork for that track' 'a forward-slashed traversal address'
}

Invoke-Check -Name "a backslashed address is simply a different key, never a separator" -Body {
  Assert-ArtworkRefusal '..\..\..\Windows\win.ini' 404 $null 'a backslashed traversal address'
}

Invoke-Check -Name "an absolute path is an unmatched key, never a filesystem path to open" -Body {
  Assert-ArtworkRefusal 'C:/Windows/win.ini' 404 $null 'an absolute path'
}

Invoke-Check -Name "a file:// address is an unmatched key, never a filesystem path to open" -Body {
  Assert-ArtworkRefusal 'file:///C:/Windows/win.ini' 404 $null 'a file:// address'
}

Invoke-Check -Name "an empty address is refused before any lookup" -Body {
  Assert-ArtworkRefusal '' 400 "'track' is required" 'an empty track'
}

# trackAddressRefusal in core/artwork.h answers the length ceiling and a non-printable character
# with the same sentence, kMaxTrackAddressLength being 4096, so both rows below assert it.
$script:printableRefusal = "'track' must be printable text of at most 4096 characters"

Invoke-Check -Name "an address past the length ceiling is refused before any lookup" -Body {
  Assert-ArtworkRefusal ('a' * 4097) 400 $script:printableRefusal 'a 4097-character track'
}

Invoke-Check -Name "a control character in the address is refused before any lookup" -Body {
  Assert-ArtworkRefusal ("Album/a$([char]10)b.flac") 400 $script:printableRefusal 'a track holding a newline'
  Assert-ArtworkRefusal ("Album/a$([char]0)b.flac") 400 $script:printableRefusal 'a track holding a NUL'
}

# acceptsGzip() in core/http_server.cpp matches only a literal "gzip" token, so naming the
# coding explicitly rather than omitting the header is what makes the identity request
# unambiguous: an omitted header risks whatever Invoke-WebRequest's own transport adds on top.
function Get-CodingHeaders([string]$coding) {
  return @{ Authorization = $auth.Authorization; 'Accept-Encoding' = $coding }
}

# The three library routes name the content coding in the validator (sendIfChanged in
# core/http_server.cpp appends "-gzip" or "-identity" to the generation string), so a validator
# taken under one coding must not revalidate the other. GET /api/artwork does not: sendArtwork
# never varies its ETag by coding, and images are outside can_compress_content_type's list, so
# this helper is exercised only against the three routes that do.
function Test-ConditionalRoute([string]$label, [string]$uri) {
  $identityHeaders = Get-CodingHeaders 'identity'
  $gzipHeaders = Get-CodingHeaders 'gzip'

  $identityFirst = Invoke-ApiProbe $uri 'Get' $identityHeaders
  if ($identityFirst.StatusCode -ne 200) {
    throw "$label (identity) answered $($identityFirst.StatusCode), not 200"
  }
  if ($identityFirst.Headers['Content-Encoding']) {
    throw "$label asked for identity but answered Content-Encoding: $($identityFirst.Headers['Content-Encoding'])"
  }
  $identityTag = $identityFirst.Headers['ETag']
  if (-not $identityTag) { throw "$label (identity) answered with no ETag" }

  $gzipFirst = Invoke-ApiProbe $uri 'Get' $gzipHeaders
  if ($gzipFirst.StatusCode -ne 200) {
    throw "$label (gzip) answered $($gzipFirst.StatusCode), not 200"
  }
  if ($gzipFirst.Headers['Content-Encoding'] -ne 'gzip') {
    throw "$label asked for gzip but answered Content-Encoding '$($gzipFirst.Headers['Content-Encoding'])'"
  }
  $gzipTag = $gzipFirst.Headers['ETag']
  if (-not $gzipTag) { throw "$label (gzip) answered with no ETag" }

  if ($identityTag -eq $gzipTag) {
    throw "$label named the same ETag for both codings ('$identityTag')"
  }

  foreach ($case in @(
      @{ Coding = 'identity'; Headers = $identityHeaders; Tag = $identityTag },
      @{ Coding = 'gzip'; Headers = $gzipHeaders; Tag = $gzipTag }
    )) {
    $revalidateHeaders = $case.Headers.Clone()
    $revalidateHeaders['If-None-Match'] = $case.Tag
    $again = Invoke-ApiProbe $uri 'Get' $revalidateHeaders
    if ($again.StatusCode -ne 304) {
      throw "$label ($($case.Coding)) revalidation answered $($again.StatusCode), not 304"
    }
    if ($again.ContentLength -ne 0) {
      throw "$label ($($case.Coding)) 304 carried $($again.ContentLength) byte(s), not zero"
    }
    if ($again.Headers['ETag'] -ne $case.Tag) {
      throw "$label ($($case.Coding)) 304 answered ETag '$($again.Headers['ETag'])', not '$($case.Tag)'"
    }
  }

  $crossedOnGzip = $gzipHeaders.Clone()
  $crossedOnGzip['If-None-Match'] = $identityTag
  $crossedOnGzipResult = Invoke-ApiProbe $uri 'Get' $crossedOnGzip
  if ($crossedOnGzipResult.StatusCode -ne 200) {
    throw "$label: the identity ETag revalidated a gzip request ($($crossedOnGzipResult.StatusCode), not 200)"
  }

  $crossedOnIdentity = $identityHeaders.Clone()
  $crossedOnIdentity['If-None-Match'] = $gzipTag
  $crossedOnIdentityResult = Invoke-ApiProbe $uri 'Get' $crossedOnIdentity
  if ($crossedOnIdentityResult.StatusCode -ne 200) {
    throw "$label: the gzip ETag revalidated an identity request ($($crossedOnIdentityResult.StatusCode), not 200)"
  }
}

$script:SnapshotSkipMessage = 'needs a warm snapshot matching the declared columns; run with -Full to let a check build one'
function Assert-SnapshotWarm {
  if (-not $script:snapshotWarm) {
    Skip-Check $script:SnapshotSkipMessage
  }
}

function Get-LibraryExportQuery {
  return ($script:DeclaredColumns | ForEach-Object { 'columns=' + [System.Uri]::EscapeDataString($_) }) -join '&'
}

function Get-LibraryExportUri {
  Assert-SnapshotWarm
  return "$FooJean/library/export?$(Get-LibraryExportQuery)"
}

# GET /library/export can be answering a walk of a genuinely large library rather than a status
# check, so this budget is wider than the rest of the script's requests and is a guess rather
# than a measurement.
$script:LibraryExportTimeoutSeconds = 120

function Get-CurrentLibraryState {
  Assert-SnapshotWarm
  $probe = Invoke-ApiProbe "$FooJean/library" 'Get' $auth
  if ($probe.StatusCode -ne 200) {
    throw "GET /library answered $($probe.StatusCode), not 200"
  }
  return $probe.Body | ConvertFrom-Json
}

# Reading the current revision back through GET /library, which never starts a build, is what
# makes a 'since' value on /library/changes safe to build without risking notBuilt or
# revisionUnknown (Library::changes in core/library.cpp).
function Get-CurrentLibraryRevision {
  return (Get-CurrentLibraryState).revision
}

# Library::state() in core/library.cpp reports only ready/not-ready, with no progress fraction, so
# this is a flat ceiling on the wait rather than an estimate of how long a rebuild takes.
$script:LibraryBuildTimeoutSeconds = 300

# ready is snapshot.structure > 0 (core/library.cpp), which never drops while an already-warm
# snapshot rebuilds in place: the old one keeps answering until the new one replaces it. Ready
# alone is therefore only a fair wait condition starting from cold, where structure begins at
# 0; a caller forcing a rebuild of a warm snapshot passes the structure it read beforehand so
# this also waits for that number to move, the way a client is told to in
# contract/openapi.yaml's POST /library/refresh.
function Wait-ForDeclaredColumns([int]$TimeoutSeconds, [uint64]$MinStructure = 0) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $state = Invoke-ApiProbe "$FooJean/library" 'Get' $auth
    if ($state.StatusCode -ne 200) {
      throw "GET /library answered $($state.StatusCode), not 200, while waiting for the declared columns to build"
    }
    $parsed = $state.Body | ConvertFrom-Json
    $structureMoved = [uint64]$parsed.structure -gt $MinStructure
    if ([bool]$parsed.ready -and $structureMoved -and (Test-SameColumns @($parsed.columns) $script:DeclaredColumns)) {
      $script:snapshotWarm = $true
      return
    }
  }
  throw "the declared columns did not finish building within $TimeoutSeconds second(s)"
}

Invoke-Check -Name "GET /library revalidates by ETag, in both codings, and rejects a validator from the other" -Body {
  Test-ConditionalRoute "GET /library" "$FooJean/library"
}

Invoke-Check -Name "GET /library/export revalidates by ETag, in both codings, and rejects a validator from the other" -Body {
  Test-ConditionalRoute "GET /library/export" (Get-LibraryExportUri)
}

Invoke-Check -Name "GET /library/changes revalidates by ETag, in both codings, and rejects a validator from the other" -Body {
  $revision = Get-CurrentLibraryRevision
  Test-ConditionalRoute "GET /library/changes" "$FooJean/library/changes?since=$revision"
}

Invoke-Check -Name "GET /library/export captures the export to JEAN_LIBRARY_EXPORT, in the identity coding" -Body {
  if (-not $script:snapshotWarm -and -not $Full) {
    Skip-Check $script:SnapshotSkipMessage
  }

  $headers = Get-CodingHeaders 'identity'
  $uri = "$FooJean/library/export?$(Get-LibraryExportQuery)"
  $export = Invoke-WebRequest -Uri $uri -Method Get -Headers $headers -UseBasicParsing -TimeoutSec $script:LibraryExportTimeoutSeconds

  if ([int]$export.StatusCode -eq 202) {
    if (-not $Full) {
      throw "GET /library/export answered 202 though the snapshot was warm moments ago; rerun with -Full"
    }
    Wait-ForDeclaredColumns $script:LibraryBuildTimeoutSeconds
    # A set already building answers 202 again rather than starting a second build (startBuilding()
    # in core/http_server.cpp), so this second ask is the one that reads the finished export.
    $export = Invoke-WebRequest -Uri $uri -Method Get -Headers $headers -UseBasicParsing -TimeoutSec $script:LibraryExportTimeoutSeconds
    if ([int]$export.StatusCode -ne 200) {
      throw "GET /library/export answered $([int]$export.StatusCode) after the declared columns were reported ready, not 200"
    }
  } elseif ([int]$export.StatusCode -ne 200) {
    throw "GET /library/export answered $([int]$export.StatusCode), not 200 or 202"
  }

  if ($export.Headers['Content-Encoding']) {
    throw "asked for identity but answered Content-Encoding: $($export.Headers['Content-Encoding'])"
  }

  $script:libraryExportBytes = $export.RawContentStream.ToArray()

  if (-not $LibraryExport) {
    Skip-Check "needs JEAN_LIBRARY_EXPORT (or -LibraryExport) set to a destination file"
  }
  [System.IO.File]::WriteAllBytes($LibraryExport, $script:libraryExportBytes)
}

# fb2k::sortStringCompare is StrCmpLogicalW (ARCHITECTURE.md, "foobar2000 does not compare paths
# byte by byte"). Calling it directly, rather than sorting a playlist through beefweb, is what
# lets this script stay read-only. The export's spine carries neither subsong nor the canonical
# path, so this reproduces the primary comparison alone; Get-NaturalOrderComparisonCounts below
# is where a pair it calls equal is counted as a tie rather than a mismatch for that reason.
Add-Type -Namespace Jean -Name NativeSort -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shlwapi.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern int StrCmpLogicalW(string a, string b);
'@

# fb2k::makeSortString keys off the unnormalised path on purpose, because the separator weighs in
# foobar2000's comparison (fb2k/library.cpp, the comment above sortKeys[n] = fb2k::makeSortString);
# on Windows that separator is a backslash. The export publishes forward-slashed addresses
# (fb2k/library.cpp's forwardSlashed), so comparing on those directly compares a different string
# than the component compared. Reversing that mapping is exact because a filename cannot itself
# hold a forward slash on Windows, so every '/' in an address is a separator forwardSlashed wrote.
function ConvertTo-BackslashedAddress([string]$forwardSlashed) {
  return $forwardSlashed.Replace('/', '\')
}

function Compare-LibraryPath([string]$a, [string]$b) {
  return [Jean.NativeSort]::StrCmpLogicalW((ConvertTo-BackslashedAddress $a), (ConvertTo-BackslashedAddress $b))
}

function Get-PositionMismatchCount([string[]]$expected, [string[]]$actual) {
  $count = 0
  for ($i = 0; $i -lt $expected.Length; $i++) {
    if ($expected[$i] -cne $actual[$i]) { $count++ }
  }
  return $count
}

# A position where the two addresses differ but Compare-LibraryPath still calls them equal is not
# a mismatch: it is a pair sortStringCompare would go on to resolve with wcscmp, or, on a further
# tie, ordinalOrder's own subsong and canonical path (core/library.cpp), and the export's spine
# carries none of the three. Counting it as a tie rather than a mismatch accepts that limit
# instead of expecting an exact match.
function Get-NaturalOrderComparisonCounts([string[]]$expected, [string[]]$actual) {
  $mismatch = 0
  $tie = 0
  for ($i = 0; $i -lt $expected.Length; $i++) {
    if ($expected[$i] -ceq $actual[$i]) { continue }
    if ((Compare-LibraryPath $expected[$i] $actual[$i]) -eq 0) { $tie++ } else { $mismatch++ }
  }
  return @{ Mismatch = $mismatch; Tie = $tie }
}

# LibraryHeader in contract/openapi.yaml, decoded the way ui/src/shared/api/jlib.ts's decodeJlib
# does: a magic number, a JSON header, then a blob starting on a four-byte boundary. Only the
# spine's directory and filename are read here; the declared columns are not.
function Read-LibrarySection([byte[]]$bytes, [int]$blobAt, $section) {
  $at = $blobAt + [int]$section.offset
  $count = [int]$section.count
  $width = [int]$section.width
  $values = New-Object 'uint32[]' $count
  for ($i = 0; $i -lt $count; $i++) {
    $pos = $at + $i * $width
    if ($width -eq 1) {
      $values[$i] = $bytes[$pos]
    } elseif ($width -eq 2) {
      $values[$i] = [System.BitConverter]::ToUInt16($bytes, $pos)
    } else {
      $values[$i] = [System.BitConverter]::ToUInt32($bytes, $pos)
    }
  }
  return , $values
}

function Get-LibraryDictionaryValues([byte[]]$bytes, [int]$blobAt, $dict) {
  $textAt = $blobAt + [int]$dict.text.offset
  $ends = Read-LibrarySection $bytes $blobAt $dict.ends
  $values = New-Object 'string[]' $ends.Length
  $start = 0
  for ($i = 0; $i -lt $ends.Length; $i++) {
    $end = [int]$ends[$i]
    $values[$i] = [System.Text.Encoding]::UTF8.GetString($bytes, $textAt + $start, $end - $start)
    $start = $end
  }
  return , $values
}

function Get-LibraryColumnValues([byte[]]$bytes, [int]$blobAt, $column) {
  $ids = Read-LibrarySection $bytes $blobAt $column.ids
  $dictValues = Get-LibraryDictionaryValues $bytes $blobAt $column.dict
  $values = New-Object 'string[]' $ids.Length
  for ($i = 0; $i -lt $ids.Length; $i++) {
    $values[$i] = $dictValues[$ids[$i]]
  }
  return , $values
}

function Read-LibrarySpine([byte[]]$bytes) {
  if ($bytes.Length -lt 8) { throw "the export is shorter than its own framing" }
  if ([System.Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'JLIB') {
    throw "the export's magic number is not JLIB"
  }
  $headerBytes = [int][System.BitConverter]::ToUInt32($bytes, 4)
  $blobAt = 8 + $headerBytes
  if ($blobAt % 4 -ne 0) {
    throw "the export's blob starts at $blobAt, which is not a multiple of four"
  }
  $header = [System.Text.Encoding]::UTF8.GetString($bytes, 8, $headerBytes) | ConvertFrom-Json
  if ($header.kind -ne 'snapshot') {
    throw "the export is a $($header.kind), not a snapshot"
  }
  if (-not $header.spine.directory) { throw "the export's spine carries no directory column" }
  if (-not $header.spine.filename) { throw "the export's spine carries no filename column" }

  return @{
    TrackCount = [int]$header.trackCount
    Directory  = Get-LibraryColumnValues $bytes $blobAt $header.spine.directory
    Filename   = Get-LibraryColumnValues $bytes $blobAt $header.spine.filename
  }
}

function Get-LibraryExportBytes {
  Assert-SnapshotWarm
  if (-not $script:libraryExportBytes) {
    $headers = Get-CodingHeaders 'identity'
    $export = Invoke-WebRequest -Uri (Get-LibraryExportUri) -Method Get -Headers $headers -UseBasicParsing -TimeoutSec $script:LibraryExportTimeoutSeconds
    if ([int]$export.StatusCode -ne 200) {
      throw "GET /library/export (for the spine) answered $([int]$export.StatusCode), not 200"
    }
    $script:libraryExportBytes = $export.RawContentStream.ToArray()
  }
  return $script:libraryExportBytes
}

$script:librarySpine = $null
function Get-LibrarySpine {
  Assert-SnapshotWarm
  if (-not $script:librarySpine) {
    $script:librarySpine = Read-LibrarySpine (Get-LibraryExportBytes)
  }
  return $script:librarySpine
}

function Get-LibraryAddresses($spine) {
  $addresses = New-Object 'string[]' $spine.TrackCount
  for ($i = 0; $i -lt $spine.TrackCount; $i++) {
    $addresses[$i] = $spine.Directory[$i] + $spine.Filename[$i]
  }
  return , $addresses
}

Invoke-Check -Name "the component's ordinal order matches the player's own path comparator, with a byte-order control" -Body {
  $addresses = Get-LibraryAddresses (Get-LibrarySpine)

  [string[]]$byNaturalOrder = $addresses.Clone()
  [System.Array]::Sort($byNaturalOrder, [System.Comparison[string]] { param($a, $b) Compare-LibraryPath $a $b })

  [string[]]$byByteOrder = $addresses.Clone()
  [System.Array]::Sort($byByteOrder, [System.StringComparer]::Ordinal)

  $natural = Get-NaturalOrderComparisonCounts $addresses $byNaturalOrder
  $controlMismatch = Get-PositionMismatchCount $addresses $byByteOrder

  Write-Host "    natural-order mismatches: $($natural.Mismatch) of $($addresses.Length), plus $($natural.Tie) tie(s) StrCmpLogicalW alone cannot break"
  Write-Host "    byte-order control mismatches: $controlMismatch of $($addresses.Length)"

  if ($controlMismatch -eq 0 -and $natural.Mismatch -eq 0) {
    Skip-Check "the corpus has no digit run, case difference or accent to tell the two orderings apart; inconclusive"
  }
  if ($natural.Mismatch -gt 0) {
    throw "the component's order disagrees with the player's own path comparator at $($natural.Mismatch) of $($addresses.Length) position(s), not counting $($natural.Tie) tie(s)"
  }
}

# A folder holding more than one track is more likely a real album, and an album with an external
# cover is the case most likely to answer 200 rather than 404. The walk itself is shared with the
# cover-freshness sample further down, so it exists once.
function Get-MultiTrackDirectories($spine) {
  $rowsByDirectory = [ordered]@{}
  for ($row = 0; $row -lt $spine.TrackCount; $row++) {
    $dir = $spine.Directory[$row]
    if ($rowsByDirectory.Contains($dir)) {
      $rowsByDirectory[$dir].Add($row)
    } else {
      $rows = New-Object 'System.Collections.Generic.List[int]'
      $rows.Add($row)
      $rowsByDirectory[$dir] = $rows
    }
  }
  $multiTrack = [ordered]@{}
  foreach ($dir in $rowsByDirectory.Keys) {
    if ($rowsByDirectory[$dir].Count -gt 1) { $multiTrack[$dir] = $rowsByDirectory[$dir] }
  }
  return $multiTrack
}

$script:ArtworkSearchCap = 50
$script:realArtworkAddress = $null
$script:realArtworkSearched = $false

function Get-CaseFlipped([string]$value) {
  $upper = $value.ToUpperInvariant()
  if ($upper -cne $value) { return $upper }
  return $value.ToLowerInvariant()
}

function Get-RealArtworkAddress {
  Assert-SnapshotWarm
  if ($script:realArtworkSearched) {
    if (-not $script:realArtworkAddress) {
      Skip-Check "no track among the folders tried answered 200 for artwork"
    }
    return $script:realArtworkAddress
  }
  $spine = Get-LibrarySpine
  $directories = Get-MultiTrackDirectories $spine

  $tried = 0
  foreach ($dir in $directories.Keys) {
    if ($tried -ge $script:ArtworkSearchCap) { break }
    $tried++
    $row = $directories[$dir][0]
    $address = $dir + $spine.Filename[$row]
    if ((Get-ArtworkProbe $address).StatusCode -eq 200) {
      $script:realArtworkAddress = $address
      $script:realArtworkSearched = $true
      return $address
    }
  }

  $script:realArtworkSearched = $true
  Skip-Check "no track among $tried multi-track folder(s) answered 200 for artwork"
}

Invoke-Check -Name "a real library-relative address answers with an actual cover" -Body {
  $address = Get-RealArtworkAddress
  $probe = Get-ArtworkProbe $address
  if ($probe.StatusCode -ne 200) {
    throw "the address found earlier now answers $($probe.StatusCode), not 200"
  }
  $accepted = @('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp')
  if ($accepted -notcontains $probe.Headers['Content-Type']) {
    throw "answered Content-Type '$($probe.Headers['Content-Type'])', not one of $($accepted -join ', ')"
  }
}

Invoke-Check -Name "the same address with its case changed is an unmatched key" -Body {
  Assert-ArtworkRefusal (Get-CaseFlipped (Get-RealArtworkAddress)) 404 $null 'a real address with its case changed'
}

Invoke-Check -Name "GET /artwork revalidates by ETag, with a zero-byte 304 and the validator returned" -Body {
  $address = Get-RealArtworkAddress
  $first = Get-ArtworkProbe $address
  if ($first.StatusCode -ne 200) {
    throw "the address found earlier now answers $($first.StatusCode), not 200"
  }
  $tag = $first.Headers['ETag']
  if (-not $tag) { throw "GET /artwork answered with no ETag" }

  $revalidateHeaders = $auth.Clone()
  $revalidateHeaders['If-None-Match'] = $tag
  $uri = "$FooJean/artwork?track=" + [System.Uri]::EscapeDataString($address)
  $again = Invoke-ApiProbe $uri 'Get' $revalidateHeaders
  if ($again.StatusCode -ne 304) {
    throw "revalidation answered $($again.StatusCode), not 304"
  }
  if ($again.ContentLength -ne 0) {
    throw "the 304 carried $($again.ContentLength) byte(s), not zero"
  }
  if ($again.Headers['ETag'] -ne $tag) {
    throw "the 304 answered ETag '$($again.Headers['ETag'])', not '$tag'"
  }
}

# An album with its cover embedded in each audio file gives every track a different picture, so
# one album disagreeing with itself is not a fault, and only a sample across several can tell that
# apart from a validator that never reads the bytes. The cap, the sample target and the minimum
# below are guesses rather than a measured distribution, sized to stop once enough folders have
# answered without walking the whole library.
$script:AlbumCoverSearchCap = 60
$script:AlbumCoverSampleTarget = 8
$script:MinAlbumCoverSamples = 2

function Get-AlbumCoverSamples {
  Assert-SnapshotWarm
  $spine = Get-LibrarySpine
  $directories = Get-MultiTrackDirectories $spine

  $samples = @()
  $examined = 0
  foreach ($dir in $directories.Keys) {
    if ($examined -ge $script:AlbumCoverSearchCap -or $samples.Count -ge $script:AlbumCoverSampleTarget) { break }
    $examined++
    $rows = $directories[$dir]
    $firstProbe = Get-ArtworkProbe ($dir + $spine.Filename[$rows[0]])
    if ($firstProbe.StatusCode -ne 200) { continue }
    $secondProbe = Get-ArtworkProbe ($dir + $spine.Filename[$rows[1]])
    if ($secondProbe.StatusCode -ne 200) { continue }
    $samples += @{
      Directory        = $dir
      ETags            = @($firstProbe.Headers['ETag'], $secondProbe.Headers['ETag'])
      AgreesWithItself = ($firstProbe.Headers['ETag'] -eq $secondProbe.Headers['ETag'])
    }
  }
  return , $samples
}

Invoke-Check -Name "two tracks sharing a cover share an ETag, and the sample does not collapse to a single value" -Body {
  $samples = Get-AlbumCoverSamples
  if ($samples.Count -lt $script:MinAlbumCoverSamples) {
    Skip-Check "only $($samples.Count) of $script:AlbumCoverSearchCap folder(s) tried answered a cover on both tracks; too few to judge"
  }

  $agreeing = @($samples | Where-Object { $_.AgreesWithItself })
  Write-Host "    albums sampled: $($samples.Count), agreeing with themselves: $($agreeing.Count) (an album with embedded art may legitimately disagree)"
  if ($agreeing.Count -eq 0) {
    throw "no album among $($samples.Count) sampled agreed with itself; the validator does not appear to be derived from the picture"
  }

  # One cover file copied into two folders, which a multi-disc release does as a matter of
  # course, gives two albums a shared value legitimately, so a collision between a pair is not
  # the fault. The fault is the whole sample collapsing to one value, which says the fold never
  # reaches the picture at all.
  $distinctValues = @($samples | ForEach-Object { $_.ETags } | Select-Object -Unique)
  Write-Host "    distinct cover value(s) across the sample: $($distinctValues.Count)"
  if ($distinctValues.Count -eq 1) {
    throw "every album among $($samples.Count) sampled carries the same cover ETag; the fold does not appear to read the picture"
  }
}

# Guarded the way Get-CurrentLibraryRevision is: GET /library never needs a warm snapshot
# itself, but the value this reads is only meaningful as the baseline for a rebuild the caller
# is about to force on one.
function Get-CurrentLibraryStructure {
  return [uint64](Get-CurrentLibraryState).structure
}

# POST /library/refresh rebuilds only this component's own in-memory snapshot: it writes no
# tag, no playlist and no file. It is still the most disruptive thing this script does to a
# running player, which is why -Full gates this check outright rather than only the build a
# cold snapshot would otherwise need, and why the check runs last. Its rate limiter is a burst of
# three refilling one every thirty seconds, sized for a person pressing a button rather than a
# loop.
Invoke-Check -Name "a forced rebuild reproduces the same ordinal order, position by position" -Body {
  if (-not $Full) {
    Skip-Check "forces a rebuild; run with -Full to include it"
  }

  $before = Get-LibraryAddresses (Get-LibrarySpine)
  $structureBefore = Get-CurrentLibraryStructure

  $refresh = Invoke-ApiProbe "$FooJean/library/refresh" 'Post' $auth
  if ($refresh.StatusCode -ne 202) {
    throw "POST /library/refresh answered $($refresh.StatusCode), not 202"
  }

  $script:libraryExportBytes = $null
  $script:librarySpine = $null
  # Library::replace() in core/library.cpp increments structure on every rebuild, whether or
  # not the walk found a different set of tracks, which is what makes waiting for it to move
  # past $structureBefore a reliable signal that this refresh finished rather than a guess at
  # how long a walk takes. A rebuild re-walks and re-formats every track exactly as the first
  # build does, so there is no basis here for a shorter ceiling than
  # $script:LibraryBuildTimeoutSeconds; a run that needs longer is evidence for raising that
  # shared constant, not for a second one.
  Wait-ForDeclaredColumns $script:LibraryBuildTimeoutSeconds $structureBefore

  $after = Get-LibraryAddresses (Get-LibrarySpine)
  if ($after.Length -ne $before.Length) {
    throw "the rebuilt export holds $($after.Length) row(s), the first held $($before.Length); the two are not comparable position by position"
  }

  # A different structure between the two exports is this check working, not a race to retry:
  # it is forced on purpose, to prove get_all_items's undefined order still lands on the same
  # ordinals once ordinalOrder (core/library.cpp) has sorted it twice.
  $moved = Get-PositionMismatchCount $before $after
  Write-Host "    positions naming a different path after the rebuild: $moved of $($before.Length)"
  if ($moved -gt 0) {
    throw "$moved of $($before.Length) position(s) named a different path after a forced rebuild"
  }
}

Write-Host ""
Write-Host "$($script:passed) passed, $($script:skipped) skipped, $($script:failed) failed"
if ($script:failed -gt 0) {
  throw "$($script:failed) check(s) failed"
}
