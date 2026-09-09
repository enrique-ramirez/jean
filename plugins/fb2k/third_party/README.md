# Vendored dependencies

Single-header libraries, committed rather than fetched. The foobar2000 SDK is
fetched because its licence forbids redistribution; these are MIT and carry no such
restriction, so vendoring means a checkout builds and tests with no network and no
package manager.

| | version | licence | why |
|---|---|---|---|
| `httplib.h` | cpp-httplib 0.54.1 **+1**, master at `7d53a31d` | MIT | the HTTP server |
| `json.hpp` | nlohmann/json 3.12.0 | MIT | reading and writing `config.json`, and every API document |
| `doctest.h` | doctest 2.5.3 | MIT | the test suite. Not linked into the component |

All three are **unmodified by us**, and that is measured rather than assumed: diffed
against upstream on 2026-09-02. `json.hpp` and `doctest.h` are byte-identical to their
`v3.12.0` and `v2.5.3` tags; `httplib.h` is byte-identical to master, which is the
wrinkle below. Upgrading is replacing the file and rebuilding; do not patch them in place,
because the next upgrade would silently drop the patch. If one of them needs different
behaviour, wrap it in our own code instead — which is what `src/core/http_server.cpp`
does for the socket options below.

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

## Three things about `httplib.h` that are load-bearing

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
