# Fetches libopus and libogg into third_party/, where the Ogg Opus encoder expects them.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib\download.ps1"

$opusVersion = '1.5.2'
$oggVersion = '1.3.5'
$opusSha = '65C1D2F78B9F2FB20082C38CBE47C951AD5839345876E46941612EE87F9A7CE1'
$oggSha = '0EB4B4B9420A0F51DB142BA3F9C64B333F826532DC0F48C6410AE51F4799B664'

$root = Split-Path -Parent $PSScriptRoot
$thirdParty = Join-Path $root 'third_party'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())

function Fetch($name, $url, $sha, $stripped) {
    $target = Join-Path $thirdParty $name
    if (Test-Path $target) {
        Write-Host "$name is already here; delete $target to refetch"
        return
    }

    $archive = Join-Path $work "$name.tar.gz"
    Save-VerifiedDownload -Uri $url -OutFile $archive -Sha256 $sha

    # tar has shipped with Windows since 1803, so there is no unpacking library here.
    tar xzf $archive -C $work
    if ($LASTEXITCODE -ne 0) { throw "could not unpack $name" }

    Move-Item (Join-Path $work $stripped) $target
    Write-Host "$name -> $target"
}

New-Item -ItemType Directory -Force -Path $work | Out-Null
New-Item -ItemType Directory -Force -Path $thirdParty | Out-Null

try {
    Fetch 'opus' "https://downloads.xiph.org/releases/opus/opus-$opusVersion.tar.gz" `
        $opusSha "opus-$opusVersion"
    Fetch 'ogg' "https://downloads.xiph.org/releases/ogg/libogg-$oggVersion.tar.gz" `
        $oggSha "libogg-$oggVersion"

    # libogg ships config_types.h.in for configure or cmake to fill in, and we run neither.
    $configTypes = @'
#ifndef __CONFIG_TYPES_H__
#define __CONFIG_TYPES_H__

#include <stdint.h>

typedef int16_t ogg_int16_t;
typedef uint16_t ogg_uint16_t;
typedef int32_t ogg_int32_t;
typedef uint32_t ogg_uint32_t;
typedef int64_t ogg_int64_t;
typedef uint64_t ogg_uint64_t;

#endif
'@
    Set-Content -LiteralPath (Join-Path $thirdParty 'ogg\include\ogg\config_types.h') `
        -Value $configTypes -Encoding ascii
}
finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $work
}
