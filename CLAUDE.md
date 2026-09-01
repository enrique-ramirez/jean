# Jean

A replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin,
controlling foobar2000 (and, best-effort, DeaDBeeF) over HTTP.

Named for how it feels to use. Rhymes with *pan*, not *bean*.

## What this is

**A general-purpose UI meant for public release, not a personal dashboard.** It happens
to be developed against one person's library, but nothing may assume that library. No
hardcoded playlist IDs, no assumed paths, no assumed scale, no assumed components.

The primary axis of quality is **UX/UI, and performance is part of UX**. A feature that
makes the interface slower needs to justify itself. When in doubt, favour the choice that
keeps interaction responsive.

## Look it up before you draw it

**Every piece of UI gets a reference pass before it gets written.** Search for how good
products solve the same problem, then decide. Worth having in the rotation: **Mobbin**,
**Refero**, **Screenlane**, **UI Sources**, **Godly**, **Awwwards**, **Land-book**,
**Dribbble**, **Behance**, **DeviantArt**, **Pinterest**. Naming the component and the
platform is usually enough of a query -- "action sheet mobile", "context menu desktop
dark", "sidebar drag reorder".

The point is not to copy. It is that the shape a component takes when you write it from
memory is the median of everything you have ever seen, and the median is exactly what
makes an interface look templated. Look at several, take the one decision from each that
is actually good, and know what you rejected.

Two standing rules fall out of it:

- **Never look like Spotify.** It is the obvious reference for a music player and
  therefore the one place Jean has nothing to gain by resembling. If a screen could be
  mistaken for it, redraw it.
- **Record the choice.** A comment saying "this is an action sheet, not a bottom sheet,
  because ..." is worth more than the code under it. Vocabulary is a design decision --
  the two are different components and only one of them is detached from the edges.

## Ground rules

- **Fully responsive.** One codebase, no separate mobile build.
- **Desktop is keyboard-first.** Rich, discoverable keyboard navigation via
  `@tanstack/react-hotkeys`. Anything reachable by mouse should be reachable by key.
- **Mobile is aggressively optimised** — touch targets, safe-area insets, and a much
  tighter payload and interaction budget than desktop.
- **Light and dark themes, both designed.** Neither is `#000` / `#fff`.
- **Minimum required components: beefweb alone.** Everything beyond that is optional,
  auto-detected, and individually toggleable in Jean's own settings UI. A bare beefweb
  install must get a complete, coherent app — never a dead panel or an empty shelf.
- Keep the supported-component list in `README.md` current as features are added.

## foobar is the source of truth

Prefer the player's own metadata over anything Jean invents. In order of preference:

1. **Read it from foobar** via title-formatting columns. Always check this first — the
   player computes, so the reachable surface is much wider than beefweb's own schema.
2. **Get it to live in foobar**, if a component or tag can supply it. Requiring an
   optional component for an optional feature is acceptable and expected.
3. **Store it locally in Jean**, only when foobar genuinely cannot hold it. This is a
   legitimate fallback, not a failure — but reach for it third, not first.

Writing a custom foobar component to feed Jean is a deliberate last resort. Don't design
toward it.

Corollary: **Jean's own settings live server-side** in `/api/clientconfig/{id}`, so they
follow the user between devices. Fall back to `localStorage` only when
`permissions.changeClientConfig` is false.

That namespace is shared, and **`foo_jean` is spoken for** — the component publishes its
discovery record under that id, and Jean writing there would clobber it. Ids are
lowercase alphanumeric plus underscore (`foo-jean` is rejected with a 400). See
*Detecting `foo_jean`* under *Capability detection*, which also explains why a record
read from that namespace is a hint rather than evidence.

## Where the rest of this lives

This file is what holds everywhere. Everything specific to one part of the app sits
next to that part, so it loads when you are working there and stays out of the way
when you are not:

| | |
|---|---|
| `src/shared/api/CLAUDE.md` | traps in beefweb's API |
| `src/shared/ui/CLAUDE.md` | menus, gestures, drag and drop, toasts, animation |
| `src/shared/keyboard/CLAUDE.md` | the keymap and how bindings are declared |
| `src/domain/track/CLAUDE.md` | the virtualised list, rows, refs, loading, rendering, ratings |
| `src/domain/library/CLAUDE.md` | where the library comes from, playing a set, search results |
| `src/domain/player/CLAUDE.md` | playback state and the controls over it |
| `src/features/home/CLAUDE.md` | the home screen and its shelves |
| `src/features/search/CLAUDE.md` | the search control |
| `src/app/CLAUDE.md` | the shell, breakpoints and themes |

Three documents sit outside this one and do not overlap with it: `API.md` is what
beefweb and foobar2000 actually do, measured; `CONTRIBUTING.md` is the development
loop and the conventions; `README.md` is for someone installing Jean.

## Capability detection

A title-formatting field that **does not exist returns `?`**. A field that exists but is
empty returns `0`, `''` or `N/A`. That difference is the whole feature-detection mechanism:
probe a set of columns against a few sample tracks on connect, and enable features for
whatever resolves. Users can override in settings when detection guesses wrong.

*Measured* against a real foobar2000 install, probing 50 expressions across both
sources: **the autoplaylist and the media library API resolve byte-identical values for
every field**, so a column that works on one works on the other and capability
detection never has to ask which is in play. What that install resolves, and what it
does not, is worth knowing before designing a feature on it: `%genre%` (144 distinct),
`%year%` (69), `%album artist%` (742), `%lastfm_play_count%` (every track),
`%lastfm_last_played%` (69% of them), `%publisher%`, `%date%`, `%length_seconds%`,
`%codec%`, `%bitrate%` and `$len($meta(unsynced lyrics))` all answer. `%added%`,
`%play_count%`, `%last_played%`, `%rating%`, `%composer%`, `%bpm%`, `%totaltracks%`
and `%replaygain_*%` do not. **Ratings exist but are sparse**: `$meta(rating)` and
`%rating%` both answer on exactly 500 of 30,441 tracks — an earlier note here said
they were empty on every track, which was a five-row sample landing on unrated ones.
Sparse is its own trap: 375 of those 500 are the value `5`, so anything sorting by
rating is sorting a flat tie, and a 200-row capability sample misses the field
entirely about one library in twenty-five. Those are one install's components, not a
rule: detect, never assume, and sample properly — or, where the field is this sparse,
do not sample at all. **`$meta(x)` cannot be feature-detected**: it answers `''` for
a field that does not exist, where `%x%` answers `?`. Verified across `$meta(rating
wmp)`, `$meta(popularimeter)`, `$meta(rating winamp)`, `$meta(popm)` and
`$meta(fmps_rating)`, all of which return `''` on every one of 30,441 tracks and none
of which distinguishes "no such field" from "nothing in it".

`player.info.name` distinguishes foobar2000 from DeaDBeeF. Support DeaDBeeF on a best-effort
basis — feature detection covers most of it. Do not invest in a second title-format dialect
without a real report.

### Detecting `foo_jean`, and why its answer cannot be trusted

`foo_jean` is optional and always will be. Jean must work with it absent, and light up
tag writing when it is there.

Nothing of this is built yet. The plan is a `domain/library/tagWriter.ts` seam in the shape of
the existing `librarySource.ts` — `{ kind, canWrite, allowedFields, write(track, fields) }`
with implementations for *none* (nothing reachable; rating renders read-only and every
install still works), *agent* (`foo_jean`), and *beefweb* if [#384](https://github.com/hyperblast/beefweb/issues/384)
ever ships. If anything outside that file has to ask which writer it holds, the seam is
in the wrong place. What follows is the part of that design that is already settled,
because it is a contract with a component that exists.

**The mechanism.** On every start the component writes
`<profile>/beefweb/clientconfig/foo_jean.json`, which beefweb then serves at
`GET /api/clientconfig/foo_jean` — **same origin as Jean**, so it is one request folded
into connect, with no CORS and no port scanning:

```json
{ "name": "foo_jean", "version": "0.1.0", "apiVersion": 1,
  "port": 8881, "authRequired": true, "listening": true }
```

Measured end to end on 2026-09-01: writing the file made it readable through beefweb
from another machine, and deleting it returned `null`. **`null` is the "not installed"
signal** and is the common case.

**`listening: false` is not the same as absent.** When the component loaded but could
not bind its port, the record still appears, carrying `"portInUse"` and an `error`
string. Show that. "foo_jean is installed but could not start on port 8881" is a thing a
user can act on; silently rendering ratings read-only is not.

**Now the part that matters: that record is writable, so it is not evidence.**
`POST /api/clientconfig/{id}` is a real beefweb route, `permissions.changeClientConfig`
defaults to *true*, and beefweb ships with no authentication at all. Anyone who can
reach beefweb can overwrite `foo_jean.json` and name any port they like, and the
forgery lasts until the component next starts.

So a forged record can point Jean at a port of an attacker's choosing — and Jean, if it
simply believed it, would `POST` the user's bearer token there. **Never send the token
to a port that only this record vouched for.** The sequence is:

1. Read the record. `null` → no component, use the *none* writer, done.
2. `GET http://<same-host>:<port>/api/status` — **unauthenticated on purpose**, and it
   must answer with `name` of `foo_jean` and an `apiVersion` Jean understands.
3. Only then attach `Authorization: Bearer <token>` to anything.

That leaves the attack needing someone who can already run a listener on the player
itself, which is a much larger problem than Jean can solve. Step 2 is cheap and is not
optional.

**The token is pasted once, by hand.** It is generated on the component's first run into
`<profile>/foo_jean/config.json` and is deliberately **not** in the advertisement —
anyone who can reach beefweb can read that file, and "can reach beefweb" must not become
"can rewrite my music". So discovery removes the port from setup, not the credential.
One paste, stored the same way Jean stores its own settings.

## Generality constraints

Things that vary between installs and must never be assumed:

| | |
|---|---|
| Which playlist is "the library" | An autoplaylist the user creates and names `#Jean Library`. Guide them through it on first run; match the name exactly and never a title they chose. Never assume `p1` — that is scratch space. |
| `permissions` | `changePlaylists`, `changeOutput`, `changeClientConfig` come from the player. Gate the UI on them — a read-only instance gets a read-only Jean, not buttons that 403. |
| `authRequired` | May be on. Support Basic auth and a credentials prompt. |
| `pathSeparator` | From `/api/browser/roots`. `\` on Windows, `/` elsewhere. |
| Library size | Anywhere from empty to 200k+. |
| Components | Detect, never require. |
| Player | foobar2000 or DeaDBeeF. |
| Keyboard layout | A binding written as an unshifted key is not unshifted everywhere. See `src/shared/keyboard/CLAUDE.md`. |

CORS is off in beefweb by default, so Jean must be served same-origin — either by beefweb
itself, or through a dev proxy. See `CONTRIBUTING.md`.

## Rules that hold everywhere

**The tiers came out of a cycle, not a diagram.** `playlist/` used to be two
folders under one name -- the generic list machinery and the playlist view --
so `library` and `playlist` each imported nineteen and fifteen things from the
other, and `api` imported the column list from `playlist`. Splitting the
machinery out as `domain/track` broke all three cycles. The files that would
not sit still afterwards were the ones in the wrong tier: `keymap` is shared
infrastructure rather than a feature, `LibrarySetup` belongs to the library
domain rather than to one view of it, and `fetchPlaylistItems` had no business
knowing Jean's columns -- it takes them as an argument now.

**TypeScript, strict, in three scopes.** `tsconfig.app.json` is the browser,
`tsconfig.node.json` the fake player (which `node` runs by stripping types, so
its imports name `.ts` explicitly and `erasableSyntaxOnly` makes an enum a
compile error rather than a crash at `pnpm fake`), and `tsconfig.test.json` the
Playwright specs. `pnpm build` typechecks before it bundles; Vite never does.

**`noUncheckedIndexedAccess` is off**, and that is a decision rather than an
oversight: every read of a dictionary-encoded column, an `Int32Array` of refs or
a positional column array is indexed by construction, so it would demand a guard
on each one and teach nothing. `noUnusedParameters` is off for the specs alone,
because in Playwright *naming* a fixture is how a test depends on it -- several
take `player` purely to get a fresh fake and never touch it.

**A store is never named after the component beside it, because a
case-insensitive filesystem cannot tell the two apart.** `shared/ui/toastStore.ts`
sits next to `shared/ui/Toasts.tsx`, and had it been `toasts.ts` TypeScript would
resolve `'./Toasts'` by probing `Toasts.ts` first, macOS would answer yes, and the
import would land silently on the *store*. The compiler caught that one; nothing
else would have. `domain/player/volumeScale.ts` was the same fix, and the tiers
have since put it in a different folder from `features/now-playing/Volume.tsx`
anyway -- which is luck, not a reason to relax the rule.

**Biome's import sorting broke a stylesheet, which is worth knowing before it
happens again.** CSS Modules are ordered in the bundle by the order their
components import them, so two rules of *equal specificity* in different modules
are decided by import order -- and sorting the imports flipped it.
`.tracks > *` in `AlbumGroup.module.css` and `.track` in `TrackRow.module.css`
are both `(0,1,0)`, so `height: auto` quietly lost to `height: 100%` and every
two-line album row snapped back to 34px. The fix is not to stop sorting imports:
it is `.group .tracks > *`, so the rule wins on specificity and the module graph
stops being load-bearing. **Anything in one module that overrides another's must
outrank it, not merely follow it.**

**An exhaustive dependency array can be exhaustive and useless, and Biome only
checks the first half.** `useLibrary` returns an object literal, so `library` is
a new identity every render and a `useMemo` keyed on it never hits. Three were:
`wholeLibrary` allocating a fresh 30,441-element `Int32Array`, `project`
rebuilding a search's rows, and `albumsOf` re-aggregating every row into albums
-- all on every render of `App`, which subscribes to the player stream and so
re-renders on each SSE message and each coalesced volume write. Dragging the
volume fader on a shelf route re-aggregated the library once per write. The
linter was silent on all three, because `[library]` is precisely what the rule
asks for, and loud on eleven hooks that were correct. **Depend on
`library.snapshot`** -- the store's own object, replaced only when a load
publishes -- and read a green dependency array as saying nothing whatever about
whether the memo works.

The corollary is a signature rule: `albumsOf` takes rows rather than the
snapshot they came from, because **a caller's dependency array can only be as
narrow as the function it calls.** Handed a whole object it has to depend on the
whole object, and the narrowing has to happen at the parameter to be available
at the call.

**The eight `useExhaustiveDependencies` suppressions are deliberate and all one
shape**: a dependency that exists to *fire* the effect rather than to be read
inside it -- `[query]` resetting a cursor, `[results]` re-arming the finder's
hover guard, `[isAlbumLayout, isCompactViewport]` invalidating cached row
heights. The rule cannot model that, so `--write` would remove every one and
break the feature silently. `Sidebar`'s is the other half of the same blind
spot, reported twice on one hook: it lists what `deletePlaylist` captures
instead of `deletePlaylist`, which is re-created every render and would defeat
the memo entirely.

**Anything the user types at a list is matched through `fold()` in `shared/lib/text.ts`**, which
lowercases and strips diacritics, so `babasonicos` finds `Babasónicos`. Requiring people
to type the accents in their own library taxes exactly the tracks they are most likely
to be hunting for, and from outside it does not look strict, it looks broken. Fold when
the haystack is *built*, never per keystroke: measured over 30,441 rows, folding the
whole index costs ~6 ms against the ~0.6 ms a plain lowercase took, and a search is still
one `includes()`. Both sides have to go through it -- fold the query too, or an accented
query stops matching the folded index.

**Tag hygiene is the library owner's business, never Jean's.** Jean reads tags, and
never writes or normalises them to make its own life easier. A genre spelled two ways
is two rows in a list, and that is the correct amount of harm: the owner can fix it in
foobar2000, where genres are actually browsed and where the fix sticks for every other
client too. Building a normalisation layer to hide it would make Jean disagree with the
player about what the library contains, which is a worse bug than the one it papers
over. The corollary is the rule below, and it is the whole of Jean's involvement.

**Never gate behaviour on a `mounted` ref set only in an effect cleanup.**
StrictMode mounts, unmounts and remounts in development, so the cleanup sets the
flag false and nothing sets it back -- the guard is then permanently on, in dev
only, and silently disables whatever it protects. If a guard is genuinely needed,
set it true in the effect body as well. Usually it is not needed: work that only
touches refs and network calls is safe to finish after unmount, and finishing it
is often the correct behaviour.

**Measurements belong in a CLAUDE.md, not in the code.** A number in a comment is
useful while the thing is being written and noise for everyone who reads it
afterwards -- it dates, nobody re-runs it, and it describes a machine that is not the
reader's. Record the constraint the measurement established ("beefweb hangs up on a
body over 1 MiB", "there is no way to ask for a thumbnail") and put the figures in
whichever of these files owns that part of the app.

## What is deliberately not built

The code says what exists; this says what does not, and why -- which is the part that
cannot be derived from reading it.

**No folder tree.** `#/all` browses the library as one flat list. Walking it by folder
is a separate feature, and `/library/items/by-path` is measured in `API.md` for when
that happens -- one request per level, with an ordering that needs a client-side
re-sort.

**No Web Worker and no IndexedDB persistence**, so a cold start re-fetches and
re-indexes the library. Both appear in the loading rules as requirements for
100k-200k libraries rather than as things already done.

**No tag writing.** There is no endpoint for it, and the `tagWriter.ts` seam described
under *Detecting `foo_jean`* is a plan rather than a file.

**`Mosaic` is on hold at the owner's request** -- changes are coming there, so do not
test or rework it yet.

**Reconciling a stale `itemCount` is only partly built.** `usePlaylists` and
`useLibraryInfo` refetch on window focus, so a count edited on the desktop is
corrected on the way back. The live `playlistItems` tripwire in `API.md` is not wired;
the arithmetic that cannot survive being wrong re-reads the count itself.
