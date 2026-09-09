# Jean

A replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin, controlling foobar2000 (and, best-effort, DeaDBeeF) over HTTP.

This file is what an agent cannot read off the code: project-wide rules, external constraints, and decisions somebody would otherwise undo. The four documents it points at do not overlap with it or with each other, and the only rule repeated here is the one about comments, because it applies to every line an agent writes. [ui/CONTRIBUTING.md](./ui/CONTRIBUTING.md) is how to write the code, [ui/ARCHITECTURE.md](./ui/ARCHITECTURE.md) is how the parts fit and why the boundaries sit where they do, [ui/src/shared/api/README.md](ui/src/shared/api/README.md) is what the player answers, [ui/test/README.md](./ui/test/README.md) is the suite and the fake player. Read `ui/CONTRIBUTING.md` before writing anything; its *Design*, *Comments* and *Documentation* sections are the three that get ignored first, and two of its rules are enforced rather than trusted. `.claude/hooks/check-style.sh` fails an edit that reintroduces personal detail, history, hard-wrapped prose, a recorded measurement, an em dash or an assistant's phrasing, and it fires on a shell command that wrote a file as well as on the edit tools. Two agents review changed code for the rest: `style-reviewer` for design and structure, then `comment-reaper` for comments and prose. All three come from the `ai-engineering` kit; `.claude/review-profile.md` is the only part of that setup that is Jean's.

There is one of these files beside each part of the tree, for what is local to it:

| | |
|---|---|
| `ui/src/shared/api/CLAUDE.md` | traps in beefweb's API and in `foo_jean`'s |
| `ui/src/shared/ui/CLAUDE.md` | menus, gestures, drag and drop, toasts, animation |
| `ui/src/shared/keyboard/CLAUDE.md` | the keymap and how bindings are declared |
| `ui/src/shared/i18n/CLAUDE.md` | the phrase catalogue, translations and the `Intl` formatters |
| `ui/src/domain/track/CLAUDE.md` | rows, refs, the virtualised list, ratings |
| `ui/src/domain/library/CLAUDE.md` | where the library comes from, playing a set, search results |
| `ui/src/domain/player/CLAUDE.md` | playback state, the queue, the volume curve, listening here |
| `ui/src/features/artist/CLAUDE.md` | who an artist is, and their page |
| `ui/src/features/home/CLAUDE.md` | the home screen and its shelves |
| `ui/src/features/now-playing/CLAUDE.md` | the status bar, the screen, lyrics and details |
| `ui/src/features/queue/CLAUDE.md` | the play queue panel |
| `ui/src/features/genres/CLAUDE.md` | the genres index |
| `ui/src/features/search/CLAUDE.md` | the search control |
| `ui/src/app/CLAUDE.md` | the shell, breakpoints, themes, the tab, the media session |
| `ui/demo/CLAUDE.md` | the live demo |
| `site/CLAUDE.md` | the landing page, and where its words come from |
| `plugins/fb2k/CLAUDE.md` | `foo_jean` itself: its priorities, driving a real player, what the SDK will and will not do |

## Ground rules

- **Never run a git command that writes.** No `commit`, `add`, `push`, `branch`, `tag`, `rebase`, `reset`. Read-only git (`status`, `diff`, `log`) is fine.
- **A product decision belongs to the owner, and an agent MUST NOT take one on its own.** Where work would add, remove or change what Jean does for a user, whether a feature, a refusal, a default, an information architecture choice or a security default, stop before writing anything. Present the options with what each one costs and what it buys, say which way you lean, and ask. The owner decides. Silence, an obvious-looking gap in the code, and a rule that merely permits the work are none of them an answer. The outcome MUST NOT be written down unless it is one somebody would otherwise undo for a strong reason; the human is the gatekeeper, not the documentation.
- **A general-purpose UI meant for public release, not a personal dashboard.** Nothing may assume a particular library: no hardcoded playlist ids, no assumed paths, no assumed scale, no assumed components.
- **A LAN is assumed.** Jean and `foo_jean` are for a player on the same network, never across the internet, because beefweb has no authentication of its own and `foo_jean` pairs only with private source addresses. So bandwidth is cheap and a design may spend it. What this does **not** buy is a perfect link: wifi at the edge of a house is a LAN condition, and a phone in the garden is the case to keep honest. **Nor does it buy request *volume*, which is the separate budget.** beefweb answers on one work queue and closes the connection per response, so a screenful of covers is a screenful of connections however small each one is. Cheap bytes, expensive requests.
- **The primary axis of quality is UX/UI, and performance is part of UX.** A feature that makes the interface slower has to justify itself.
- **Fully responsive**, one codebase, no separate mobile build. Desktop is keyboard-first; mobile is aggressively optimised for touch targets, safe-area insets and payload.
- **Light and dark themes, both designed.** Neither is `#000` / `#fff`.
- **Everything a person can read is a phrase in the catalogue**, and English is the only language shipped in the bundle. A translation is a JSON file in `locales/` beside `index.html`, added by hand and never by Jean. `ui/src/shared/i18n/CLAUDE.md` is the whole of it; the rule that gets broken first is a string literal written straight into JSX.
- **Minimum required components: beefweb alone.** Everything beyond is optional, auto-detected and individually toggleable in Settings. A bare install MUST get a complete, coherent app, never a dead panel or an empty shelf. Keep the component table in `README.md` current.
- **Run the suite before claiming a change works.** `pnpm lint`, `pnpm typecheck` and `pnpm test` MUST pass. See `ui/CONTRIBUTING.md` for which parts of the suite are cheap enough to run freely.
- **Write a comment only for a fact from outside this repository**, and name the system it is about: beefweb, foobar2000, `foo_jean`, a browser, a library. Why a value was chosen is a named constant; what the code does is the code; how the parts fit is `ui/ARCHITECTURE.md`; what the player answers is `ui/src/shared/api/README.md`. An external fact lives in one place and it is usually not a source file. `ui/src/` is near zero and an exception should be a surprise; specs carry more, because why a case exists is worth saying.

## Look it up before you draw it

**Every piece of UI gets a reference pass before it is written.** Search how good products solve the same problem, then decide. Mobbin, Refero, Screenlane, UI Sources, Godly, Awwwards, Land-book, Dribbble, Behance, Pinterest. Naming the component and the platform is usually query enough: "action sheet mobile", "context menu desktop dark", "sidebar drag reorder".

The point is not to copy. The shape a component takes when written from memory is the median of everything you have seen, and the median is what makes an interface look templated. Look at several and take the one good decision from each.

- **Never look like Spotify.** It is the obvious reference for a music player and therefore the one place Jean has nothing to gain by resembling. If a screen could be mistaken for it, redraw it.
- **Vocabulary is a design decision.** An action sheet and a bottom sheet are different components. Say which one a thing is.

## foobar is the source of truth

Prefer the player's own metadata over anything Jean invents, in this order:

1. **Read it from foobar** via title-formatting columns. Check this first: the player computes, so the reachable surface is far wider than beefweb's own schema.
2. **Get it to live in foobar**, if a component or tag can supply it. Requiring an optional component for an optional feature is expected.
3. **Store it locally in Jean**, only when foobar genuinely cannot hold it. A legitimate fallback, reached for third.

Writing a custom foobar component to feed Jean is a last resort. Do not design toward it.

**Jean's own settings live in `localStorage` today and belong in `/api/clientconfig/{id}`**, with four keys permanently excluded from that move. `ui/ARCHITECTURE.md` has the split and the reason; the exclusion list itself is named next to `TOKEN_KEY` in `ui/src/shared/api/fooJean.ts`.

**The `foo_jean` clientconfig id is spoken for.** The component publishes its discovery record there and Jean writing to it would clobber the record. Ids take lowercase letters, digits and `_`; `foo-jean` is a 400.

## Capability detection

`ui/ARCHITECTURE.md` has the mechanism: the `?` sentinel, `fieldTable()`, what `$meta()` cannot do, and why detection cannot work on DeaDBeeF at all. Three rules on top of it:

- **Detection is a guess and Settings overrides it.** A feature enabled by a probe MUST have a switch.
- **Detect per track wherever a field is sparse.** What one install resolves is not a rule; `ui/src/shared/api/README.md` records which fields are worth expecting and which are not.
- **`player.info.name` distinguishes foobar2000 from DeaDBeeF.** Support DeaDBeeF best-effort. Do not invest in a second title-format dialect without a real report.

## `foo_jean`

Optional, and always will be. Jean MUST work with it absent and light up tag writing and listening when it is there. Its source is `plugins/fb2k/`, and `plugins/fb2k/CLAUDE.md` is the way into it: the rules for writing that component are its own, and this file governs only what Jean does about it. The two seams, the discovery that feeds them, and the security model that says when a token may be sent are in `ui/ARCHITECTURE.md`; the endpoints and their failure modes are in `ui/src/shared/api/README.md`. What must not be undone:

- **The unauthenticated probe before the token is never optional.** The discovery record is writable by anyone who can reach beefweb, so it is a hint and never a credential target.
- **Nothing outside `domain/track/tagWriter.ts` and `domain/player/listener.ts` may ask which implementation it holds.** If something has to branch on `kind`, the seam is in the wrong place.
- **Every discovery state gets a message and a remedy. None of them is silence.** "Installed but could not start on port 8881" is actionable; silently rendering ratings read-only is not. `ui/src/features/settings/TagWriting.tsx` is where those live.
- **Jean's per-field switches narrow and never widen.** The component's `config.json` is the player owner's; Jean lists exactly the fields it permits and turns them off, never on.

## Generality constraints

Things that vary between installs and MUST never be assumed:

| | |
|---|---|
| Which playlist is "the library" | An autoplaylist the user creates and names `#Jean Library`. Match the name exactly, never a title they chose. Never assume `p1`, which is scratch space |
| Whether `#Jean Queue` exists | Jean's holding playlist for queueing library rows, created on demand. Nothing may assume it is there, and nothing may delete it while the play queue points into it, which crashes the player |
| `permissions` | `changePlaylists`, `changeOutput`, `changeClientConfig` come from the player. Gate the UI on them: a read-only instance gets a read-only Jean, not buttons that 403 |
| `authRequired` | May be on. Support Basic auth and a credentials prompt |
| `pathSeparator` | From `/api/browser/roots`. `\` on Windows, `/` elsewhere, but library paths are `/`-separated everywhere, so do not build one with it |
| Library size | Anywhere from empty to very large. Nothing may be linear in it on the main thread |
| Components | Detect, never require |
| Player | foobar2000 or DeaDBeeF |
| Keyboard layout | A binding written as an unshifted key is not unshifted everywhere. See `ui/src/shared/keyboard/CLAUDE.md` |

CORS is off in beefweb by default, so Jean MUST be served same-origin, by beefweb or through the dev proxy.

## Invariants that hold everywhere

`ui/ARCHITECTURE.md` covers where state lives, the one listener set, the sequencing rule and its `void` trap, and why a positional column set is declared once as pairs. These are the rest:

**An exhaustive dependency array can be exhaustive and useless, and the linter only checks the first half.** A hook returning an object literal has a new identity every render, so a `useMemo` keyed on it never hits. Depend on the store's own object instead. Read a green dependency array as saying nothing about whether the memo works.

The corollary is a signature rule: **a caller's dependency array can only be as narrow as the function it calls.** Handed a whole object it must depend on the whole object, so the narrowing has to happen at the parameter.

**The `useExhaustiveDependencies` suppressions are deliberate and all one shape**: a dependency that exists to *fire* the effect rather than to be read inside it. The rule cannot model that, so `lint:fix` would remove every one and break the feature silently.

**Never gate behaviour on a `mounted` ref set only in an effect cleanup.** StrictMode mounts, unmounts and remounts in development, so the cleanup sets the flag false and nothing sets it back: the guard is permanently on, in dev only. If a guard is genuinely needed, set it true in the effect body as well. Usually it is not: work touching only refs and network calls is safe to finish after unmount.

**Anything the user types at a list is matched through `fold()` in `ui/src/shared/lib/text.ts`**, which lowercases and strips diacritics. Fold when the haystack is built, never per keystroke, and fold the query too, or an accented query stops matching a folded index.

**A stale `itemCount` is nobody's to fix but the caller's.** beefweb pushes nothing when a playlist's *items* change, so any arithmetic that cannot survive being wrong MUST re-read the count from the player first.
