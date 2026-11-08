# Jean

A web UI for foobar2000, served by `foo_jean`, its component in `plugins/fb2k/`.

Read `CONTRIBUTING.md`, how to write code here, before writing anything. `ui/ARCHITECTURE.md` is how the parts fit, `foo_jean`'s two seams included; `ui/src/shared/api/README.md` is what the player answers; `ui/test/README.md` is the suite and its fake player; `README.md` is what Jean does for its user.

## Ground rules

- Never run a git command that writes, `stash` and `checkout` included. Reading is fine.
- **A product decision belongs to the owner.** Where work would add, remove or change what Jean does for a user (a feature, a refusal, a default, an information architecture choice, a security default), stop before writing. Present the options with what each costs and buys, say which way you lean, and ask. Silence, a gap in the code and a rule that merely permits the work are not answers. The outcome is not written into any file.
- A general-purpose UI for public release. Nothing assumes a particular library: no hardcoded playlist ids, paths, scale or components.
- A LAN is assumed, since `foo_jean` admits only a private source address behind a `Host` it recognises. Bytes are cheap, though a phone at the edge of the wifi is the case to design for. Requests are the budget: `foo_jean` meters each route with a token bucket (`kArtworkBurst` and its kin in the `routes_` files), deep enough for a screenful and too shallow for a client in a loop.
- UX is the primary axis of quality, and performance is part of it. A feature that slows the interface has to justify itself.
- Fully responsive. Desktop is keyboard-first; mobile is optimised for touch targets, safe-area insets and payload.
- Light and dark themes, both designed. Neither is `#000` or `#fff`.
- `foo_jean` is the only component an install needs. Everything else is optional, auto-detected and toggleable in Settings, and a bare install gets a complete app with no dead panel or empty shelf. Keep the component table in `README.md` current.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` and the specs covering the change pass before a change is called working. The full e2e run is a final verification, once, where the change warrants it.

## Look it up before you draw it

Every piece of UI gets a reference pass first (Mobbin, Refero, Screenlane, UI Sources, Godly, Awwwards, Land-book, Dribbble, Behance, Pinterest), taking the one good decision from each rather than the median from memory. **Never look like Spotify.** Vocabulary is a design decision: an action sheet and a bottom sheet are different components, so say which one a thing is.

## foobar is the source of truth

Prefer the player's metadata over anything Jean invents, in this order:

1. Read it from foobar2000 through title-formatting columns.
2. Get it to live in foobar2000, where a component or a tag can supply it. An optional component for an optional feature is expected.
3. Store it locally in Jean, only where foobar2000 cannot hold it.

A custom component written to feed Jean is a last resort.

## Capability detection

- Detection is a guess, so a feature a probe enables has a switch in Settings.
- foobar2000 is the only player. A second, with its own title-format dialect, is the owner's decision.

## Never assume

|                         |                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which playlist is which | `foo_jean` answers the library, and no playlist is it. Never read a role out of a title somebody chose                                                                     |
| `permissions`           | `canControlPlayback`, `canWritePlaylists`, `canChangeOutput` and `canStream` each go false independently. A read-only instance gets a read-only Jean, not buttons that 403 |
| Library size            | anywhere from empty to very large. Nothing linear in it on the main thread                                                                                                 |
| Components              | detect, never require                                                                                                                                                      |
| Keyboard layout         | a binding written as an unshifted key is not unshifted everywhere                                                                                                          |

## Invariants

- A green dependency array says nothing about whether a memo works. A hook returning an object literal has a new identity every render, so a `useMemo` keyed on it never hits; depend on the store's own object. A caller's dependency array can only be as narrow as the function it calls: narrow at the parameter.
- **The `useExhaustiveDependencies` suppressions are all one shape**: a dependency that fires an effect rather than being read inside it. `lint:fix` removes every one and breaks the feature silently.
- React StrictMode mounts, unmounts and remounts in development, so a `mounted` ref set false only in a cleanup stays false. Set it true in the effect body too; work touching only refs and the network is safe after unmount anyway.
- Anything typed at a list is matched by `foo_jean`, through the one `fold()` the contract generates for both sides. Jean sends the query as typed and holds no haystack, only windows; `fold()` on the client folds a palette entry or a completion, never a row.
