# Vendored dependencies

Committed rather than fetched. The foobar2000 SDK is fetched because its licence
forbids redistribution; everything here is permissively licensed and carries no such
restriction, so vendoring means a checkout builds and tests with no network and no
package manager.

| | version | licence | why |
|---|---|---|---|
| `httplib.h` | cpp-httplib 0.54.1 **+1**, master at `7d53a31d` | MIT | the HTTP server |
| `json.hpp` | nlohmann/json 3.12.0 | MIT | reading and writing `config.json`, and every API document |
| `doctest.h` | doctest 2.5.3 | MIT | the test suite. Not linked into the component |
| `zlib/` | zlib 1.3.1, tag `v1.3.1` at commit `51b7f2ab` | zlib | gzip. It is what cpp-httplib's compressor is written against |

All four are **unmodified by us**, and that is measured rather than assumed. The three single headers were diffed against upstream on 2026-09-02: `json.hpp` and `doctest.h` are byte-identical to their `v3.12.0` and `v2.5.3` tags, and `httplib.h` to master, which is the wrinkle below. Every file in `zlib/` is byte-identical to the file of that name at `51b7f2ab`. Upgrading is replacing the files and rebuilding; do not patch them in place, because the next upgrade would silently drop the patch. If one of them needs different behaviour, wrap it in our own code instead, which is what `src/core/http_server.cpp` does for the socket options below.

**`httplib.h` is master, not the `v0.54.1` tag, and the version macro does not say so.**
It is `7d53a31d` (2026-09-01), exactly one commit ahead of the tag — *"Don't compress a
response whose handler already set Content-Encoding"*, upstream #2575 — and upstream had
not yet bumped `CPPHTTPLIB_VERSION`, so both read `0.54.1`. Downloading "0.54.1" to
upgrade would therefore *revert* that commit while every version string still agreed,
which is the quietest kind of regression. **Check the SHA, not the macro.**

That commit is not idle for us either: it rewrites the chosen content coding onto chunked
content providers and into `apply_ranges()`, which is exactly the machinery goal 3 —
streaming — will be built on.

`scripts/format.sh` and `.editorconfig` both skip this directory: reformatting
48,000 lines we do not own would turn every version bump into a merge.

## Four things about `httplib.h` that are load-bearing

**Its default socket options are wrong for us on Windows.** `default_socket_options`
sets `SO_REUSEPORT` where that exists and falls back to `SO_REUSEADDR`; Windows has
no `SO_REUSEPORT`, so it takes the fallback. Measured on the player, a second
`SO_REUSEADDR` bind to a port an `SO_REUSEADDR` socket is already listening on
**succeeds**, and the two sockets then split traffic with no error anywhere. Since
`foo_jean` runs alongside `foo_beefweb`, which sets that option too, that is the
exact collision we must be able to detect. `src/core/http_server.cpp` replaces the
options with `SO_EXCLUSIVEADDRUSE`; `tests/listener_test.cpp` is the guard.

**`set_payload_max_length` only bounds a request to a route that reads a body.**
Measured on 2026-09-01: routing happens before the body is read, so a POST to a path
with no handler is answered `404` with the limit never consulted — a 1 MB body gets a
404, and a 2 MB one only fails because the client cannot finish writing into a socket
that has already been answered and closed.

Once `POST /api/tags` existed the limit became testable and holds: **413 from 256 KB
up, with the handler never reached.** Worth remembering for the next route — a limit
that looks configured is not the same as a limit that fires.

One consequence for clients: over the limit the server answers 413 and closes while
the rest of the body is still in flight, so whether the client reads that 413 or just
sees the connection drop is a race — roughly one time in three on loopback. Expect
either.

**Concurrency is bounded by the library, not by us.**
`CPPHTTPLIB_THREAD_POOL_COUNT` is `max(8, hardware_concurrency - 1)`, and
`CPPHTTPLIB_LISTEN_BACKLOG` is 128. We set no thread pool of our own; there is no
unbounded-thread hazard to fix, so there is no code here fixing one.

**What gets gzipped is decided by content type, and that is the only thing keeping the audio stream out of the compressor.** `CPPHTTPLIB_ZLIB_SUPPORT` turns compression on and cpp-httplib does the rest by itself for every route but two: `GET /api/library/export` and `GET /api/library/changes` gzip their own bodies, because `application/octet-stream` is on neither of its lists, and a handler that has set `Content-Encoding` itself is one it then leaves alone. `can_compress_content_type` admits `text/*` and a fixed list of `application/` types, which is why every document this component publishes is compressed and `audio/ogg` and `audio/aac` are not. Chunked content providers are compressed too, so that content-type check is load-bearing rather than incidental, and `tests/compression_test.cpp` is what holds it across an upgrade. Define the macro over a whole build and never over one translation unit: cpp-httplib is header-only and `inline`, so a file compiled without it defines a different `httplib::detail::make_compressor` and the linker picks one of the two. `src/foo_jean.vcxproj` and `scripts/test.sh` each set it once, for everything they compile. `tests/compression_test.cpp` also has to defeat `httplib::Client`'s own decompression, which unwraps a gzip body before a caller sees it; `set_decompress(false)` is what leaves the wire bytes, and the gzip magic number, visible to the test.

## `zlib/` is zlib's compression sources and nothing else

`gzclose.c`, `gzlib.c`, `gzread.c` and `gzwrite.c` are deliberately absent. They are zlib's stdio wrapper, nothing here opens a file through zlib, and they need a `configure` run to find `<unistd.h>` before they will build at all. `gzguts.h` stays, because `zutil.c` includes it. Everything else zlib ships at its top level is here, so `third_party/zlib/*.c` is the whole build in both `src/foo_jean.vcxproj` and `scripts/test.sh`, and a version bump is a copy over the directory with those four files dropped again.

## Why zlib and not miniz

**miniz cannot do this job, and looking at its feature list will suggest otherwise.** It is one file, public domain, and exposes zlib-compatible names, so it is the obvious pick and it is wrong: `mz_deflateInit2` and `mz_inflateInit2` accept a `window_bits` of `MZ_DEFAULT_WINDOW_BITS` or its negation and nothing else. cpp-httplib's `gzip_compressor` asks for 31, meaning 15 plus a gzip wrapper, and its `gzip_decompressor` asks for 47. Both come back `MZ_PARAM_ERROR`, which sets `is_valid_` false, which under `NDEBUG` is not an assertion but a compressor that runs anyway. miniz has no gzip container at any entry point: raw deflate and the zlib wrapper are all it writes.

The foobar2000 SDK has nothing either. There is no zlib, no bundled codec and no deflate helper anywhere in `SDK/`, `helpers/`, `shared/`, `pfc/` or `libPPUI/`, and `shared-x64.lib` exports none.

## Why cpp-httplib and not Boost.Beast

Boost.Beast is what beefweb uses, and beefweb builds Boost from source through a
CMake `ExternalProject`. We build with MSBuild, because that is what the foobar2000
SDK ships and it is the reason the toolchain works at all. One header costs no build
system. Reconsider if thread-per-connection ever becomes the constraint — it will
show up first in streaming, which is deliberately last.

## Why doctest and not Catch2 or GoogleTest

Same reason: one header, no build step, no package manager. doctest is a
reimplementation of Catch2 focused on compile speed, and it is the only one of the
three that drops into a project like this without a `CMakeLists.txt` appearing.
`scripts/test.sh` is nine lines of compiler invocation as a result.
