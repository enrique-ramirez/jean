# Contributing to foo_jean

How to write `foo_jean`'s code. The root `CONTRIBUTING.md` holds the rules the whole repository shares.

## 1. The `core/` / `fb2k/` boundary

The rationale, the enforcement and what the seam buys are in `plugins/fb2k/ARCHITECTURE.md`, *The one boundary*. The rules that follow from it:

1. **`src/core/` MUST NOT include a foobar2000 header, nor an operating system header outside the files `tests/platform_seams_test.cpp` lists.**
2. Anything `core/` needs from the player MUST arrive as a callback or a plain value handed in by `fb2k/`. The one exception is `core/log.h`, which declares `logInfo`/`logError` and lets each host supply them: `fb2k/log.cpp` in the component, `tests/support/log_capture.cpp` in the suite.
3. **Put the decision in `core/` and the mechanism in `fb2k/`.** A decision compiles and is tested on any machine; a mechanism is not.
4. `src/fb2k/` is compiled and linked by both builds, parsed and linted on a Mac with the SDK fetched, and run only inside a player; the suite compiles the two AAC codec files and nothing else of it. A change there is *reviewed*, not *tested*, until `scripts\build.ps1` and `scripts/build-mac.sh` have run. State which of the two was run, and on which platform.
5. Headers live beside their sources: this component exports no headers.
6. The two directories deliberately share filenames, since each pair is one feature split at the boundary.
7. **A platform file holds the call into the operating system or the player, and nothing a second platform would have to write again.** A platform file is one that holds a platform conditional, includes an operating system header or is named for one platform. Whatever both platforms need goes in `src/core/`, with a test. `tests/platform_seams_test.cpp` lists every platform file and fails on one missing from the list and on an entry whose file no longer earns it, so adding a platform file adds a line a reviewer reads. The test does not judge what a listed file holds; the reviewer does, against the first sentence.

## 2. Comments and documentation

1. The one home for a shared fact: `core/json.h`, `core/text.h`, `core/http_server.h`'s `kMaxBodyBytes`, `core/failures.h` for every refusal sentence and status, `core/http_responses.h` for how a route answers, `fb2k/strings.h`, `fb2k/playlists.h`'s `playlistIndices()` and `tests/support/fixtures.h`.
2. A comment names the system it is about: the foobar2000 SDK, Windows, macOS, Media Foundation, AudioToolbox, libogg, libopus, cpp-httplib, MSVC, clang or a browser. A fact about one of them that bites in several files goes in `plugins/fb2k/ARCHITECTURE.md`, *Facts about the player*, and the files depending on it point there in a clause.
3. Name each document in full, since the root and `ui/` keep files of the same names as this tree's.

## 3. Style

1. Match the file being edited.
2. `const` by default, on locals as well as parameters.
3. Prefer `std::transform`, `std::accumulate`, `std::any_of` and friends to a raw loop. A raw loop over an SDK count is usually a missing range; a second one is usually a missing shared function.
4. **No ATL, no WTL, no MFC in this component's own code.** The SDK needs them to build itself; a component that draws one dialog does not. `fb2k/preferences.cpp` is a plain `DLGPROC` rather than the SDK's WTL-based `preferences_page_impl<>`, and dark mode comes from `fb2k::CCoreDarkModeHooks`.
5. Run `scripts/format.sh` and `scripts/lint.sh` before saying a change is ready. `src/fb2k/` is linted by `scripts\build.ps1` itself on Windows, through `scripts\lint.ps1`, so a finding fails the build, and by `scripts/lint.sh` on a Mac with the SDK fetched. All three refuse an LLVM major other than the one `scripts/lib/llvm.sh` and `scripts\lint.ps1` pin; none touches `third_party/`.

## 4. Tests

1. Every change under `src/core/` needs a test.
2. **Run the whole suite, `scripts/test.sh`.** A filter saves no time; the script's header says why and has the invocations.
3. Changes to documentation, comments, `.gitattributes` or editor configuration need no run at all.
4. Tests are feature-level. `tests/` starts a real `HttpServer` on a real port and drives it with a real HTTP client. **Assert what a client would see, not how the answer was arrived at.** A test that names a private function, or that would still pass if the component answered the wrong status, is testing the implementation.
5. **Assert that the refusal never reached the player.** Every route test carries a recording player and checks its call count, and the playlist and queue routes share one, `tests/support/fake_player.h`, a foobar2000 in memory that judges each call the way `src/fb2k/` does: "answered 403" and "answered 403 *and did not touch the disk*" are different promises, and only the second is the feature.
6. Fixtures live in `tests/support/`, never at the top of whichever file needed one first.
7. **Nothing sleeps.** `RateLimiter::allow` and the ticket store take the time as an argument for this reason. A test that waits to observe a limit fails on a loaded machine, which teaches everybody to ignore it. A route test's clock stands still until it calls `advanceClock`, and rate limits and tickets both read it. A case that needs another thread to be inside a wait asks `tests/support/eventually.h`, whose watchdog fails the case rather than hanging the suite.
8. Run the suite more than once before believing it: `tests/support/test_server.cpp` retries a port race. The assertion count is deterministic, so two runs of one tree that disagree are a real difference rather than weather.
9. **Every C++ change runs under both `scripts/test.sh --sanitize=address` and `--sanitize=thread` before it is called ready.** A plain run on the Mac does not see a write past a buffer that MSVC's heap aborts on. It runs clean, so a report is a regression.
10. **The suite reads `contract/openapi.yaml` at run time, and that file sits outside this tree.** A stale copy tests the wrong routes. Whatever syncs the tree to a machine that runs the suite syncs `contract/` with it, at the same position relative to it, because `tests/support/spec.cpp` and `scripts/test.sh` both climb out of the plugin directory.
11. A doctest filter matching nothing exits 0, so a typo in one reports success.

### What a green suite does not cover

Each of these is unreachable from the suite by nature, so each says how it is verified instead. A seam whose only caller is a test does not close one: a fake that proves a fake works is worse than an honest gap.

| | how it is actually verified |
|---|---|
| Everything in `src/fb2k/` but the two AAC codec files | compiled and linked by both builds. `scripts/verify-tag-write.ps1`, `verify-stream.ps1`, `verify-listeners.ps1` and `verify-library.ps1` drive four of its paths against a real player on Windows |
| A `setsockopt` failure, and the refusal to listen that follows | neither can be induced from a test, so the path is reviewed only |
| That the AAC encoder's frames decode to the audio that went in | nothing in the suite decodes AAC. `verify-stream.ps1` drives the encoder inside a real player on Windows, and a suite run says in one line whether it drove its platform's codec at all: `scripts/test.sh` on a Mac, `scripts\test.ps1` on Windows with the SDK fetched |
| The preferences page's `GWLP_USERDATA` teardown | opening and closing **Preferences → Tools → Jean** is the whole test |
| A person at the player taking back the mute hold while a stream runs | no live coverage, since no verify script writes the volume or the mute; `tests/output_hold_test.cpp` holds it |
| `notAnAutoPlaylist`, the guard refusing to replace a plain playlist's rows with a query's | no live coverage; exercised by hand against a playlist created for the purpose |

## 5. The HTTP contract

1. **Any change to a response shape, a status code or an error string changes `contract/openapi.yaml` in the same commit.** `plugins/fb2k/ARCHITECTURE.md`, *The HTTP contract*, is why the spec is hand-written and which two checks hold it to the code; neither of them can read prose.
2. **Anything that publishes a track path MUST publish the display form**, through `filesystem::g_get_display_path`. `plugins/fb2k/ARCHITECTURE.md`, *Track identity*, is why.

## 6. Security rules

1. Admission runs before anything else, on every path. A route that answers before the source address and `Host` are checked, or that carries its own exception from either check, is a security bug regardless of what the route does.
2. Compare a stream ticket in constant time, through `secureEquals` in `src/core/text.h`.
3. Never trust a path from a client. Resolve against what the player reports; never concatenate. `tests/static_assets_test.cpp` holds the page route's refusals, and `tests/track_route_test.cpp`, `tests/tag_route_test.cpp` and `tests/artwork_test.cpp` hold that a track address is looked up exactly as sent. The lookup itself is in `src/fb2k/library.cpp`, which no suite reaches.
4. Write only allowlisted fields, compared case-insensitively, and say in the response which field was refused.
5. Never log a stream ticket; `tests/ticket_log_test.cpp` holds it.
6. **A listener's address option is exclusive where the platform offers one.** On Windows it sets `SO_EXCLUSIVEADDRUSE` and never `SO_REUSEADDR`; `third_party/README.md` is what it overrides and why that default is there, and `tests/listener_test.cpp` holds it. Off Windows it sets `SO_REUSEADDR`, which is all those platforms offer, and which leaves a port on the wildcard address open to another program on macOS. The port check says so there, and the cases in `tests/listener_test.cpp` on "a listener on every address" and on the two sentences hold it.
7. A partial or failed bind MUST be loud, and so MUST a held address: to the log, and to the preferences page on Windows. A Mac install has no preferences page, so the log is all it has, and a headless install has nobody reading a console.
8. Refuse before doing. Validate, then act: the tests assert the order, not just the status.
9. **No response may compress request-controlled text beside a secret.** That is the BREACH shape: a client that can put a chosen string in a response reads the secret beside it, a byte at a time, from the compressed length. Nothing tests it; a reviewer holds it.
10. Pin every third-party download to a SHA-256, through `scripts/lib/download.ps1` in PowerShell, and every GitHub Action to a commit, with its version in a comment beside it.

## 7. PowerShell scripts

1. **Never invoke `foobar2000.exe` from a script.** Over SSH it starts a second instance in session 0. Everything goes through `scripts/lib/player.ps1`, which drives it through an interactive scheduled task.
2. foo_jean answers `application/json` with no charset parameter, and PowerShell 5.1 decodes that as ISO-8859-1 and turns every accented path into mojibake. Read the bytes and decode them as UTF-8 by hand: `[System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json`.
3. PowerShell 5.1 reads a BOM-less `.ps1` as Windows-1252, so a script MUST contain no non-ASCII literal. Derive such values at run time instead.
4. PowerShell's bitwise operators share one precedence level with comparison and associate left to right, so `-shl`/`-bor` do not read like the same expression in C. Use arithmetic where the grouping matters.
5. `ConvertFrom-Json` unwraps a one-element JSON array into the bare element, so a field that is a list everywhere else stops being one on the install that has a single entry. Wrap any such read in `@()`. The failure is silent and only that install sees it.
6. A generated file that `rc.exe` or `cl.exe` will read, rather than PowerShell, needs `-Encoding ascii`. The default still adds a UTF-8 BOM under PowerShell 5.1, and neither compiler skips it.
