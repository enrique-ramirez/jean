# Reads foo_jean's JSON answers for the verify scripts. foo_jean sends application/json with no
# charset, and PowerShell 5.1 then decodes it as ISO-8859-1, turning an accented path into mojibake
# that names no file. The raw bytes are decoded as UTF-8 by hand.
function Get-Json($uri, $headers = @{}, $method = 'GET', $body = $null) {
  $call = @{ Uri = $uri; Headers = $headers; Method = $method; UseBasicParsing = $true; TimeoutSec = 30 }
  if ($null -ne $body) { $call.Body = $body }
  if ($method -ieq 'POST') { $call.ContentType = 'application/json' }
  $resp = Invoke-WebRequest @call
  if ($resp.RawContentStream.Length -eq 0) { return $null }
  [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
}
