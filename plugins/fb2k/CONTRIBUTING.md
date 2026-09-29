# Contributing to foo_jean

How to write `foo_jean`'s code. The root `CONTRIBUTING.md` holds the rules the whole repository shares. `plugins/fb2k/README.md` is what the component is, how to build it and how to run its tests; `plugins/fb2k/ARCHITECTURE.md` is how the pieces fit and why the boundaries sit where they do; `plugins/fb2k/src/README.md` maps the source tree file by file. Setting up is `scripts/fetch-opus.sh` and `scripts/compile-commands.sh` once, then `scripts/test.sh` thereafter. Skip the second and an editor is wrong about this tree. See `plugins/fb2k/README.md`, *Testing*.

## 1. The `core/` / `fb2k/` boundary

The rationale, the enforcement and what the seam buys are in `plugins/fb2k/ARCHITECTURE.md`, *The one boundary*. The rules that follow from it:

1. **`src/core/` MUST NOT include a foobar2000 or Windows header.**
2. Anything `core/` needs from the player MUST arrive as a callback or a plain value handed in by `fb2k/`. The one exception is `core/log.h`, which declares `logInfo`/`logError` and lets each host supply them: `fb2k/log.cpp` in the component, `tests/support/log_capture.cpp` in the suite.
3. **Put the decision in `core/` and the mechanism in `fb2k/`.** A decision compiles and is tested on any machine; a mechanism is not.
4. `src/fb2k/` compiles for the first time on the build machine. A change there is *reviewed*, not *tested*, until `scripts/build.ps1` has run. State which of the two you did.
5. Headers live beside their sources. This is a DLL with no exported headers; do not restructure towards `include/` + `src/`.
6. The two directories deliberately share filenames, since each pair is one feature split at the boundary. `src/foo_jean.vcxproj` keeps their object files apart and says how beside the setting that does it. Keep it.

## 2. Comments and documentation

1. The one home for a shared fact: `core/json.h`, `core/text.h`, `core/http_server.h`'s `kMaxBodyBytes`, `core/failures.h` for every refusal sentence and status, `core/http_responses.h` for how a route answers, `fb2k/strings.h`, `fb2k/playlists.h`'s `playlistIndices()` and `tests/support/fixtures.h`.
2. A comment names the system it is about: the foobar2000 SDK, Windows, Media Foundation, libogg, libopus, cpp-httplib, MSVC or a browser. A fact about one of them that bites in several files goes in `plugins/fb2k/ARCHITECTURE.md`, *Facts about the player*, and the files depending on it point there in a clause.
3. Name each document in full, since the root and `ui/` keep files of the same names as this tree's.

## 3. Style

1. Match the file you are in.
2. `const` by default, on locals as well as parameters.
3. Prefer `std::transform`, `std::accumulate`, `std::any_of` and friends to a raw loop. A raw loop over an SDK count is usually a missing range; a second one is usually a missing shared function. `secureEquals` uses `std::inner_product` for a second reason: it has no early exit, which is the whole point of a constant-time compare.
4. **No ATL, no WTL, no MFC in this component's own code.** The SDK needs them to build itself; a component that draws one dialog does not. `fb2k/preferences.cpp` is a plain `DLGPROC` rather than the SDK's WTL-based `preferences_page_impl<>`, and dark mode comes from `fb2k::CCoreDarkModeHooks`.
5. Run `scripts/format.sh` and `scripts/lint.sh` before saying a change is ready, and `scripts\lint.ps1` on the build machine when `src/fb2k/` changed. All three want LLVM 23 and refuse another version; none touches `third_party/`.

## 4. Tests

1. Every change under `src/core/` needs a test. Writing it first is welcome.
2. **Run the whole suite.** `scripts/test.sh` builds incrementally and a filter narrows only what runs, never what compiles, so a filtered run costs the same. Filter to read less output; the script's header has the invocations.
3. Changes to documentation, comments, `.gitattributes` or editor configuration need no run at all.
4. Tests are feature-level. `tests/` starts a real `HttpServer` on a real port and drives it with a real HTTP client. **Assert what a client would see, not how the answer was arrived at.** A test that names a private function, or that would still pass if the component answered the wrong status, is testing the implementation.
5. **Assert that the refusal never reached the player.** Every route test carries a recording player and checks its call count, and the playlist and queue routes share one, `tests/support/fake_player.h`, a foobar2000 in memory that judges each call the way `src/fb2k/` does: "answered 403" and "answered 403 *and did not touch the disk*" are different promises, and only the second is the feature.
6. Fixtures live in `tests/support/`, never at the top of whichever file needed one first.
7. **Nothing sleeps.** `RateLimiter::allow` and the ticket store take the time as an argument for this reason. A test that waits to observe a limit fails on a loaded machine, which teaches everybody to ignore it. A route test's rate limits stand still until it calls `advanceRateLimits`. A case that needs another thread to be inside a wait asks `tests/support/eventually.h`, whose watchdog fails the case rather than hanging the suite.
8. Run the suite more than once before believing it: `tests/support/test_server.cpp` retries a port race. The assertion count is deterministic, so two runs of one tree that disagree are a real difference rather than weather. Nothing in the suite may make it depend on scheduling.
9. **Every change runs under `scripts/test.sh --sanitize=address` before it is called ready, and anything threaded under `--sanitize=thread` too.** A plain run on the Mac does not see a write past a buffer that MSVC's heap aborts on. Threaded code is `core/pcm_ring`, `core/broadcast_ring`, `core/audience`, `core/output_hold`, `core/stream_ticket`, `core/timeline`, `core/rate_limit`, `core/library`, `core/main_thread_queue` and `core/main_thread_watch`. It runs clean, so a report is a regression. **The flag has to come first**: `scripts/test.sh` reads only its first argument for it, so `--sanitize=thread` written after a `-sf=` filter is ignored and the run passes unsanitised while still reporting success.
10. `leaks` is macOS's own tool rather than LeakSanitizer, because LSan has no implementation on this platform and an ASan binary given `detect_leaks=1` aborts before `main`. It is a conservative scanner rather than a proof, so a clean run promises less than a green LeakSanitizer run would, and it fails outright anywhere but macOS.
11. **The suite reads `contract/openapi.yaml` at run time, and that file sits outside this tree.** Two tests drive every route the contract publishes, and a stale copy answers for a build that has different routes. `plugins/fb2k/` does not test on its own, though `scripts/build.ps1` and `scripts/package.ps1` read nothing outside it: whatever syncs the tree to a build machine syncs `contract/` with it, at the same position relative to it, because `tests/support/spec.cpp` and `scripts/test.sh` both reach the spec by climbing out of the plugin directory.
12. A doctest filter matching nothing exits 0, so a typo in one reports success.

### What a green suite does not cover

Each of these is unreachable from the suite by nature, so each says how it is verified instead. A seam whose only caller is a test does not close one: a fake that proves a fake works is worse than an honest gap.

| | how it is actually verified |
|---|---|
| Everything in `src/fb2k/` | compiled on the build machine. `scripts/verify-tag-write.ps1`, `verify-stream.ps1`, `verify-listeners.ps1` and `verify-library.ps1` drive four of its paths against a real player |
| A `setsockopt` failure, and the refusal to listen that follows | neither can be induced from a test, so the path is reviewed only |
| The AAC encoder | Windows-only and unreachable from the suite at all. `verify-stream.ps1` drives it |
| The preferences page's `GWLP_USERDATA` teardown | opening and closing **Preferences → Tools → Jean** is the whole test |
| A person at the player taking back the mute hold while a stream runs | no live coverage, since no verify script writes the volume or the mute; `tests/output_hold_test.cpp` holds it |
| `notOurs`, the guard refusing to touch a playlist this component did not create | no live coverage; exercised by hand against a playlist created for the purpose |

## 5. The HTTP contract

1. **Any change to a response shape, a status code or an error string changes `contract/openapi.yaml` in the same commit.** `plugins/fb2k/ARCHITECTURE.md`, *The HTTP contract*, is why the spec is hand-written and which two checks hold it to the code; neither of them can read prose.
2. **Anything that publishes a track path MUST publish the display form**, through `filesystem::g_get_display_path`. `plugins/fb2k/ARCHITECTURE.md`, *Track identity*, is why.

## 6. Security rules

1. Admission runs before anything else, on every path. A route that answers before the source address and `Host` are checked, or that carries its own exception from either check, is a security bug regardless of what the route does.
2. Compare a stream ticket in constant time.
3. Never trust a path from a client. Resolve against what the player reports; never concatenate.
4. Write only allowlisted fields, compared case-insensitively, and say in the response which field was refused.
5. Never log a stream ticket.
6. **Never set `SO_REUSEADDR`.** On Windows it lets a socket bind a port another socket is actively listening on, so two servers silently split the traffic on one port. The override to `SO_EXCLUSIVEADDRUSE` must stay; `third_party/README.md` is what it overrides and why that default is there.
7. A partial or failed bind MUST be loud, to the log and to the preferences page, because a headless install has nobody reading a console.
8. Refuse before doing. Validate, then act: the tests assert the order, not just the status.
9. **No response may compress request-controlled text beside a secret.** That is the BREACH shape: whoever can get a chosen string into a response and watch what it does to the compressed length reads the secret beside it a byte at a time. Compression is on wherever a client offers it, cpp-httplib's own for the JSON routes and this component's for the library blobs, so the rule sits on what a body may hold rather than on the compressor.
10. Pin every third-party download to a SHA-256, through `scripts/lib/download.ps1` in PowerShell, and every GitHub Action to a commit, with its version in a comment beside it.

## 7. PowerShell scripts

1. **Never invoke `foobar2000.exe` from a script.** Over SSH it starts a second instance in session 0. Everything goes through `scripts/lib/player.ps1`, which drives it through an interactive scheduled task.
2. foo_jean answers `application/json` with no charset parameter, and PowerShell 5.1 decodes that as ISO-8859-1 and turns every accented path into mojibake. Read the bytes and decode them as UTF-8 by hand: `[System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json`.
3. PowerShell 5.1 reads a BOM-less `.ps1` as Windows-1252, so a script MUST contain no non-ASCII literal. Derive such values at run time instead.
4. PowerShell's bitwise operators share one precedence level with comparison and associate left to right, so `-shl`/`-bor` do not read like the same expression in C. Use arithmetic where the grouping matters.
5. `ConvertFrom-Json` unwraps a one-element JSON array into the bare element, so a field that is a list everywhere else stops being one on the install that has a single entry. Wrap any such read in `@()`. The failure is silent and only that install sees it.
6. A generated file that `rc.exe` or `cl.exe` will read, rather than PowerShell, needs `-Encoding ascii`. The default still adds a UTF-8 BOM under PowerShell 5.1, and neither compiler skips it.
