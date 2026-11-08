#!/usr/bin/env bash
# Fetches libopus and libogg into third_party/, where the Ogg Opus encoder expects them.
set -euo pipefail

opus_version=1.5.2
ogg_version=1.3.5
opus_sha=65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1
ogg_sha=0eb4b4b9420a0f51db142ba3f9c64b333f826532dc0f48c6410ae51f4799b664

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
third_party="$root/third_party"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

verify() {
  local file=$1
  local want=$2
  local got
  got=$(shasum -a 256 "$file" | cut -d' ' -f1)
  if [ "$got" != "$want" ]; then
    echo "checksum mismatch for $file: expected $want, got $got" >&2
    exit 1
  fi
}

write_ogg_config_types() {
  # libogg ships config_types.h.in for configure or cmake to fill in, and we run neither.
  cat > "$third_party/ogg/include/ogg/config_types.h" <<'TYPES'
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
TYPES
}

# A directory is current when its .fetched holds this version and hash. Anything else, a missing
# record included, is fetched again: the download is verified before the old directory goes, so a
# failed fetch leaves the old library in place.
fetch() {
  local name=$1
  local version=$2
  local url=$3
  local sha=$4
  local stripped=$5
  local target="$third_party/$name"

  if [ "$(cat "$target/.fetched" 2>/dev/null)" = "$version $sha" ]; then
    echo "$name $version is current"
    return
  fi

  curl -fsSL -o "$work/$name.tar.gz" "$url"
  verify "$work/$name.tar.gz" "$sha"
  # -m stamps every file with now, so test.sh sees a refetched source as newer than its archive.
  tar xzmf "$work/$name.tar.gz" -C "$work"
  rm -rf "$target"
  mv "$work/$stripped" "$target"
  if [ "$name" = ogg ]; then
    write_ogg_config_types
  fi
  echo "$version $sha" >"$target/.fetched"
  echo "$name -> $target"
}

mkdir -p "$third_party"
fetch opus "$opus_version" "https://downloads.xiph.org/releases/opus/opus-$opus_version.tar.gz" \
  "$opus_sha" "opus-$opus_version"
fetch ogg "$ogg_version" "https://downloads.xiph.org/releases/ogg/libogg-$ogg_version.tar.gz" \
  "$ogg_sha" "libogg-$ogg_version"
