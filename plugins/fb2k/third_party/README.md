# Vendored dependencies

Committed rather than fetched. The foobar2000 SDK is fetched because its licence forbids redistribution; everything here is permissively licensed and carries no such restriction, so vendoring means a checkout builds and tests with no network and no package manager.

| | version | licence | why |
|---|---|---|---|
| `httplib.h` | cpp-httplib 0.65.0, tag `v0.65.0` at `7e5d0683` | MIT | the HTTP server |
| `json.hpp` | nlohmann/json 3.12.0 | MIT | reading and writing `config.json`, and every API document |
| `doctest.h` | doctest 2.5.3 | MIT | the test suite. Not linked into the component |
| `zlib/` | zlib 1.4, tag `v1.4` at commit `99623ef7` | zlib | gzip. It is what cpp-httplib's compressor is written against |

All four are **unmodified**, and that is checked against upstream rather than assumed: the three single headers are byte-identical to their tags, and every file in `zlib/` is byte-identical to the file of that name at `99623ef7`. Upgrading is replacing the files and rebuilding. Do not patch them in place, because the next upgrade would silently drop the patch. If one of them needs different behaviour, wrap it in this component's own code instead, which is what `src/core/http_server.cpp` does for the socket options below.

`scripts/format.sh` and `.editorconfig` both skip this directory: reformatting a library nobody here owns would turn every version bump into a merge.

## Four things about `httplib.h` that are load-bearing

**Its default socket options are wrong for this component on Windows.** `default_socket_options` sets `SO_REUSEPORT` where that exists and falls back to `SO_REUSEADDR`; Windows has no `SO_REUSEPORT`, so it takes the fallback. On Windows a second `SO_REUSEADDR` bind to a port an `SO_REUSEADDR` socket is already listening on **succeeds**, and the two sockets then split traffic with no error anywhere. Another process on the same port that sets `SO_REUSEADDR` too is therefore the exact collision the component must be able to detect. `src/core/http_server.cpp` replaces the options with `SO_EXCLUSIVEADDRUSE`; `tests/listener_test.cpp` is the guard.

**`set_payload_max_length` only bounds a request to a route that reads a body.** Routing happens before the body is read, so a POST to a path with no handler is answered `404` with the limit never consulted, whatever the body's size. Once `POST /api/tags` existed the limit became testable and holds: the handler is never reached and the answer is `413`. Worth remembering for the next route, because a limit that looks configured is not the same as a limit that fires.

One consequence for clients: over the limit the server answers `413` and closes while the rest of the body is still in flight, so whether the client reads that `413` or only sees the connection drop is a race. Expect either.

**Its `ThreadPool` grows while queued jobs outnumber idle threads, up to the ceiling `connectionPoolFor` gives it through `new_task_queue`, wrapped so a refused thread cannot end the player.** `tests/connection_pool_test.cpp` is the guard: its burst case fails a pool that grows only when it counts no idle thread. `CPPHTTPLIB_LISTEN_BACKLOG` is still the library's 128.

**What gets gzipped is decided by content type, and that is the only thing keeping the audio stream out of the compressor.** `CPPHTTPLIB_ZLIB_SUPPORT` turns compression on and cpp-httplib does the rest by itself for every route but one: `POST /api/library/rows` gzips its own body, because `application/octet-stream` is on neither of its lists, and a handler that has set `Content-Encoding` itself is one it then leaves alone. `can_compress_content_type` admits `text/*`, a fixed list of `application/` types and `image/svg+xml`, and no other image type, which is why every document this component publishes is compressed and `audio/ogg` and `audio/aac` are not. Chunked content providers are compressed too, so that content-type check is load-bearing rather than incidental, and `tests/compression_test.cpp` is what holds it across an upgrade. Define the macro over a whole build and never over one translation unit: cpp-httplib is header-only and `inline`, so a file compiled without it defines a different `httplib::detail::make_compressor` and the linker picks one of the two. `src/foo_jean.vcxproj` and `scripts/test.sh` each set it once, for everything they compile. `tests/compression_test.cpp` also has to defeat `httplib::Client`'s own decompression, which unwraps a gzip body before a caller sees it; `set_decompress(false)` is what leaves the wire bytes, and the gzip magic number, visible to the test.

## `zlib/` is zlib's compression sources and nothing else

`gzclose.c`, `gzlib.c`, `gzread.c` and `gzwrite.c` are deliberately absent. They are zlib's stdio wrapper, nothing here opens a file through zlib, and they need a `configure` run to find `<unistd.h>` before they will build at all. `gzguts.h` stays, because `zutil.c` includes it. Everything else zlib ships at its top level is here, so `third_party/zlib/*.c` is the whole build in both `src/foo_jean.vcxproj` and `scripts/test.sh`, and a version bump is a copy over the directory with those four files dropped again.

## Why zlib and not miniz

**miniz cannot do this job, and looking at its feature list will suggest otherwise.** It is one file, public domain, and exposes zlib-compatible names, so it is the obvious pick and it is wrong: `mz_deflateInit2` and `mz_inflateInit2` accept a `window_bits` of `MZ_DEFAULT_WINDOW_BITS` or its negation and nothing else. cpp-httplib's `gzip_compressor` asks for 31, meaning 15 plus a gzip wrapper, and its `gzip_decompressor` asks for 47. Both come back `MZ_PARAM_ERROR`, which sets `is_valid_` false, which under `NDEBUG` is not an assertion but a compressor that runs anyway and writes what no client can read. miniz has no gzip container at any entry point: raw deflate and the zlib wrapper are all it writes.

The foobar2000 SDK has nothing either. There is no zlib, no bundled codec and no deflate helper anywhere in `SDK/`, `helpers/`, `shared/`, `pfc/` or `libPPUI/`, and `shared-x64.lib` exports none. That is the whole reason a compressor is vendored beside cpp-httplib at all.

## Why cpp-httplib and not Boost.Beast

Boost.Beast needs Boost, and Boost built from source wants CMake or its own build system. This component builds with MSBuild, because that is what the foobar2000 SDK ships and it is the reason the toolchain works at all. One header costs no build system. Reconsider if thread-per-connection ever becomes the constraint; it will show up first in streaming.

## Why doctest and not Catch2 or GoogleTest

Same reason: one header, no build step, no package manager. doctest is a reimplementation of Catch2 focused on compile speed, and it is the only one of the three that drops into a project like this without a `CMakeLists.txt` appearing. `scripts/test.sh` is a short compiler invocation as a result.
