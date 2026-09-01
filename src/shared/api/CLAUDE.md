# Talking to the player

`API.md` is the full measured surface. These are the traps that have already cost
time:

- **The column list is split on commas before evaluation**, so any title-format function
  taking more than one argument is unusable — `$if(a,b,c)` arrives as three columns.
  **Single-argument functions do nest**, though: `$len($meta(unsynced lyrics))` works. Use
  that for cheap server-side computation.
- **`%added%` does not exist** — it returns `?` on every track, so there is no
  date-added field at any price. `%date%` is a different story and the previous note
  here was wrong: *measured* over 30,441 tracks it resolves on 30,347 of them —
  26,891 year-only (`2010`), **3,022 full ISO dates** (`1992-10-13`), and 434 untidy
  (`1997, 1997-02-10`, `2011-00`, `2010-09-28T07:00:00Z`). It is an ordinary messy
  user tag, not a mangled constant. **Still sort and group by `%year%`**, which is
  clean and integer-shaped; reach for `%date%` only where a real release date is worth
  having, and parse it leniently.
- **`%last_modified%` is not a date-added field.** Playback can rewrite tags, which bumps
  the file mtime — measured, the mtime moves ~55 s before the scrobble lands, and 21% of
  played tracks have an mtime within ten minutes of their last play. It is
  `max(added, last played or retagged)`, and it is wrong precisely at the recent end. Build
  "recently added" from Jean's own first-seen index instead, seeded from mtime on first
  sync.
- **Lyrics are `$meta(unsynced lyrics)`** — with a space, and it holds LRC-timestamped
  content despite the name. Reading them needs **no component**; they're an ordinary tag.
  `%lyrics%` returns `?` and `$meta(unsyncedlyrics)` finds nothing.
- **`GET /api/player` ignores `trcolumns`** and returns `"columns": []`. Use
  `GET /api/query?player=true&trcolumns=…`.
- **Volume is decibels** (`-100..0`), not a percentage, and `volume.type` says so --
  another player may report a linear range. How the fader maps onto that range is
  in `src/domain/player/CLAUDE.md`.
- **`itemCount` in `PlaylistInfo` goes stale and nothing corrects it.** *Measured*:
  the update stream pushes `playlists` when a playlist is added, renamed or deleted,
  and pushes nothing at all when its *items* change. So a cached count is wrong from
  the first `items/copy` onwards. Re-read it from the player before doing arithmetic
  with it — how many rows to remove, whether a cached view still matches, whether an
  undo range is still the range it was. Trusting it emptied 99 rows out of a 113-row
  playlist and then played whatever had drifted into the row that was clicked. A
  one-item `playlistItems` subscription is a cheap tripwire if you need to notice;
  see `API.md`.
- **A set arrives in an order of the player's choosing, never the order you asked
  for.** `items/copy` returns playlist indices ascending, so the playlist source is
  safe once refs are sorted. `add-from-library` is **not**: it returns the
  media library's *browse* order -- album artist, album, track -- which is not the
  file-path order `/library/items` pages in. *Measured* on 30,441 tracks: of 100 sent
  in path order 10 landed elsewhere, of 1,000 426 did, of 8,000 3,945 did. Sorting
  refs ascending is necessary and **not sufficient**; see "Filling a playlist from the
  library" in `src/domain/library/CLAUDE.md` for what is.
- **Playlist items have no ID.** Index is identity, so any mutation invalidates indices
  you were holding.
- **SSE is change-driven, not a ticker.** Long silences are normal; `position` alone never
  triggers a message.
- **The static server has no SPA fallback** — `/playlists/p2` is a 404. Use hash routing.

**`shared/api/types.ts` is hand-written and is the contract.** Not generated: beefweb
ships an OpenAPI document, but it describes 0.10, and the parts Jean leans on
hardest -- the media library API, and the fields that are *absent* rather than
empty -- are either newer than it or not expressible in it. The fake player is
checked against these same types, which is the point: a response shape that
drifts from what the app expects is exactly the bug the suite exists to catch.
It has already earned it twice -- the captured player sends `info.title` and
`options[].name`, neither of which API.md's summaries mention.
