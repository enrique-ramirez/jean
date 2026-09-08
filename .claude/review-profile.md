# Review profile

What the review agents need to know about this repository. They read this first and treat it as fact.

## Boundary

Imports run `app` to `features` to `domain` to `shared`, enforced by Biome. Flag anything that softens it, and equally any new abstraction layer added behind it.

## Excluded paths

- `third_party/`
- `sdk/`
- `node_modules/`
- `_todo/`
- `src/shared/api/fooJeanSchema.d.ts` (generated)
- `*.local.md`

## Functional directives

`biome-ignore`. Never delete or weaken one: `pnpm lint` fails without them, and each carries its reason by rule.

The `useExhaustiveDependencies` suppressions are all one shape, a dependency that exists to fire an effect rather than to be read inside it. The rule cannot model that, so `lint:fix` would remove every one and break the feature silently.

## Documentation map

| file | its job |
|---|---|
| `README.md` | what Jean is and how to use it. A pitch, not a specification |
| `CONTRIBUTING.md` | how to write code here |
| `ARCHITECTURE.md` | how the pieces fit, where state lives, why the boundaries sit there |
| `src/shared/api/README.md` | what beefweb and `foo_jean` return, and the gotchas a reader could not infer |
| `test/README.md` | the suite and the fake player |
| `CLAUDE.md` | what an agent cannot read off the code, plus a sentence on what the module is for |

A `CLAUDE.md` is not feature documentation. Flag any description of what a screen shows, what a button does, how a control behaves, what a function does step by step, or what files a folder contains.

## Where an external fact belongs

`ARCHITECTURE.md`, or `src/shared/api/README.md` for anything the player answers.

## Commands

| | |
|---|---|
| lint | `pnpm lint` |
| types | `pnpm typecheck` |
| one unit file | `pnpm test:unit` |
| one end to end spec | `pnpm test:e2e test/e2e/queue.spec.ts` |

`pnpm lint` and `pnpm typecheck` are seconds and may be run freely. `pnpm test:e2e` without a path is desktop and mobile across the whole suite: never run that.

## What cannot be verified here

`pnpm test:live` needs a real player on the network. A change that only that suite would catch is reviewed rather than tested unless a player is up.

## Voice

- Documentation and comments: `house`
- Text posted under a person's name: `house`

## Product decisions

The owner decides. Where work would add, remove or change what Jean does for a user, a feature, a refusal, a default, an information architecture choice or a security default, an agent stops and asks. Finding one already made in the diff is a finding, and often the most important one in a review.

The outcome is not written down. The owner is the gatekeeper, not the documentation.
