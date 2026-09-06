# Talking to the player

`API.md` is the full surface. These are the traps that have already cost time.

## beefweb

- **The column list is split on commas before evaluation**, so any title-format function taking more than one argument is unusable — `$if(a,b,c)` arrives as three columns. **Single-argument functions do nest**: `$len($meta(unsynced lyrics))` works, which is how to ask about a large field without downloading it.
- **`GET /api/player` ignores `trcolumns`** and returns `"columns": []`. Use `GET /api/query?player=true&trcolumns=…`.
- **The play queue's columns parameter has two names.** `GET /api/playqueue` takes **`columns`**; `/api/query` and `/api/query/updates` take **`qcolumns`**. Sending the wrong one is a 200 with `"columns": []` on every entry, which reaches the UI as a panel of blank rows rather than as an error. Jean asks through `/api/query` in both places so first paint and every push evaluate the same expressions.
- **A play queue entry holds a track, not a position, and `itemIndex: -1` is an orphan.** Removing a playlist row above a queued one renumbers the reported index rather than stranding the entry; removing the queued track itself leaves the entry with `itemIndex: -1` and **garbage in `columns`**. Test the index; never read an orphan's columns.
- **`queueIndex` is honoured on `/playqueue/remove` and silently ignored on `/playqueue/add`.** So removal is exact and insertion does not exist: a reorder is a remove-and-re-append of the tail. The add returns **204**, not 400, so there is nothing to feature-detect it with.
- **Deleting a playlist the play queue points into crashes `foo_beefweb`** and takes foobar2000 with it. `dequeuePlaylist` clears the entries first and `usePlaylistActions` abandons the delete if they will not clear. Crash report in `API.md`.
- **`itemCount` in `PlaylistInfo` goes stale and nothing corrects it.** The update stream pushes `playlists` when a playlist is added, renamed or deleted, and pushes nothing when its *items* change. Re-read it from the player before doing arithmetic with it — how many rows to remove, whether a cached view still matches, whether an undo range is still that range. Trusting it emptied 99 rows out of a 113-row playlist and then played whatever had drifted into the row that was clicked.
- **A set arrives in an order of the player's choosing, never the order asked for.** `items/copy` returns playlist indices ascending, so the playlist source is safe once refs are sorted. `add-from-library` is **not**: it returns the media library's *browse* order — album artist, album, track — which is not the file-path order `/library/items` pages in. Sorting refs ascending is necessary and not sufficient; see "Filling a playlist from the library" in `src/domain/library/CLAUDE.md`.
- **Playlist items have no id.** Index is identity, so any mutation invalidates indices being held.
- **SSE is change-driven, not a ticker.** Long silences are normal; `position` alone never triggers a message.
- **The static server has no SPA fallback** — `/playlists/p2` is a 404. Hence hash routing.
- **`%added%` does not exist**, so there is no date-added field at any price. **`%date%` is an ordinary messy user tag** — year-only on most tracks, full ISO on some, untidy (`1997, 1997-02-10`, `2011-00`) on a few. Sort and group by `%year%`, which is clean and integer-shaped; parse `%date%` leniently only where a real release date is worth having.
- **`%last_modified%` is not a date-added field.** Playback can rewrite tags, which bumps the mtime — it moves ~55 s before the scrobble lands, and 21% of played tracks have an mtime within ten minutes of their last play. It is `max(added, last played or retagged)` and wrong precisely at the recent end.
- **There is no play *history*, only a last play.** `%lastfm_play_count%` is a lifetime total and `%lastfm_last_played%` is the most recent play and nothing else. Any per-day or per-week chart undercounts every older bucket and slopes upward whatever the listening did; any "vs. last month" delta compares a full window against a decayed one. A window can honestly report how many *distinct tracks* were touched since a date, and must say so in those words.
- **Lyrics are `$meta(unsynced lyrics)`** — with a space, and it holds LRC-timestamped content despite the name. Reading needs **no component**. `%lyrics%` returns `?` and `$meta(unsyncedlyrics)` finds nothing.
- **Volume is decibels**, not a percentage, and `volume.type` says so — another player may report a linear range. **The floor is the player's, not a constant**: `-100..0` on foobar2000 and `-50..0` on DeaDBeeF, so read `min` and `max` rather than assuming either. How the fader maps onto it is in `src/domain/player/CLAUDE.md`.
- **The playback order is not the same option on both players.** foobar2000 exposes one enum named `playbackOrder`; DeaDBeeF exposes `shuffle` and `repeat` separately and answers **`400 invalid option id`** for that name. The deprecated top-level `playbackMode` / `playbackModes` pair is what both still accept, and beefweb translates it back into DeaDBeeF's own two. The lists differ in wording *and order* — index 1 is `Repeat (playlist)` on foobar2000 and `Loop track` on DeaDBeeF — so nothing may map a mode by index.
- **`GET /clientconfig/{id}` answers `200` with a body of `null` for an id nobody has written**, not a 404. That is the "not installed" signal for `foo_jean` and is the common case, so it is not an error path. Nothing on that route is authenticated and `changeClientConfig` defaults to on, which is why a record read from it is a hint and never evidence; see the root `CLAUDE.md`.

## `foo_jean`

**One discovery, two seams.** `discoverFooJean()` lives here rather than beside either consumer: tag writing is in `domain/track` and listening is in `domain/player`, tiers that may not import each other, and each running its own probe would send two `status` calls and two `capabilities` calls to answer one question. `FooJeanState` describes the *component*, not either seam. `shared/hooks/useFooJean.ts` is the react-query dedupe over it: every caller names one key, so the second to mount reads the first one's result.

**`TOKEN_KEY` lives here, and may never move to `/api/clientconfig`**, because beefweb serves that namespace unauthenticated.

**`POST /pair` is the other route with no bearer token, and the only one that emits one.** It answers during a window opened at the player, to a caller on the local network, once. Two failures matter and are different sentences: a 403 saying *pairing is not open* is a button somebody has to press and the message must name the menu path, while a 403 saying *local network only* is a fact no pressing will change. A 404 is a component too old to have the route. **`Content-Type: application/json` is mandatory** — the component refuses anything else, because a simple POST needs no CORS preflight and could otherwise be fired blind by a page to spend the single grant.

**`discovery.origin` is non-null exactly when `/api/status` answered as `foo_jean` at a supported version**, which makes it the proof that a port is safe to post to. Pairing needs that before it has a token, so it cannot be gated on `ready`.

**`POST /stream/ticket` is where this device says who it is**, and the only place it can: an `<audio>` element sends no body and no header of its own, so the identity has to ride the one request the client controls. Both fields are untrusted text and the component treats them as such — a bad name is dropped and the ticket is still issued, because a label must never cost somebody their audio.

**`GET /playlists` is the one question beefweb cannot answer.** `PlaylistInfo` has six fields and none
of them says whether a playlist is an autoplaylist; every way of working it out from outside is worse
than not knowing, which is why `domain/library/CLAUDE.md` says to stop looking. Joined on
`beefwebId` — **and beefweb must be asked first**, because it assigns its ids lazily and a playlist
created a moment ago reports `null` until beefweb next rebuilds its map. Asking beefweb is what makes
it look. Jean uses the answer only to *remove* affordances, so absent, unreachable or unpaired every
playlist looks exactly as it did before.

**`POST /autoplaylists/preview` runs on foobar2000's main thread**, so one request per keystroke is
one main-thread callback per keystroke. A query that does not parse is a **`200` carrying
`valid: false`**, not an error — it is called while somebody types. Read `libraryEnabled` before
`matches`: an install with no Media Library matches nothing whatever the query says, and every
autoplaylist created there is empty.

**Queries are passed through untouched, so quoting is Jean's.** The component never composes or
interprets one; the player owns that language and is the only thing that can say whether a query
parses. A tag pasted in unquoted can produce a query that parses and means something else, and no
validation on either side can catch it.

**`DELETE /stream/hold` has no matching PUT, and that is deliberate on the component's side.** A client asks for the player to be audible alongside the listeners; *when* the two should be one is the component's decision, and it takes the hold back on its own once nobody is listening.

**`GET /stream` takes no bearer token**, because an `<audio>` element cannot send a header. The ticket is the credential and it travels in the query string, which is why it expires in minutes; **the token must never go there**. All three 401 causes — no ticket, unknown, expired — answer identically on purpose, so a client cannot sort guesses into "wrong" and "too late", and cannot tell any of them from an undecodable codec either. A 503 is *two* conditions distinguished only by the `error` string: this install does not stream, or it is already serving as many listeners as it allows. The second must read as "busy" and retry.

## Types

**`foo_jean`'s types are generated, and not into `fooJean.d.ts`.** The component ships an OpenAPI document and it is the contract, so `fooJeanSchema.d.ts` comes out of `npx openapi-typescript ../foo_jean/docs/openapi.yaml`, committed, with no codegen step in `pnpm build` — that would make the build depend on a sibling repo being checked out. **The name is the trap**: `fooJean.d.ts` beside `fooJean.ts` is read by TypeScript as that file's own declarations, so every import of it is circular and the error says neither of those things.

**`types.ts` is hand-written and is the contract for beefweb.** Not generated: beefweb's OpenAPI document describes 0.10, and the parts Jean leans on hardest — the media library API, and fields that are *absent* rather than empty — are either newer than it or not expressible in it. The fake player is checked against these same types, which is the point: a response shape drifting from what the app expects is the bug the suite exists to catch. The captured player sends `info.title` and `options[].name`, which no summary of the API mentions.
