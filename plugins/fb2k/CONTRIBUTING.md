# Contributing to foo_jean

How to write code in this repository. `plugins/fb2k/README.md` is what the component is, how to build it and how to run its tests; `plugins/fb2k/ARCHITECTURE.md` is how the pieces fit and why the boundaries sit where they do; `src/README.md` maps the source tree file by file. Setting up is `scripts/fetch-opus.sh` once and `scripts/test.sh` thereafter. See `plugins/fb2k/README.md`, *Testing*.

## 1. The `core/` / `fb2k/` boundary

The rationale, the enforcement and what the seam buys are in ARCHITECTURE.md, *The one boundary*. The rules that follow from it:

1. **`src/core/` MUST NOT include a foobar2000 or Windows header.**
2. Anything `core/` needs from the player MUST arrive as a callback or a plain value handed in by `fb2k/`. The one exception is `core/log.h`, which declares `logInfo`/`logError` and lets each host supply them: `fb2k/log.cpp` in the component, `tests/support/log_capture.cpp` in the suite.
3. **Put the decision in `core/` and the mechanism in `fb2k/`.** A decision compiles and is tested on any machine; a mechanism is not.
4. `src/fb2k/` compiles for the first time on the build machine. A change there is *reviewed*, not *tested*, until `scripts/build.ps1` has run. State which of the two you did.
5. Headers live beside their sources. This is a DLL with no exported headers; do not restructure towards `include/` + `src/`.
6. The two directories deliberately share filenames (`preferences.cpp`, `playlists.cpp`, `log`). `src/foo_jean.vcxproj` sets `<ObjectFileName>$(IntDir)%(RelativeDir)</ObjectFileName>` so the object files do not overwrite each other; keep it. Without it the symptom is `LNK2001` naming a function you can watch being compiled.

## 2. Design

The standard is one thing: control complexity so a person can read the result. Craftsmanship and simplicity agree on nearly all of what follows: names carry the meaning, a unit does one thing, duplication is a defect, clarity beats cleverness. Where they pull apart is how much structure is worth its cost, and that is settled below in favour of the simpler reading.

1. **Structure is never free, and must earn its place.** SOLID describes forces, not a checklist. An interface, a factory or a layer is justified by a second caller that exists, not by one that might. "Open for extension" is not a licence to design for a change nobody has asked for; the cheapest way to be open to a change is to be small enough to alter.
2. **Extract until the name stops paying.** Pull a block out when its name tells the reader more than the code did. Stop when following one idea means jumping between fragments that only make sense together. A shredded function is harder to read than the loop it replaced, and readability is the whole point.
3. **One reason to change.** A unit that both decides and acts has two. Keep the decision pure and testable, and put the mechanism where it belongs.
4. **Names are the primary documentation.** If a name needs a comment, the name is wrong. Reach for a better name before reaching for a sentence.
5. **The second copy is the bug.** Two statements of one fact drift, silently. Name it once and let both callers reach it: `core/json.h`, `core/text.h`, `core/http_server.h`'s `kMaxBodyBytes`, `fb2k/strings.h`, `fb2k/playlists.h`'s `playlistIndices()` and `tests/support/fixtures.h` are each the one home for something.
6. **Do one thing well, and compose.** Prefer a small piece with a plain interface over a subsystem with options. Prefer passing a value in to reaching out for one. It is what makes a thing testable, and it is dependency inversion at the only scale that reliably pays.
7. **Be pragmatic before dogmatic.** No pattern is owed an appearance. If a rule here would make a file harder to read, the rule is wrong for that file; say so in the change rather than obeying it quietly.

## 3. Style

1. Match the file you are in.
2. `const` by default, on locals as well as parameters.
3. Prefer `std::transform`, `std::accumulate`, `std::any_of` and friends to a raw loop. A raw loop over an SDK count is usually a missing range; a second one is usually a missing shared function. `secureEquals` uses `std::inner_product` for a second reason: it has no early exit, which is the whole point of a constant-time compare.
4. **No ATL, no WTL, no MFC in this component's own code.** The SDK needs them to build itself; a component that draws one dialog does not. `fb2k/preferences.cpp` is a plain `DLGPROC` rather than the SDK's WTL-based `preferences_page_impl<>`, and dark mode comes from `fb2k::CCoreDarkModeHooks`.
5. Run `scripts/format.sh` before saying a change is ready, and `scripts/lint.sh` if clang-tidy is installed. Neither touches `third_party/`.

## 4. Comments

Write a comment when the code is correct **because of something outside this repository**, and name that thing: what the foobar2000 SDK, Windows, Media Foundation, libogg, libopus, cpp-httplib, MSVC or a browser actually does. Every other claim a reader can check by reading; that one they cannot.

Everything else that seems to want a sentence is a name you have not found yet, a function you have not extracted, or a fact that belongs in a document.

1. **Why a value was chosen is a named constant.** A bitrate, a timeout, a buffer size. `kBroadcastSeconds` says what `8` cannot, and says it at every use rather than once above one of them.
2. **What the code does is the code.** If following it needs prose, the prose is a bug report against the structure. Fix the structure.
3. **How the pieces fit is `plugins/fb2k/ARCHITECTURE.md`; what the player does is `plugins/fb2k/CLAUDE.md`, *Facts about the player*.** An external fact that bites in several files is written there once, and the files depending on it say nothing, or point there in a clause.
4. **Tests carry more.** A test's name states the behaviour; a comment may state why the case exists at all and what breaks without it. That is documentation and it earns its place. Narrating the assertions is not.

**The test, before you write one.** Strip the comment and hand the code to somebody competent who has not seen it:

| they get it right | verdict |
|---|---|
| from the code | it was never needed |
| only because they happen to know Media Foundation | the fact is real; it belongs in the docs |
| they cannot get it at all | write the comment |

`src/` should be near zero. An exception is allowed, and should be rare enough that meeting one is a surprise. The repository root's `.claude/agents/comment-reaper.md` runs that test with an agent that has not seen the file.

## 5. Tests

1. Every change under `src/core/` needs a test. Writing it first is welcome.
2. **Run the tests that cover what you changed, not the whole suite.** One file is `scripts/test.sh '-sf=*cors_test.cpp'`; one case is `scripts/test.sh '-tc=*bearer*'`. Run those as often as you like.
3. **A full run is a final verification step, not a habit.** It loads the machine and floods an agent's context. Run it once, at the end, when the change is substantial enough that something outside the tests you already ran could plausibly have broken. Changes to documentation, comments, `.gitattributes` or editor configuration need no run at all.
4. Tests are feature-level. `tests/` starts a real `HttpServer` on a real port and drives it with a real HTTP client. **Assert what a client would see, not how the answer was arrived at.** A test that names a private function, or that would still pass if the component answered the wrong status, is testing the implementation.
5. **Assert that the refusal never reached the player.** Every route test carries a recording player and checks its call count: "answered 403" and "answered 403 *and did not touch the disk*" are different promises, and only the second is the feature.
6. Fixtures live in `tests/support/`, never at the top of whichever file needed one first.
7. **Nothing sleeps.** `RateLimiter::allow` and the ticket store take the time as an argument for this reason. A test that waits to observe a limit fails on a loaded machine, which teaches everybody to ignore it.
8. When a full run *is* warranted, run it more than once: `tests/support/test_server.cpp` retries a port race. The assertion count is deterministic, so two runs of one tree that disagree are a real difference rather than weather. Nothing in the suite may make it depend on scheduling.
9. **Anything threaded runs under `scripts/test.sh --sanitize=thread` before it is called ready.** That is `core/pcm_ring`, `core/broadcast_ring`, `core/audience`, `core/output_hold`, `core/stream_ticket` and `core/timeline`. It is clean today, so a report is a regression rather than known noise.
10. `--sanitize=` takes `address`, `thread` or `leaks`, and goes first, before doctest's own arguments. Each instrumented build keeps its own object directory under `bin/`, so a plain run and an instrumented one cannot contaminate each other. `leaks` is macOS's own tool rather than LeakSanitizer, because LSan has no implementation on this platform and an ASan binary given `detect_leaks=1` aborts before `main`. It runs the ordinary uninstrumented build, is a conservative scanner rather than a proof, and fails outright anywhere but macOS.
11. **The suite reads `docs/openapi.yaml` at run time**, so a machine it runs on needs the current spec beside the sources. Two tests drive every route the contract publishes, and a stale copy answers for a build that has different routes. Anything that syncs this tree to a build machine syncs `docs/` with it.
12. `-sf` is source-file and needs the glob. `-ts` is test *suite*, no file here declares one, and a filter matching nothing exits 0, so a typo there reports success.

### What a green suite does not cover

A short list on purpose. Each of these is unreachable from the suite by nature rather than by neglect, so each says how it is verified instead. **Do not close one of these by adding a seam whose only caller is a test.** A fake that proves a fake works is worse than an honest gap.

| | how it is actually verified |
|---|---|
| Everything in `src/fb2k/` | compiled on the build machine. `scripts/verify-tag-write.ps1`, `verify-stream.ps1` and `verify-listeners.ps1` drive three of its paths against a real player |
| A `setsockopt` failure, and the refusal to listen that follows | neither can be induced from a test. The code path is compiled on both platforms and has never run |
| `MainThreadQueue::close()`, and abandoning work at shutdown | measured on the player: quitting with requests in flight went from **32.26 s** to **0.62 s**, and the log says how many calls it gave up |
| The AAC encoder | Windows-only and unreachable from the suite at all. `verify-stream.ps1` drives it; `_todo/sta-mta-spike.md` is the one open question about it |
| The preferences page's `GWLP_USERDATA` teardown | opening and closing **Preferences → Tools → Jean** is the whole test |
| `notOurs`, the guard refusing to touch a playlist this component did not create | no live coverage. `plugins/fb2k/CLAUDE.md` says to exercise it against a playlist created for the purpose, never a real one |

## 6. The HTTP contract

1. **`docs/openapi.yaml` is the contract and it is hand-written.** Any change to a response shape, a status code or an error string changes it in the same commit. Clients generate their types from it, so a stale spec is a client that compiles and is wrong.
2. `tests/api_contract_test.cpp` pins the exact key set of every document the component produces, and drives the stream routes against the statuses the spec publishes. `scripts/test.sh` separately compares the spec's version with `src/core/version.h`.
3. **Adding an unauthenticated route means revisiting the CORS default in the same commit.** The permissive `allowedOrigins` default is safe only while the unauthenticated routes say less than a port scan would, and while the one that hands out a credential, `POST /api/pair`, keeps the stricter same-host rule. `tests/listener_test.cpp` and `tests/pairing_test.cpp` pin both halves.
4. **Anything that publishes a track path MUST publish the display form**, through `filesystem::g_get_display_path`. ARCHITECTURE.md, *Track identity*, is why.
5. Track identity is `%path%` plus `%subsong%`. Routes address tracks by path; playlist items have no id.

## 7. Security rules

1. Authentication is mandatory. There is no unauthenticated mode to fall into: an empty token means the listener refuses to start, and a token shorter than `kMinTokenLength` is refused rather than quietly accepted.
2. Compare credentials in constant time.
3. Never trust a path from a client. Resolve against what the player reports; never concatenate.
4. Write only allowlisted fields, compared case-insensitively, and say in the response which field was refused.
5. Never log a token or a stream ticket, and never put either in the discovery record.
6. **Never set `SO_REUSEADDR`.** On Windows it lets a socket bind a port another socket is actively listening on, so two servers silently split the traffic on one port. cpp-httplib's `default_socket_options` sets it, and the override to `SO_EXCLUSIVEADDRUSE` must stay.
7. A partial or failed bind MUST be loud, to the log and to the discovery record, because a headless install has nobody reading a console.
8. Refuse before doing. Validate, then act: the tests assert the order, not just the status.

## 8. PowerShell scripts

1. **Never invoke `foobar2000.exe` from a script.** Everything goes through `scripts/lib/player.ps1`, which drives it via an interactive scheduled task. See CLAUDE.md for why.
2. PowerShell 5.1 decodes beefweb's `application/json` as ISO-8859-1 and turns every accented path into mojibake. Read the bytes and decode them as UTF-8 by hand: `[System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json`.
3. PowerShell 5.1 reads a BOM-less `.ps1` as Windows-1252, so a script MUST contain no non-ASCII literal. Derive such values at run time instead.
4. PowerShell's bitwise operators share one precedence level with comparison and associate left to right, so `-shl`/`-bor` do not read like the same expression in C. Use arithmetic where the grouping matters.

## 9. Documentation

Documentation states the current design and nothing else. No history: what something used to be, why it changed, or what was rejected belongs in git rather than in a file. The one exception is a trap a reader would actively revert into. Write that as an imperative rule, not as a story. No personal detail either: no names, machines, hostnames, addresses or real library paths, in prose, comments or test data. Use placeholders. Public repository URLs are fine.

Never hard-wrap prose. One paragraph is one line, however long; editors wrap.

Each file in this directory has one job. `README.md` is what the project is and how to use it. `ARCHITECTURE.md` is how the pieces fit, which thread owns what, and why the boundaries are where they are. `CONTRIBUTING.md` is how to write its code. `CLAUDE.md` is what an agent cannot read off the code, and stays short. `src/README.md` is the file-by-file map. Anything that is really a contribution rule belongs here and is linked from elsewhere, never copied. When one file starts saying something, whichever file said it before stops.

## 10. Agent tooling

Everything except the profile comes from the `ai-engineering` kit and is identical in every project that uses it. **The kit is installed once, at the repository root, and there is no `.claude/` in this directory.** Every path below is relative to that root rather than to this file, and `pnpm sync-kit`, also run from the root, takes the kit's current version, reports anything edited here rather than in the kit, and moves it to `<name>.local.bak` rather than dropping it.

- `.claude/review-profile.md` is what tells both agents about the repository, and it carries a section per project. The `plugins/fb2k/` one is the `core/` boundary, the excluded paths, the directives that are functional, what each document is for, and the fact that `src/fb2k/` cannot be built here. It is the only file in this list that is ours.
- `.claude/hooks/check-style.sh` fails an edit that reintroduces personal detail, history, hard-wrapped prose, an em dash or a phrase from the register. It fires on the edit tools and on a shell command that wrote a file, so a heredoc does not walk past it. It only catches what a grep can be certain of; the rest is your judgement.
- `.claude/voice/register.txt` is that register. Lines beginning with `!` or `~` are checked mechanically by `.claude/hooks/check-prose.py`; the rest are judgement, and RFC 2119 keywords are never hits.
- `.claude/voice/constructions.md` is the half a word list cannot catch: the dash habit, negative parallelism, the forced tricolon, uniform sentence length.
- `.claude/agents/style-reviewer.md` reviews changed code for design, structure and naming.
- `.claude/agents/comment-reaper.md` deletes comments that do not earn their keep, and replaces the ones that should have been a name. Run it after the style reviewer, before asking for a commit.

## 11. Commits

1. Imperative subject. A body only for a fact the diff cannot show.
2. Short sentences. RFC 2119 keywords for obligations.
