# Review profile

What the review agents need to know about this repository. They read this first and treat it as fact.

**Two projects live in this tree and their rules are not the same.** `ui/` is the web app, TypeScript and React, and `site/` is the landing page beside it under the same rules. `plugins/fb2k/` is `foo_jean`, a foobar2000 component written in C++ and built on Windows and on macOS. Work out which side the diff is on, read *Everywhere* and then that side, and skip the other. A diff that spans both is reviewed once under each set, and the review says that it did.

## Everywhere

### Excluded paths

- `node_modules/`
- `plugins/fb2k/third_party/`
- `plugins/fb2k/sdk/`
- `_todo/`
- `ui/src/shared/api/fooJeanSchema.d.ts` (generated)
- `*.local.md`

`plugins/fb2k/third_party/` is cpp-httplib, nlohmann/json and doctest as single headers, tens of thousands of lines of somebody else's code. Never read it and never review it. `plugins/fb2k/sdk/` is the foobar2000 SDK, fetched rather than vendored, and the same applies.

### Documentation map

The root `CONTRIBUTING.md` holds the rules every project shares: design, comments, documentation and writing. Each project's map below adds its own files.

### Doc comments

Judged like any other comment on both sides. Nothing requires one, so there is no floor.

### A `CLAUDE.md` is not feature documentation

Flag any description of what a screen shows, what a button does, what a route returns, how a control behaves, what a function does step by step, or what files a directory contains. A `CLAUDE.md` holds what an agent cannot read off the code, plus a sentence on what the module is for.

### Voice

`enrique`, both for prose already in this repository and for anything the agents write into it, including their reports. Where that persona file is not in the checkout, which is the normal case on somebody else's machine, `house`.

### Product decisions

The owner decides. Where work would add, remove or change what the software does for a user, a feature, a route, a refusal, a default, an information architecture choice, a security default or what a client sees in a response, an agent stops and asks. Finding one already made in the diff is a finding, and often the most important one in a review.

The outcome is not written down. The owner is the gatekeeper, not the documentation.

## `ui/`, the web app

### Boundary

Imports run `app` to `features` to `domain` to `shared`, enforced by Biome. Flag anything that softens it, and equally any new abstraction layer added behind it.

### Functional directives

`biome-ignore`. Never delete or weaken one: `pnpm lint` fails without them, and each carries its reason by rule.

The `useExhaustiveDependencies` suppressions are all one shape, a dependency that exists to fire an effect rather than to be read inside it. The rule cannot model that, so `lint:fix` would remove every one and break the feature silently.

### Documentation map

| file | its job |
|---|---|
| `README.md` | what Jean is and how to use it. A pitch, not a specification |
| `ui/CONTRIBUTING.md` | how to write the web UI's code |
| `ui/ARCHITECTURE.md` | how the pieces fit, where state lives, why the boundaries sit there, and *Facts about the browser* |
| `ui/src/shared/api/README.md` | what `foo_jean` returns, and the gotchas a reader could not infer |
| `ui/test/README.md` | the suite and the fake player |
| `CLAUDE.md` | the root one is project-wide; one beside a module is local to it |

### Where an external fact belongs

Beside the one line it constrains. A fact governing several files goes in `ui/ARCHITECTURE.md`, *Facts about the browser*, or `ui/src/shared/api/README.md` for anything the player answers.

### Commands

Run from the repository root. Each delegates into `ui/`, so a path argument is relative to `ui/`.

| | command | cost |
|---|---|---|
| lint | `pnpm lint` | under 1s |
| types | `pnpm typecheck` | under 1s, incremental |
| unit tests | `pnpm test:unit` | about 1s |
| one end to end spec | `pnpm test:e2e test/e2e/queue.spec.ts` | 10s to a minute, more while it is red, since Playwright retries each failure |

`pnpm lint`, `pnpm typecheck` and `pnpm test:unit` may be run freely; the unit suite has no per-file form and does not need one. `pnpm test:e2e` without a path is desktop and mobile across the whole suite, six to nine minutes: never run that. A path that matches no spec file is not an error, and the run reports success on the specs it did find, so check the count.

### What cannot be verified here

`pnpm test:live` needs a real player on the network. A change that only that suite would catch is reviewed rather than tested unless a player is up.

## `plugins/fb2k/`, the foobar2000 component

### Boundary

`core/` knows nothing of foobar2000, and everything it needs arrives as a callback from `fb2k/`. Flag anything that softens it, and equally any new abstraction layer added behind it.

This boundary pays twice. A decision moved into `core/` becomes coverable by a suite that runs on any machine, and a mechanism left in `fb2k/` is coverable by nothing but the two AAC codec files' cases. A platform split under `src/` is an `#ifdef _WIN32` inside the file that owns the call, or a whole file for one platform, as `preferences_mac.mm` and `aac_encoder_mac.cpp` are, and `tests/platform_seams_test.cpp` lists every platform file.

### Functional directives

`NOLINT`, `shellcheck disable`, `clang-format off`. Never delete or weaken one. They can sit in any `.cpp`, `.h` or `.mm` file, all of which the linter and the formatter read.

`plugins/fb2k/src/fb2k/resource.h`'s include guards are deliberate: `rc.exe`'s preprocessor is not the compiler's. Only the Windows build includes it.

### Documentation map

| file | its job |
|---|---|
| `plugins/fb2k/README.md` | what the component is, how to build it, install it, configure it and run it |
| `plugins/fb2k/CONTRIBUTING.md` | how to write the component's code |
| `plugins/fb2k/ARCHITECTURE.md` | how the pieces fit, which thread owns what, why the boundaries sit there |
| `plugins/fb2k/CLAUDE.md` | what an agent cannot read off the code: the priorities and the rules about driving a real player |
| `plugins/fb2k/src/README.md` | what a listing of the source tree cannot show: the pairs that move together, which file owns which thread, the platform files and the generated ones |
| `plugins/fb2k/third_party/README.md` | the vendored libraries: their versions, and what in each is load-bearing |
| `contract/openapi.yaml` | the HTTP contract, hand-written, and what clients generate types from |
| `contract/README.md` | what reads the spec by path, and so what a move of it breaks |

`contract/openapi.yaml` is the contract. A change to a response shape, a status code or an error string that does not change the spec in the same diff is a defect whatever else it is. Check every route list, status code, default and field name against it, and say which side is wrong rather than assuming it is the prose.

### Where an external fact belongs

Beside the one line it constrains. A fact governing several files goes in `plugins/fb2k/ARCHITECTURE.md`, *Facts about the player*.

### Commands

Run from the repository root. `scripts/test.sh` finds its own tree, so the path below works from anywhere.

| | command | cost |
|---|---|---|
| the whole suite | `plugins/fb2k/scripts/test.sh` | about 2s with nothing changed, 4s after editing a file, 17s from clean |
| one test file | `plugins/fb2k/scripts/test.sh '-sf=*cors_test.cpp'` | the same |
| one case | `plugins/fb2k/scripts/test.sh '-tc=*private address*'` | the same |
| any C++ change, before it is called ready | `plugins/fb2k/scripts/test.sh --sanitize=address` | about 2 minutes from clean, then incremental in its own directories |
| the same change, under the other sanitizer | `plugins/fb2k/scripts/test.sh --sanitize=thread` | 15s from clean, then incremental in its own directories |
| one `src/fb2k/` file, on a Mac with the SDK | `plugins/fb2k/scripts/lint.sh plugins/fb2k/src/fb2k/library.cpp` | about 5s a file. Without arguments it lints everything, one file per core, in about a minute |

The build is incremental and the filters narrow only what runs, never what compiles. Run the whole suite rather than a filtered one: it costs the same and covers everything. Filter only to read less output.

Two runs at once share `plugins/fb2k/bin/`, so two agents never run the suite at the same time.

### What cannot be verified here

`plugins/fb2k/src/fb2k/` is compiled and linked by the Windows build (`scripts\build.ps1`, which leaves out `aac_encoder_mac.cpp`) and by the macOS build (`scripts/build-mac.sh`, which leaves out `preferences.cpp` and `aac_encoder.cpp`), and it runs inside a player only. `preferences_mac.mm` is Objective-C++ under ARC: the macOS build compiles it and the Windows build, which globs `fb2k\*.cpp`, never sees it. On a Mac where `scripts/fetch-sdk.sh` has fetched the SDK it is also parsed and linted, the `.mm` included and with `-fobjc-arc`, all but the files `fb2k_unparsed_sources` lists in `plugins/fb2k/scripts/lib/compile-flags.sh`. Each platform's suite runs its own AAC codec file and nothing else from `src/fb2k/`; `plugins/fb2k/README.md`, *Testing*, says which and how a run reports it. A change there is reviewed, not tested, until the build of its platform has run, and a change to a codec file also wants the suite of its platform. Say which of the two you did, on which platform, and whether you also linted it.

The files `fb2k_unparsed_sources` lists in `compile-flags.sh`, and everything MSVC-specific (its warnings, its headers, `scripts\lint.ps1`), are known only to a Windows build.

`plugins/fb2k/CONTRIBUTING.md`, *What a green suite does not cover*, lists what the suite cannot reach and how each is verified instead.
