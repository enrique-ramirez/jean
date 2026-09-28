# Dot-source it:  . "$PSScriptRoot\lib\download.ps1"

function Save-VerifiedDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$OutFile,
        [Parameter(Mandatory = $true)][string]$Sha256
    )

    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing

    $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutFile).Hash
    if ($got -ne $Sha256) {
        Remove-Item -LiteralPath $OutFile -Force
        throw "checksum mismatch for $Uri`: expected $Sha256, got $got"
    }
}
