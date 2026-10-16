#!/usr/bin/env bash
# Builds foo_jean for macOS. Needs a Mac with the Xcode command line tools and the foobar2000 SDK
# fetched by scripts/fetch-sdk.sh. Nothing is installed: plutil and /usr/bin/python3 ship with the
# command line tools, which clang needs anyway.
#
#   scripts/build-mac.sh
#
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${sdk:=$root/sdk}"
out="$root/bin/mac"

zlib="$root/third_party/zlib"

vendor_include=-isystem
# shellcheck source=lib/compile-flags.sh
. "$root/scripts/lib/compile-flags.sh"

: "${CXX:=c++}"
export CXX

if [ "$(uname -s)" != Darwin ]; then
  echo "build-mac.sh builds for macOS and runs on it only" >&2
  exit 1
fi

archs=(arm64 x86_64)

sdk_projects=(
  pfc/pfc.xcodeproj
  foobar2000/shared/shared.xcodeproj
  foobar2000/SDK/foobar2000_SDK.xcodeproj
  foobar2000/foobar2000_component_client/foobar2000_component_client.xcodeproj
)

# src/foo_jean.vcxproj compiles these three in place of the whole helpers library, which is mostly Windows.
sdk_helpers_project=foobar2000/helpers/foobar2000_SDK_helpers.xcodeproj
sdk_helper_sources=input_helpers.cpp,readers.cpp,file_list_helper.cpp

fail() {
  echo "build-mac.sh: $*" >&2
  exit 1
}

read_sdk_project() {
  local project="$1" dir="$2" only="${3-}" json status=0
  [ -f "$project" ] || fail "$project: no such file"
  json="$(mktemp)"
  plutil -convert json -o "$json" "$project" || {
    rm -f "$json"
    fail "$project: plutil cannot read it"
  }
  /usr/bin/python3 -I - "$project" "$json" "$dir" "$only" <<'PY' || status=$?
import json, os, sys

project, json_path, outdir, only = sys.argv[1:5]
CONFIGURATION = "Release"


def fail(message):
    sys.stderr.write("build-mac.sh: %s: %s\n" % (project, message))
    sys.exit(1)


try:
    with open(json_path) as handle:
        document = json.load(handle)
    objects, root = document["objects"], document["rootObject"]
except (OSError, ValueError, KeyError) as error:
    fail("cannot be read: %s" % error)

srcroot = os.path.dirname(os.path.dirname(os.path.abspath(project)))
project_object = objects[root]
targets = [objects[t] for t in project_object["targets"]]
if len(targets) != 1 or targets[0]["isa"] != "PBXNativeTarget":
    fail("expected exactly one native target, found %d" % len(targets))
target = targets[0]


def settings_of(list_id):
    for configuration_id in objects[list_id]["buildConfigurations"]:
        if objects[configuration_id]["name"] == CONFIGURATION:
            return objects[configuration_id]["buildSettings"]
    fail("no %s configuration" % CONFIGURATION)


project_settings = settings_of(project_object["buildConfigurationList"])
target_settings = settings_of(target["buildConfigurationList"])


def as_list(value):
    return [] if value is None else value if isinstance(value, list) else [value]


def setting(key):
    # A target's value replaces the project's, except where it says $(inherited).
    inherited = as_list(project_settings.get(key))
    if key not in target_settings:
        values = inherited
    else:
        values = []
        for item in as_list(target_settings[key]):
            values.extend(inherited if item == "$(inherited)" else [item])
    values = [item for item in values if item != "$(inherited)"]
    for item in values:
        if "$(" in item:
            fail("%s is %r, and the script does not expand variables" % (key, item))
    return values


def one(key):
    values = setting(key)
    return values[0] if values else None


parent = {}
for identifier, node in objects.items():
    for child in node.get("children", []):
        parent[child] = identifier


def path_of(identifier):
    node = objects[identifier]
    if node["isa"] != "PBXFileReference":
        fail("a source is %s, which the script does not read" % node["isa"])
    parts = []
    while identifier is not None:
        node = objects[identifier]
        if node.get("sourceTree") not in ("<group>", "SOURCE_ROOT"):
            fail("%s is relative to %s, which the script does not read" % (node.get("path"), node.get("sourceTree")))
        if node.get("path"):
            parts.insert(0, node["path"])
        identifier = parent.get(identifier) if node["sourceTree"] == "<group>" else None
    return os.path.normpath(os.path.join(srcroot, *parts))


sources_phases = [objects[p] for p in target["buildPhases"] if objects[p]["isa"] == "PBXSourcesBuildPhase"]
if len(sources_phases) != 1:
    fail("expected one Sources build phase, found %d" % len(sources_phases))

jobs = []
for build_file_id in sources_phases[0]["files"]:
    build_file = objects[build_file_id]
    if "settings" in build_file:
        fail("a source carries its own flags, which the script does not read")
    source = path_of(build_file["fileRef"])
    if not os.path.isfile(source):
        fail("names %s, which does not exist" % source)
    extension = os.path.splitext(source)[1]
    kind = {".cpp": "cxx", ".cc": "cxx", ".cxx": "cxx", ".mm": "objcxx", ".c": "c", ".m": "objc"}.get(extension)
    if kind is None:
        fail("%s has an extension the script does not compile" % source)
    jobs.append((kind, source))
if only:
    wanted = only.split(",")
    names_in_phase = [os.path.basename(source) for _, source in jobs]
    for file_name in wanted:
        if file_name not in names_in_phase:
            fail("its Sources build phase does not name %s" % file_name)
    jobs = [job for job in jobs if os.path.basename(job[1]) in wanted]
if not jobs:
    fail("its Sources build phase is empty")

common = []
prefix_header = one("GCC_PREFIX_HEADER")
if prefix_header:
    header = os.path.normpath(os.path.join(srcroot, prefix_header))
    if not os.path.isfile(header):
        fail("names the prefix header %s, which does not exist" % header)
    common += ["-include", header]
objc = []
if one("CLANG_ENABLE_OBJC_ARC") == "YES":
    objc.append("-fobjc-arc")
if one("CLANG_ENABLE_OBJC_WEAK") == "YES":
    objc.append("-fobjc-weak")
if one("GCC_ENABLE_OBJC_EXCEPTIONS") == "YES":
    objc.append("-fobjc-exceptions")
for search_path in setting("HEADER_SEARCH_PATHS"):
    common.append("-I" + os.path.normpath(os.path.join(srcroot, search_path)))
for definition in setting("GCC_PREPROCESSOR_DEFINITIONS"):
    common.append("-D" + definition)

cxx_standard = one("CLANG_CXX_LANGUAGE_STANDARD")
if not cxx_standard:
    fail("CLANG_CXX_LANGUAGE_STANDARD is not set")
c_standard = one("GCC_C_LANGUAGE_STANDARD")
if not c_standard and any(kind in ("c", "objc") for kind, _ in jobs):
    fail("GCC_C_LANGUAGE_STANDARD is not set")


def quote(argument):
    return '"' + argument.replace("\\", "\\\\").replace('"', '\\"') + '"'


def write(name, data):
    path = os.path.join(outdir, name)
    try:
        with open(path, "rb") as handle:
            if handle.read() == data:
                return
    except OSError:
        pass
    with open(path, "wb") as handle:
        handle.write(data)


name = target["name"] + ("_selected" if only else "")
write(name + ".common.rsp", "".join(quote(a) + "\n" for a in common).encode())
standards = {"cxx": cxx_standard, "objcxx": cxx_standard, "c": c_standard, "objc": c_standard}
for kind, standard in standards.items():
    flags = (["-std=" + standard] if standard else []) + (objc if kind.startswith("objc") else [])
    write("%s.%s.rsp" % (name, kind), "".join(quote(a) + "\n" for a in flags).encode())
write(name + ".sources", b"".join(kind.encode() + b"\0" + source.encode() + b"\0" for kind, source in jobs))
print(name)
PY
  rm -f "$json"
  return "$status"
}

compile_sdk_library() {
  local name="$1" dir="$2" arch="$3" libdir="$out/$3/sdk"
  local archive="$libdir/lib$name.a" objdir="$libdir/obj/$name"
  local kind source object stale
  local objects=() queue=()

  if [ -f "$archive" ]; then
    stale=$(find "$sdk" "$dir" -type f -newer "$archive" -print -quit)
    [ -n "$stale" ] || return 0
  fi

  rm -rf "$objdir"
  mkdir -p "$objdir"
  while IFS= read -r -d '' kind && IFS= read -r -d '' source; do
    object="$objdir/${source#"$sdk"/}.o"
    objects+=("$object")
    queue+=("$kind" "$source" "$object")
  done <"$dir/$name.sources"

  printf '%s\0' "${queue[@]}" | xargs -0 -n 3 -P "$(getconf _NPROCESSORS_ONLN)" sh -c '
    kind=$1 source=$2 object=$3
    mkdir -p "$(dirname "$object")"
    exec "$CXX" -arch "$ARCH" @"$DIR/base.rsp" @"$DIR/$NAME.common.rsp" @"$DIR/$NAME.$kind.rsp" -c "$source" -o "$object"
  ' sh
  rm -f "$archive"
  ar rcs "$archive" "${objects[@]}"
}

build_sdk_archives() {
  local dir="$out/sdk-projects" project name arch flag

  mkdir -p "$dir"
  # foobar2000 catches its host's exceptions across the component boundary, which hidden
  # visibility breaks, whatever a project says.
  {
    for flag in -fvisibility=default -Os ${platform_flags[@]+"${platform_flags[@]}"}; do
      echo "\"$flag\""
    done
  } >"$dir/base.rsp.new"
  if cmp -s "$dir/base.rsp.new" "$dir/base.rsp" 2>/dev/null; then
    rm "$dir/base.rsp.new"
  else
    mv "$dir/base.rsp.new" "$dir/base.rsp"
  fi

  sdk_libraries=()
  for project in "${sdk_projects[@]}"; do
    name=$(read_sdk_project "$sdk/$project/project.pbxproj" "$dir")
    sdk_libraries+=("$name")
  done
  name=$(read_sdk_project "$sdk/$sdk_helpers_project/project.pbxproj" "$dir" "$sdk_helper_sources")
  sdk_libraries+=("$name")

  export DIR="$dir"
  for arch in "${archs[@]}"; do
    mkdir -p "$out/$arch/sdk"
    for name in "${sdk_libraries[@]}"; do
      echo "sdk: $name ($arch)"
      ARCH="$arch" NAME="$name" compile_sdk_library "$name" "$dir" "$arch"
    done
  done
}

write_rsp() {
  local file="$1" arg
  shift
  for arg in "$@"; do
    printf '"%s"\n' "$(printf '%s' "$arg" | sed 's/[\\"]/\\&/g')"
  done >"$file.new"
  if cmp -s "$file.new" "$file" 2>/dev/null; then
    rm "$file.new"
  else
    mv "$file.new" "$file"
  fi
}

require_embed_table() {
  [ -f "$root/src/fb2k/ui_assets_table.cpp" ] ||
    fail "No Jean page to compile in: src/fb2k/ui_assets_table.cpp is missing. Run 'pnpm --dir ui build' and then 'node plugins/fb2k/scripts/embed-ui.mjs'."
  [ -z "$fb2k_skipped" ] || fail "$fb2k_skipped"
}

build_component_objects() {
  local arch="$1" dir="$out/component-flags" archdir="$out/$1"
  local base="$out/sdk-projects/base.rsp"
  local codec_sources zlib_sources

  mkdir -p "$dir"
  write_rsp "$dir/core.rsp" "${compile_flags[@]}" -DNDEBUG "${warning_flags[@]}" "${core_warning_flags[@]}"
  write_rsp "$dir/fb2k.rsp" "${fb2k_compile_flags[@]}" -DNDEBUG "${warning_flags[@]}"
  write_rsp "$dir/objc.rsp" "${fb2k_objc_compile_flags[@]}" -DNDEBUG "${warning_flags[@]}"
  write_rsp "$dir/table.rsp" "${fb2k_compile_flags[@]}" -DNDEBUG -w
  write_rsp "$dir/codec.rsp" "${codec_defines[@]}" "${vendor_c_flags[@]}" "${codec_include_flags[@]}"
  write_rsp "$dir/zlib.rsp" "${vendor_c_flags[@]}"

  codec_sources=$(codec_source_files)
  zlib_sources=$(ls "$zlib"/*.c)

  local fb2k_all=("${fb2k_sources[@]}") name source
  for name in "${fb2k_generated_sources[@]}"; do
    fb2k_all+=("$root/src/fb2k/$name")
  done

  component_objects=()
  for source in "$root"/src/core/*.cpp "${fb2k_all[@]}"; do
    component_objects+=("$archdir/obj/${source#"$root"/}")
  done
  component_objects=("${component_objects[@]/%.cpp/.o}")
  component_objects=("${component_objects[@]/%.mm/.o}")

  make -s -j "$(getconf _NPROCESSORS_ONLN)" -f - \
    ROOT="$root" OUT="$archdir" ARCH="$arch" CXX="$CXX" CC="${CC:-cc}" BASE="$base" FLAGS="$dir" \
    CORE_SRC="$(echo "$root"/src/core/*.cpp)" FB2K_SRC="${fb2k_all[*]}" \
    CODEC_SRC="$(echo $codec_sources)" ZLIB_SRC="$(echo $zlib_sources)" <<'MK'
cxx_obj = $(patsubst $(ROOT)/%.mm,$(OUT)/obj/%.o,$(patsubst $(ROOT)/%.cpp,$(OUT)/obj/%.o,$(1)))
c_obj = $(patsubst $(ROOT)/%.c,$(OUT)/obj/%.o,$(1))
TABLE_OBJ := $(OUT)/obj/src/fb2k/ui_assets_table.o
COMPONENT := $(call cxx_obj,$(CORE_SRC) $(FB2K_SRC))
CODEC := $(call c_obj,$(CODEC_SRC))
ZLIB := $(call c_obj,$(ZLIB_SRC))

all: $(COMPONENT) $(OUT)/libcodec.a $(OUT)/libz.a

$(OUT)/libcodec.a: $(CODEC)
	@rm -f $@ && ar rcs $@ $^
$(OUT)/libz.a: $(ZLIB)
	@rm -f $@ && ar rcs $@ $^

$(OUT)/obj/src/core/%.o: $(ROOT)/src/core/%.cpp $(FLAGS)/core.rsp $(BASE)
	@mkdir -p $(dir $@)
	$(CXX) -arch $(ARCH) @$(BASE) @$(FLAGS)/core.rsp -MMD -MP -c $< -o $@
$(OUT)/obj/src/fb2k/%.o: $(ROOT)/src/fb2k/%.cpp $(FLAGS)/fb2k.rsp $(BASE)
	@mkdir -p $(dir $@)
	$(CXX) -arch $(ARCH) @$(BASE) @$(FLAGS)/fb2k.rsp -MMD -MP -c $< -o $@
$(OUT)/obj/src/fb2k/%.o: $(ROOT)/src/fb2k/%.mm $(FLAGS)/objc.rsp $(BASE)
	@mkdir -p $(dir $@)
	$(CXX) -arch $(ARCH) @$(BASE) @$(FLAGS)/objc.rsp -MMD -MP -c $< -o $@
$(TABLE_OBJ): $(ROOT)/src/fb2k/ui_assets_table.cpp $(FLAGS)/table.rsp $(BASE)
	@mkdir -p $(dir $@)
	$(CXX) -arch $(ARCH) @$(BASE) @$(FLAGS)/table.rsp -c $< -o $@
$(OUT)/obj/third_party/%.o: $(ROOT)/third_party/%.c $(FLAGS)/codec.rsp $(BASE)
	@mkdir -p $(dir $@)
	$(CC) -arch $(ARCH) @$(BASE) @$(FLAGS)/codec.rsp -c $< -o $@
$(OUT)/obj/third_party/zlib/%.o: $(ROOT)/third_party/zlib/%.c $(FLAGS)/zlib.rsp $(BASE)
	@mkdir -p $(dir $@)
	$(CC) -arch $(ARCH) @$(BASE) @$(FLAGS)/zlib.rsp -c $< -o $@

-include $(COMPONENT:.o=.d)
MK
}

# The frameworks are what the SDK's own foo_sample links, plus AudioToolbox for the AAC encoder.
link_component() {
  local arch="$1" archdir="$out/$1" lib="$out/$1/sdk"
  "$CXX" -arch "$arch" @"$out/sdk-projects/base.rsp" -bundle -o "$archdir/foo_jean" \
    "${component_objects[@]}" \
    "$lib/libfoobar2000_component_client.a" "$lib/libfoobar2000_SDK_helpers_selected.a" \
    "$lib/libfoobar2000_SDK.a" "$lib/libshared.a" "$lib/libpfc.a" \
    "$archdir/libcodec.a" "$archdir/libz.a" \
    -framework Cocoa -framework AudioToolbox -framework CoreFoundation
}

# The signature comes last: one made before lipo does not cover the joined file.
assemble_bundle() {
  local bundle="$out/foo_jean.component" version arch flag binaries=()
  version=$(sed -n 's/.*kVersion\[\] *= *"\([^"]*\)".*/\1/p' "$root/src/core/version.h")
  [ -n "$version" ] || fail "src/core/version.h: no kVersion"

  rm -rf "$bundle"
  mkdir -p "$bundle/Contents/MacOS"
  for arch in "${archs[@]}"; do
    binaries+=("$out/$arch/foo_jean")
  done
  lipo -create "${binaries[@]}" -output "$bundle/Contents/MacOS/foo_jean"

  cp "$root/scripts/Info.plist" "$bundle/Contents/Info.plist"
  plutil -replace CFBundleShortVersionString -string "$version" "$bundle/Contents/Info.plist"
  plutil -replace CFBundleVersion -string "$version" "$bundle/Contents/Info.plist"
  local floor=""
  for flag in ${platform_flags[@]+"${platform_flags[@]}"}; do
    case "$flag" in -mmacosx-version-min=*) floor="${flag#-mmacosx-version-min=}" ;; esac
  done
  [ -n "$floor" ] || fail "compile-flags.sh states no -mmacosx-version-min"
  plutil -insert LSMinimumSystemVersion -string "$floor" "$bundle/Contents/Info.plist"

  codesign --force -s - "$bundle"
}

build_component() {
  local arch
  for arch in "${archs[@]}"; do
    echo "component: $arch"
    build_component_objects "$arch"
    link_component "$arch"
  done
  assemble_bundle
}

require_embed_table
build_sdk_archives
build_component
