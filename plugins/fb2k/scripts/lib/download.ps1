# Dot-source it:  . "$PSScriptRoot\lib\download.ps1"

function Assert-Sha256 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Sha256,
        [string]$Name = $Path
    )

    $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash
    if ($got -ne $Sha256) {
        throw "checksum mismatch for $Name`: expected $Sha256, got $got"
    }
}

function Save-VerifiedDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$OutFile,
        [Parameter(Mandatory = $true)][string]$Sha256
    )

    # curl.exe rather than Invoke-WebRequest, whose -MaximumRetryCount covers HTTP status codes only and so cannot retry a dropped connection.
    & curl.exe -sSL --fail --retry 5 --retry-all-errors -o $OutFile $Uri
    if ($LASTEXITCODE -ne 0) { throw "Download failed for $Uri (curl exit $LASTEXITCODE)." }

    try {
        Assert-Sha256 -Path $OutFile -Sha256 $Sha256 -Name $Uri
    }
    catch {
        Remove-Item -LiteralPath $OutFile -Force
        throw
    }
}
