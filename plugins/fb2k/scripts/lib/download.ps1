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

    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing

    try {
        Assert-Sha256 -Path $OutFile -Sha256 $Sha256 -Name $Uri
    }
    catch {
        Remove-Item -LiteralPath $OutFile -Force
        throw
    }
}
