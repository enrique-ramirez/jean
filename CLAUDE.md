# Jean

A replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin, controlling foobar2000 (and, best-effort, DeaDBeeF) over HTTP.

This file holds what an agent cannot read off the code. How to *write* code here — the dev loop, the tiers, naming, styling, comments, the commands — is [CONTRIBUTING.md](./CONTRIBUTING.md), and is not repeated. Its *Design*, *Comments* and *Documentation* sections are the three that get ignored first, and two of its rules are enforced rather than trusted: `.claude/hooks/check-style.sh` fails an edit that reintroduces personal detail, history or hard-wrapped prose, and the `style-reviewer` agent reviews uncommitted changes for the rest. [API.md](./API.md) is the reference for what the player returns. [README.md](./README.md) is for someone installing Jean.

## Ground rules

- **Never run a git command that writes.** No `commit`, `add`, `push`, `branch`, `tag`, `rebase`, `reset`. Read-only git (`status`, `diff`, `log`) is fine.
- **A general-purpose UI meant for public release, not a personal dashboard.** Nothing may assume a particular library: no hardcoded playlist ids, no assumed paths, no assumed scale, no assumed components.
- **The primary axis of quality is UX/UI, and performance is part of UX.** A feature that makes the interface slower has to justify itself.
- **Fully responsive**, one codebase, no separate mobile build. Desktop is keyboard-first; mobile is aggressively optimised for touch targets, safe-area insets and payload.
- **Light and dark themes, both designed.** Neither is `#000` / `#fff`.
- **Minimum required components: beefweb alone.** Everything beyond is optional, auto-detected and individually toggleable in Settings. A bare install MUST get a complete, coherent app — never a dead panel or an empty shelf. Keep the component table in `README.md` current.
- **Run the suite before claiming a change works.** `pnpm lint`, `pnpm typecheck` and `pnpm test` must pass.

## Look it up before you draw it

**Every piece of UI gets a reference pass before it is written.** Search how good products solve the same problem, then decide. Mobbin, Refero, Screenlane, UI Sources, Godly, Awwwards, Land-book, Dribbble, Behance, Pinterest. Naming the component and the platform is usually query enough — "action sheet mobile", "context menu desktop dark", "sidebar drag reorder".

The point is not to copy. The shape a component takes when written from memory is the median of everything you have seen, and the median is what makes an interface look templated. Look at several, take the one good decision from each, and know what you rejected.

- **Never look like Spotify.** It is the obvious reference for a music player and therefore the one place Jean has nothing to gain by resembling. If a screen could be mistaken for it, redraw it.
- **Record the choice.** Vocabulary is a design decision — an action sheet and a bottom sheet are different components. Write down which was chosen and what was rejected.

## foobar is the source of truth

Prefer the player's own metadata over anything Jean invents, in this order:

1. **Read it from foobar** via title-formatting columns. Check this first: the player computes, so the reachable surface is far wider than beefweb's own schema.
2. **Get it to live in foobar**, if a component or tag can supply it. Requiring an optional component for an optional feature is expected.
3. **Store it locally in Jean**, only when foobar genuinely cannot hold it. A legitimate fallback, reached for third.

Writing a custom foobar component to feed Jean is a last resort. Do not design toward it.

**Jean's own settings live in `localStorage` today** (`shared/hooks/useStoredState.ts`), and belong in `/api/clientconfig/{id}` so they follow the user between devices; the hook's signature is the shape a server-backed version would have. Fall back to local storage where `permissions.changeClientConfig` is false.

**`jean.fooJeanToken`, `jean.listenVolume`, `jean.deviceId` and `jean.deviceName` are permanently excluded** from that move, and this is the list. A credential must not follow the user between devices — beefweb serves the `clientconfig` namespace unauthenticated, so syncing the token would recreate the escalation it exists to prevent. The other three *describe one device*: synced, every screen in the house would share a level, a name, and one row in the listener list. The exclusion is named next to `TOKEN_KEY` in `shared/api/fooJean.ts`.

**The `foo_jean` clientconfig id is spoken for.** The component publishes its discovery record there and Jean writing to it would clobber the record. Ids are lowercase alphanumeric plus underscore; `foo-jean` is a 400.

## Where the rest of this lives

Everything specific to one part of the app sits next to that part:

| | |
|---|---|
| `src/shared/api/CLAUDE.md` | traps in beefweb's API and in `foo_jean`'s |
| `src/shared/ui/CLAUDE.md` | menus, gestures, drag and drop, toasts, animation |
| `src/shared/keyboard/CLAUDE.md` | the keymap and how bindings are declared |
| `src/domain/track/CLAUDE.md` | the virtualised list, rows, refs, loading, rendering, ratings |
| `src/domain/library/CLAUDE.md` | where the library comes from, playing a set, search results |
| `src/domain/player/CLAUDE.md` | playback state, the queue, the volume curve, listening here |
| `src/features/home/CLAUDE.md` | the home screen and its shelves |
| `src/features/now-playing/CLAUDE.md` | the status bar, the screen, lyrics and details |
| `src/features/queue/CLAUDE.md` | the play queue panel |
| `src/features/search/CLAUDE.md` | the search control |
| `src/app/CLAUDE.md` | the shell, breakpoints, themes, the tab, the media session |
| `demo/CLAUDE.md` | the live demo: the fake player in a service worker |

## Capability detection

A title-formatting field that **does not exist returns `?`**. A field that exists but is empty returns `0`, `''` or `N/A`. That difference is the whole mechanism: probe a set of columns against sample tracks on connect, and enable features for whatever resolves. Settings override it when detection guesses wrong.

- **`$meta(x)` cannot be feature-detected.** It answers `''` for a field that does not exist, where `%x%` answers `?`. Use `%x%`.
- **The autoplaylist and the media library API resolve byte-identical values for every field**, so a column that works on one works on the other and detection never has to ask which is in play.
- **Sparse fields defeat sampling.** Detect per track where a field is sparse — the Details panel does. What one install resolves is not a rule; see `API.md`.
- **`player.info.name` distinguishes foobar2000 from DeaDBeeF.** Support DeaDBeeF best-effort. Do not invest in a second title-format dialect without a real report.

### Detecting `foo_jean`, and why its answer cannot be trusted

`foo_jean` is optional and always will be. Jean must work with it absent, and light up tag writing and listening when it is there. `domain/track/tagWriter.ts` is the writer seam (`{ kind, canWrite, allowedFields, allows, write }`, implementations *none* and *agent*); `domain/player/listener.ts` is the streaming one; `shared/api/fooJean.ts` holds the one discovery both use, deduped through `shared/hooks/useFooJean.ts`. **If anything outside those seams has to ask which implementation it holds, the seam is in the wrong place.**

**The mechanism.** On every start the component writes `<profile>/beefweb/clientconfig/foo_jean.json`, which beefweb serves at `GET /api/clientconfig/foo_jean` — same origin as Jean, so it is one request folded into connect, with no CORS and no port scanning:

```json
{ "name": "foo_jean", "version": "0.1.0", "apiVersion": 1,
  "port": 8881, "authRequired": true, "listening": true }
```

`null` is the **not installed** signal, and is the common case. `listening: false` is **not** the same as absent: the component loaded and could not bind, and the record carries `portInUse` and an `error`. Show that — "installed but could not start on port 8881" is actionable; silently rendering ratings read-only is not.

**That record is writable, so it is not evidence.** `POST /api/clientconfig/{id}` is a real beefweb route, `changeClientConfig` defaults to *true*, and beefweb ships with no authentication. Anyone who can reach beefweb can forge the record and name any port, and the forgery lasts until the component next starts. A client that believed it would `POST` the user's bearer token to an attacker's listener.

**So the advertisement is a hint, never a credential target:**

1. Read the record. `null` → no component, use the *none* implementations, done.
2. `GET http://<same-host>:<port>/api/status` — **unauthenticated on purpose** — and require `name` of `foo_jean` and an `apiVersion` this build understands.
3. Only then attach `Authorization: Bearer <token>` to anything.

That leaves the attack needing someone who can already run a listener on the player. Step 2 is cheap and is not optional.

**Pairing is a write, so it obeys the same order.** `POST /api/pair` returns the token during a window opened at the player, to a caller on the local network, once. `discovery.origin` is non-null exactly when the probe succeeded, which makes it the proof a port is safe to post to — so the Pair button renders on `origin` rather than on the state kind, and an unreachable or impostor port never gets one.

**Seven states, and none of them is silence.** Four come from the record; the probe adds two — something on that port that is *not* `foo_jean` (which is what a forged record looks like from here, and Jean must say it did not send the token), and an `apiVersion` this build does not understand — and a refused token is the seventh. The component is installed and working in five of them. `features/settings/TagWriting.tsx` holds one message and one remedy per state.

**Which project owns which setting.** The component's `config.json` holds what the *player owner* decides: port, bind address, and `allowedFields` — the write allowlist, a blast-radius bound. Jean never edits it and there is no route to it. Jean owns the token and, per field, whether to offer the control at all. **Those switches narrow and never widen**, so Settings lists exactly the permitted fields and turns them off, never on.

## Generality constraints

Things that vary between installs and must never be assumed:

| | |
|---|---|
| Which playlist is "the library" | An autoplaylist the user creates and names `#Jean Library`. Match the name exactly, never a title they chose. Never assume `p1` — that is scratch space |
| Whether `#Jean Queue` exists | Jean's holding playlist for queueing library rows, created on demand. Nothing may assume it is there, and nothing may delete it while the play queue points into it — that crashes the player |
| `permissions` | `changePlaylists`, `changeOutput`, `changeClientConfig` come from the player. Gate the UI on them: a read-only instance gets a read-only Jean, not buttons that 403 |
| `authRequired` | May be on. Support Basic auth and a credentials prompt |
| `pathSeparator` | From `/api/browser/roots`. `\` on Windows, `/` elsewhere |
| Library size | Anywhere from empty to 200k+ |
| Components | Detect, never require |
| Player | foobar2000 or DeaDBeeF |
| Keyboard layout | A binding written as an unshifted key is not unshifted everywhere. See `src/shared/keyboard/CLAUDE.md` |

CORS is off in beefweb by default, so Jean must be served same-origin — by beefweb, or through the dev proxy.

## Invariants that hold everywhere

**One listener set, one store.** Toasts, the drag gesture, written ratings, the queue clock, the playlist loader and the stream listener are all `useSyncExternalStore` stores over `shared/lib/store.ts`, which is the listener half and nothing else — what each store *holds* stays its own business. `notify()` iterates a copy, because a listener may unsubscribe from inside its own notification.

**A stored setting is shared by its key, not copied per caller.** `shared/hooks/useStoredState.ts` reads through that store, so every hook naming a key sees one value. A `useState` per caller makes a live pair out of every key with two readers.

**Sequential work goes through `inSequence` in `shared/lib/sequence.ts`.** Jean has more of it than expected: the player renumbers the play queue on every removal, only the first chunk of a library fill may `replace`, and `Promise.all` arrives in whatever order the network settles on. **The trap is `void`**: `done.then(() => void run(...))` calls each step in turn and hands `undefined` to `then`, so nothing waits for anything and the sequencing is silently gone.

**A positional column set is declared once, as pairs.** `shared/api/fieldTable.ts` derives both the expression list sent to the player and the index each name landed at, because answers come back positionally. Written out separately, the day somebody inserts an expression in the middle is the day a row reports its genre as its artist.

**An exhaustive dependency array can be exhaustive and useless, and the linter only checks the first half.** `useLibrary` returns an object literal, so `library` is a new identity every render and a `useMemo` keyed on it never hits. **Depend on `library.snapshot`** — the store's own object, replaced only when a load publishes. Read a green dependency array as saying nothing about whether the memo works.

The corollary is a signature rule: **a caller's dependency array can only be as narrow as the function it calls.** Handed a whole object it must depend on the whole object, so the narrowing has to happen at the parameter.

**The `useExhaustiveDependencies` suppressions are deliberate and all one shape**: a dependency that exists to *fire* the effect rather than to be read inside it — `[query]` resetting a cursor, `[results]` re-arming a hover guard, `[isAlbumLayout, isCompactViewport]` invalidating cached row heights. The rule cannot model that, so `--write` would remove every one and break the feature silently.

**Never gate behaviour on a `mounted` ref set only in an effect cleanup.** StrictMode mounts, unmounts and remounts in development, so the cleanup sets the flag false and nothing sets it back: the guard is permanently on, in dev only. If a guard is genuinely needed, set it true in the effect body as well. Usually it is not needed — work touching only refs and network calls is safe to finish after unmount.

**Anything the user types at a list is matched through `fold()` in `shared/lib/text.ts`**, which lowercases and strips diacritics, so `babasonicos` finds `Babasónicos`. **Fold when the haystack is built, never per keystroke** — folding a 30,441-row index costs ~6 ms against ~0.6 ms for a plain lowercase, and a search is then one `includes()`. Fold the query too, or an accented query stops matching the folded index.

**Measurements belong in a CLAUDE.md**, never in a comment. Record the constraint the measurement established — "beefweb hangs up on a body over 1 MiB", "there is no way to ask for a thumbnail" — in whichever file owns that part of the app.

## What is deliberately not built

The code says what exists; this says what does not, and why.

- **No lyrics writing and no lyrics fetching.** Jean reads `$meta(unsynced lyrics)` and never fills it in. The empty state names `foo_openlyrics` rather than offering to do it.
- **No listening charts over time**, and there never will be without another component: the player reports a lifetime play count and a single last-played date, which cannot support a per-day chart or a month-over-month delta. The genre bars are the one chart on the screen, because a distribution needs no history.
- **No folder tree.** `#/all` browses the library as one flat list. `/library/items/by-path` is documented in `API.md` for when that changes.
- **No Web Worker and no IndexedDB persistence**, so a cold start re-fetches and re-indexes. Both are requirements for 100k–200k libraries, not things already done.
- **Tag writing is one field.** `domain/track/tagWriter.ts` writes **ratings** and nothing else. Genre, comment and the rest of what the component could write are deliberately not wired up: the seam should not be shaped around a second field before there is one.
- **No "play next", and no lookahead of any kind.** `queueIndex` on `/playqueue/add` is accepted and silently ignored, and the API says nothing about what the player would play next on its own. The queue panel shows what was explicitly queued and says so.
- **No sending audio to another device.** Other listeners are a roster and never a set of targets: starting playback in a browser needs a gesture on *that* browser, so a "play on the kitchen phone" button would fail every time the phone was locked. Jean shows who has the sound and offers nothing to press.
- **No multi-room sync.** The player and the stream can both be on, and they are a second or two apart. Closing that would mean delaying the player's own output past the stream, and `foo_jean` captures post-DSP with nothing after it to delay; each listener's lag differs anyway, so one delay could never align two of them. The picker says by how much and leaves it there.
- **The now-playing swipe-to-skip gesture is not built.** Skipping there is the screen's buttons, the keyboard, or `Mod+Arrow`.
- **Artist information is the one thing that leaves the network**, and it is off until switched on in Settings. MusicBrainz and Wikipedia, no key, no proxy — and no artist *images*: the obvious source is Deezer and it sends no CORS header.
- **`Mosaic` is on hold.** Do not rework it or add tests for it.
- **Reconciling a stale `itemCount` is only partly built.** `usePlaylists` and `useLibraryInfo` refetch on window focus. The live `playlistItems` tripwire in `API.md` is not wired; arithmetic that cannot survive being wrong re-reads the count itself.
