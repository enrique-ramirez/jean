# Review profile

What the review agents need to know about this repository. They read this first and treat it as fact.

**Two projects live in this tree and their rules are not the same.** `ui/` is the web app, TypeScript and React, and `site/` is the landing page beside it under the same rules. `plugins/fb2k/` is `foo_jean`, a foobar2000 component written in C++ and built on Windows. Work out which side the diff is on, read *Everywhere* and then that side, and skip the other. A diff that spans both is reviewed once under each set, and the review says that it did.

## Everywhere

### Excluded paths

- `node_modules/`
- `plugins/fb2k/third_party/`
- `plugins/fb2k/sdk/`
- `_todo/`
- `ui/src/shared/api/fooJeanSchema.d.ts` (generated)
- `*.local.md`

`plugins/fb2k/third_party/` is cpp-httplib, nlohmann/json and doctest as single headers, tens of thousands of lines of somebody else's code. Never read it and never review it. `plugins/fb2k/sdk/` is the foobar2000 SDK, fetched rather than vendored, and the same applies.

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
| `ui/CONTRIBUTING.md` | how to write code here |
| `ui/ARCHITECTURE.md` | how the pieces fit, where state lives, why the boundaries sit there |
| `ui/src/shared/api/README.md` | what `foo_jean` returns, and the gotchas a reader could not infer |
| `ui/test/README.md` | the suite and the fake player |
| `CLAUDE.md` | the root one is project-wide; one beside a module is local to it |

### Where an external fact belongs

`ui/ARCHITECTURE.md`, or `ui/src/shared/api/README.md` for anything the player answers.

### Commands

Run from the repository root. Each delegates into `ui/`, so a path argument is relative to `ui/`.

| | |
|---|---|
| lint | `pnpm lint` |
| types | `pnpm typecheck` |
| unit tests | `pnpm test:unit` |
| one end to end spec | `pnpm test:e2e test/e2e/queue.spec.ts` |

`pnpm lint`, `pnpm typecheck` and `pnpm test:unit` are seconds and may be run freely; the unit suite has no per-file form and does not need one. `pnpm test:e2e` without a path is desktop and mobile across the whole suite: never run that.

### What cannot be verified here

`pnpm test:live` needs a real player on the network. A change that only that suite would catch is reviewed rather than tested unless a player is up.

## `plugins/fb2k/`, the foobar2000 component

### Boundary

`core/` knows nothing of foobar2000, and everything it needs arrives as a callback from `fb2k/`. Flag anything that softens it, and equally any new abstraction layer added behind it.

This boundary pays twice. A decision moved into `core/` becomes coverable by a suite that runs on any machine, and a mechanism left in `fb2k/` is coverable by nothing.

### Functional directives

`NOLINT`, `shellcheck disable`, `clang-format off`. Never delete or weaken one.

`plugins/fb2k/src/fb2k/resource.h`'s include guards are deliberate: `rc.exe`'s preprocessor is not the compiler's.

### Documentation map

| file | its job |
|---|---|
| `plugins/fb2k/README.md` | what the component is, how to build it, install it, configure it and run it |
| `plugins/fb2k/CONTRIBUTING.md` | how to write its code |
| `plugins/fb2k/ARCHITECTURE.md` | how the pieces fit, which thread owns what, why the boundaries sit there |
| `plugins/fb2k/CLAUDE.md` | what an agent cannot read off the code: the priorities, the rules about touching a real player, and the measured facts that constrain the design |
| `plugins/fb2k/src/README.md` | the source tree, file by file |
| `contract/openapi.yaml` | the HTTP contract, hand-written, and what clients generate types from |

`contract/openapi.yaml` is the contract. A change to a response shape, a status code or an error string that does not change the spec in the same diff is a defect whatever else it is. Check every route list, status code, default and field name against it, and say which side is wrong rather than assuming it is the prose.

### Where an external fact belongs

`plugins/fb2k/CLAUDE.md`, *Facts about the player*, or `plugins/fb2k/ARCHITECTURE.md`.

### Commands

Run from the repository root. `scripts/test.sh` finds its own tree, so the path below works from anywhere.

| | |
|---|---|
| one test file | `plugins/fb2k/scripts/test.sh '-sf=*cors_test.cpp'` |
| one case | `plugins/fb2k/scripts/test.sh '-tc=*bearer*'` |
| threaded code | `plugins/fb2k/scripts/test.sh --sanitize=thread` |

A full run loads the machine and floods the context. Never run one during a review.

### What cannot be verified here

`plugins/fb2k/src/fb2k/` does not compile on an editing machine. A change there is reviewed, not tested, until a Windows build has run. Say which of the two you did.

The AAC encoder is Windows-only and unreachable from the suite. A `setsockopt` failure cannot be induced from a test.
