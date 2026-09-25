# API reference

What `foo_jean` answers, as Jean uses it, and the foobar2000 behaviour behind it that Jean relies on. `foo_jean` is a foobar2000 component listening on a port of its own, typically 8881, and it serves Jean itself from that origin. Its source is `plugins/fb2k/`. Everything Jean calls arrives through it: playback, the player's own state, the playlist list and every edit to it, the queue, the library and its covers, writing tags, creating autoplaylists, and streaming the player's output.

**`contract/openapi.yaml` is that component's contract, and it is the reference for every route below.** Jean's types are generated from it, its descriptions carry the reasoning a client needs, and nothing restated here could do anything but drift from it. `plugins/fb2k/ARCHITECTURE.md` is the design behind it. What follows is only the part that is Jean's.

## Reaching it

| | |
|---|---|
| Base URL | `http://<player-host>:8881`, the origin Jean is served from |
| CORS | same-origin from Jean, so nothing it sends crosses one. `allowedOrigins` in the component's `config.json` is what a differently-hosted interface would need |
| SPA fallback | none. A path that names no file is a `404`, and a directory answers its own `index.html`, so a client-side route has to live in the hash |
| Owner's config | `<profile>/foo_jean/config.json`, which Jean never edits and has no route to. `plugins/fb2k/README.md` has the keys |

**Every `POST` needs `Content-Type: application/json`, matched as a case-insensitive prefix**, so a charset parameter riding along still counts. `foo_jean` checks this ahead of the body, so a body-less command such as a transport call still needs the header, and a request sending anything else is refused `415`.

## Discovery

`discoverFooJean()` in `fooJean.ts` takes the origin straight off `window.location.origin` and asks `GET /api/capabilities`, with no credential to attach. `ui/ARCHITECTURE.md`, *The `foo_jean` security model*, has the states that call resolves to.

## Columns and title formatting

Every `columns` parameter takes **foobar2000 title-formatting expressions**, evaluated by the player and answered as a positional array in the order requested. The player computes, so the reachable surface is far wider than any fixed schema: any component publishing fields or functions to the title-formatting engine becomes readable this way, and installing a playback-statistics component makes its fields start answering values instead of `?`.

> **Answers come back positionally, so the expression list and the name-to-index map must come off one declaration.** `fieldTable()` in `src/shared/api/fieldTable.ts` derives both. Written out separately, the day somebody inserts an expression in the middle is the day a row reports its genre as its artist.

### Capability detection

**A field that does not exist answers `?`. A field that exists but is empty answers `''`, `0` or `N/A`.** That difference is the whole of the capability probe: ask for a column set and enable whatever resolves.

- **`$meta(x)` cannot be feature-detected.** It answers `''` for a field that does not exist, where `%x%` answers `?`. Probe with `%x%`.
- **Sparse fields defeat sampling.** A field only some tracks carry can be missed entirely by a fixed sample. Detect per track where a field is sparse, as the Details panel does.
- **Which fields resolve is a fact about the install, not about a set of rows.** A playlist of untagged rips answers `?` for `%year%` while the library resolves it, so ask the library and let every view read that one answer. `src/domain/track/fieldAvailability.ts`.

### Expressions Jean uses

| Expression | Supplied by | Notes |
|---|---|---|
| `%artist%` `%title%` `%album%` `%album artist%` | core | |
| `%tracknumber%` `%discnumber%` `%totaltracks%` `%totaldiscs%` | core | |
| `%year%` | core | clean and integer-shaped. Sort and group by this |
| `%date%` | tags | an ordinary messy user tag, **not a date-added field**: year-only, full ISO and untidy values all appear. Parse leniently |
| `%genre%` `%publisher%` `%composer%` | tags | |
| `%length_seconds%` `%codec%` `%codec_profile%` `%bitrate%` `%samplerate%` `%channels%` | core | |
| `%filesize_natural%` `%filename_ext%` `%path%` `%subsong%` | core | `%path%` is absolute and platform-separated |
| `%rating%` | core, from the file tag | |
| `%replaygain_track_gain%` `%replaygain_album_gain%` `%bpm%` | tags | |
| `%lastfm_play_count%` `%lastfm_last_played%` `%lastfm_first_played%` | `foo_enhanced_playcount` | counts scrobbles across every device. `0` and `N/A` when unplayed, not `?` |
| `%play_count%` `%last_played%` `%first_played%` | `foo_playcount` | counts plays on this machine. A different number from the last.fm pair, so preferring one is a choice |
| `$meta(unsynced lyrics)` | tags | **the tag name has a space.** `%lyrics%` answers `?` and `$meta(unsyncedlyrics)` finds nothing |

Which of these resolve varies by install, by component and by how the library was tagged. Detect; never assume.

> **There is no play history, only a last play.** A play count is a lifetime total and a last-played is the most recent play and nothing else, so a track played today and again weeks ago reports only today. Any per-day or per-week chart built on it undercounts every older bucket and slopes upward whatever the listening did. A window can honestly report how many *distinct tracks* were touched since a date, and must say so in those words.

> **There is no working date-added field at any price.** `%added%` does not resolve. `%last_modified%` is not a substitute: playback can rewrite tags, which bumps the file's mtime, so it is `max(added, last played or retagged)`, wrong precisely at the recent end, where a "recently added" view would look.

> **Lyrics need no component.** `$meta(unsynced lyrics)` returns whatever is in the tag, which is LRC-timestamped only some of the time and is plain text more often than not. Real content includes several timestamps on one line, credit lines, and tags holding nothing but a URL. The field is large enough that it is fetched per track through `GET /api/track/playing` and **MUST never go in the library export's columns**, which carry every track. `foo_openlyrics` is what *writes* the tag.

## Paths

> **The player and the library disagree about what a path is.** The playing track's `path` in `GET /api/state` is the absolute, platform-separated form foobar2000 evaluates `%path%` to; a library path is relative to the media library folders and `/`-separated on every platform, Windows included. `player.libraryPath` carries the relative form where the media library holds the playing track. Nothing tells a client where the library folders are, so where only the absolute form is at hand the two are matched **by suffix** after normalising separators: `libraryPathMatcher()` in `src/shared/api/playerState.ts`.

## What Jean does about state

`GET /api/state` is the one route `domain/player/playerPoll.ts` asks, on a one-second interval with `If-None-Match`. Its two sections ride together: `library` carries the two generations covered next, in *What Jean does about the library*, and `player` carries what the player is doing right now. `contract/openapi.yaml`'s `State`, `Library` and `PlayerState` schemas are the reference; this is only the part that catches an unwary client.

- **`player.position` is a mark, not a moving number.** It carries `seconds`, the position at the moment the component last looked, and `ageSeconds`, how long ago that was. A client adds the two to place the mark and then keeps counting on its own while `player.playback` is `playing`, which `src/domain/player/position.ts` does.
- **`player` carries no `info` block.** The player's name and version do not change while it runs, so the poll does not repeat them; they come off a startup read of `GET /api/capabilities` instead, alongside the volume range (`volumeMin`, `volumeMax`, `volumeUnit`), the permissions (`canWritePlaylists`, `canChangeOutput`) and the list of playback modes this install can be put into.
- **`player.playbackMode` crosses the wire as Jean's own name**, one of `inOrder`, `repeatAll`, `repeatOne`, `random`, `shuffleTracks`, `shuffleAlbums` or `shuffleFolders`, mapped from whatever the player calls its own orders. `null` means the player is in an order this component has no name for, never a wrong one.
- **A manual skip leaves no empty track between two.** foobar2000 stops the outgoing track before it opens the next one, and reports that stop as one that is starting another. `foo_jean` ignores a stop of that kind, so `player` goes on naming the outgoing track, title, path and artwork, until the next one replaces it. A client that saw nothing playing across a skip would flash an empty cover and `0:00` on every manual change, and only on manual ones.

## What Jean does about playback

`shared/api/playback.ts` sends every transport, seek, mode and volume command to `foo_jean`: `POST /api/playback/play-pause`, `/next`, `/previous`, `/stop`, `/seek` and `/mode`, plus `POST /api/volume`. `contract/openapi.yaml` is the reference for each body, its statuses and the "exactly one of" rule the seek and volume routes read off which fields are present rather than off what they hold.

- **A mode travels by name, never by ordinal.** `POST /api/playback/mode` takes one of the seven `PlaybackMode` names off `GET /api/capabilities`'s `playbackModes`; a name this install does not offer answers `409` rather than being guessed at. The player's own ordinal means whatever this install's enum says it means, and its order and wording both vary.
- **Playback order applies to the active playlist, and playing a row sets it.** Shuffle draws only from the playlist the playing row belongs to, and foobar2000 has no selection to shuffle within, so confining playback to a set of tracks means getting those tracks into a playlist. That is what the scratch playlist is for.
- **`playback.ts` also holds `takeSkipAsked`**, the record of which way a skip was asked for. foobar2000 never says which direction a track change moved, and the cover wheel needs the direction before the player has answered anything.

## What Jean does about the library

`GET /api/library/export?columns=…` answers the whole library in one binary body. `jlib.ts` decodes it and `fooJeanLibrary.ts` is the loop that asks for it. `contract/openapi.yaml`, *The media library*, is the format, the two generations and every status. On this side:

- **Jean sends `TRACK_EXPRESSIONS`, one `columns` parameter per expression, never comma-separated**: a title-formatting expression may contain a comma.
- **`?`, `''` and `N/A` arrive exactly as the player produced them.** Nothing in the component parses, normalises or types a value, which is what keeps Jean's capability detection working. **Never coerce one to `null`**: `Number(null)` is `0` and every field would then read as available.
- **The header answers capability detection exactly**, so a field that resolves on one track in ten thousand is detected rather than missed by a sample. Detection is still a guess a Settings switch overrules.
- **An export a tab held from before the component restarted stands for a snapshot that is no longer there.** `library.ready` is false from the moment `foo_jean` starts until it has built its first media library snapshot, and every library address is a `404` in that window. What tells a stale export from a live one is the generation held when a read came back unbuilt: the component answers `GET /api/library/export` with `202` rather than rows until the snapshot exists, so a generation it has named is proof there is one behind it, and any generation since that mark outranks it. `playerPoll.ts` takes the mark and `librarySource.ts`'s `libraryAddressesResolve` reads it before a library address is sent.
- **A `{structure, revision}` pair compares for equality only, never for order.** `revision` counts within one `structure`, and `structure` itself resets when the component starts fresh, so a pair read after a restart can be lower than one already held without being older. `playlistStore.ts`'s `recheckMissed` holds the pair a poll answered while an entry was busy and, once idle, checks it against the one the entry landed on rather than trusting which sorts higher. A mismatch is worth a fresh, untagged `GET /api/state`: the route is `ETag`ged, so once the player settles every later poll answers `304`, and a generation seen mid-export would otherwise never surface again.

**A playlist's own `structure` and `revision` are a different pair from this one, and they travel as strings of decimal digits rather than numbers.** `contract/openapi.yaml`'s `PlaylistAnnotation.structure` has why; `playlistStore.ts` keeps a playlist's feed and the library's snapshot as two separate shapes because of it. `recheckMissedPlaylist` holds a missed playlist generation the same way, but replays it directly against `recheckPlaylist` rather than reading `GET /api/state` again. The generation it holds already came from `GET /api/playlists`, a plain, unconditional read that never answers `304`, so nothing between a miss and its replay can make the held value stale.

## What Jean does about playlists

`GET /api/playlists` is the list, and every route here names a playlist by the foobar2000 GUID an entry carries. `usePlayer.ts`'s `recheckPlaylists` reads it. The rows come from `GET /api/playlists/{id}/items` and its `changes` companion, through `usePlaylistItems.ts` into `playlistStore.ts`; the writes live in `usePlayer.ts`'s `usePlaylistActions`, `librarySource.ts` and `useAddTracks.ts`. The component creates a playlist, filled in the same job or holding nothing, retitles one, deletes one, moves one in the player's list, appends library rows to one, copies a source playlist's rows into one, removes rows from one, fills its own scratch by role, and starts a row playing. `contract/openapi.yaml`'s playlist paths are the reference for all of it, including which of them `writePlaylists` refuses. On this side:

- **`itemCount` is the count as of the read that carried it.** foobar2000's own window, another client and an autoplaylist refilling itself can all edit a playlist after that read, and the list is only re-read when a poll notices. Arithmetic on it that cannot survive being wrong, such as how many rows to remove or whether a cached view still matches, MUST re-read it first; trusting it removes the wrong rows and plays whatever drifted into the row that was clicked.
- **An autoplaylist refuses an added row with `409`.** foobar2000 locks a playlist per edit and the component reports the refusal, so no route answers a `200` with an empty `positions` and a client has no count to check after an add.
- **Emptying or deleting the playing playlist does not stop playback.** The current track keeps playing with no row behind it, so `player.playingLocation` is `null` while `path` still names it. Emptying is harmless when a play follows at once, which is how the scratch is refilled. Deleting is not: at the end of the track the player falls back to another playlist and carries on.
- **`GET /playlists/{id}/items/changes` throws for anything but a `409` or a `410`**, unlike `GET /library/changes`, which answers a typed failure instead of throwing. `playlistStore.ts`'s `recheckPlaylist` catches that throw and leaves the held rows where they are rather than reloading: a timeout or a dropped connection says nothing about whether the playlist actually moved, and the next revision the poll notices retries the diff at no extra request, where reloading now would cost one for no better answer.

## What Jean does about the queue

foobar2000's play queue is finite, ordered and exhaustive: the player takes all of it, in order, before returning to the playlist, and it outranks playback order, so with tracks queued a skip forward plays the head of the queue. A queued track leaves the queue the moment it starts, so the queue is only ever what is still to come. An entry holds a track rather than a position, so editing the playlist underneath it leaves the queue intact.

`GET /api/queue` answers every entry in the player's own order plus the revision they were read at. `domain/player/queue.ts`'s `recheckQueue` only asks for it when `GET /api/state`'s `queueRevision` has moved from the one already cached, off the same one-second poll that already carries player state, so a client watching the queue costs nothing beyond the poll it already runs.

Queueing, moving, removing and clearing each send exactly one request: `POST /queue`, `POST /queue/move`, `DELETE /queue/{index}` and `DELETE /queue`. Every one is optimistic against the cached read and reconciled by the next poll rather than trusted outright; a write against a queue that has since moved answers `409`, and Jean takes no local guess at the true order in that case; the next poll's `recheckQueue` holds it. **The revision advances by exactly one per accepted mutation**, so a caller chaining several writes against one cached read can predict the next revision without a re-read between them.

**A write that comes back failed rather than stale answers nothing about the player's own queue.** The response can go missing after the write already landed, LAN link or not, so a client cannot read a refusal as proof the queue is still where it was. `useQueue.ts`'s `settle` only rolls an optimistic patch back while the cache still holds the revision it was taken against; once that has moved, a poll has already caught up and rolling back would undo it.

**A queued entry plays whether or not it still carries a `location`.** `location` is `null` both for a library track queued by handle and for a playlist row whose position the player has lost, and against a real player both reach the head and play, `title`, `artist` and `duration` intact. Every entry the route answers is a real one, with nothing to warn a person about.

## What Jean does about the stream

The component's stream clock is what a listener hears, and the player's reported position runs ahead of it; the spec carries the arithmetic that turns one into the other, and `src/domain/player/CLAUDE.md` is what Jean builds on it.

> **The ticket is the one credential `foo_jean` asks for, because an `<audio>` element sends no header at all.** Every other route needs none, but `GET /stream?ticket=…&format=…` would otherwise be a plain address any page could open. Minting one is a `POST` with a JSON body, refused cross-origin by the same CORS rule as every other route, so only a page the component served can ever get one. A ticket is a capability URL bounded by a short lifetime and grants nothing but the audio already playing. Clients MUST NOT store, log, or otherwise place a ticket where a credential would not go.

- `deviceId` is untrusted: it labels a row in somebody else's picker and nothing branches on it. Generate it at random, keep it, and never derive it from anything about the person.

## What Jean does about artwork

`libraryArtworkUrl()`, `playingArtworkUrl()` and `playlistRowArtworkUrl()` in `fooJean.ts` build the three client-side addresses; `GET /artwork`, `GET /artwork/playing` and the positional route in the contract are what they name, and the contract's *Artwork* section is the reference for what each one answers. Every in-library cover is addressed by its album's canonical track rather than by the row's own path: `canonicalTrackRefs` and `albumCanonicalIndex` in `domain/track/grouping.ts` pick that track once from the library index, and `canonicalArtworkUrl()` / `canonicalPlayingArtworkUrl()` in `domain/track/librarySource.ts` turn a raw path, or the playing track's album and album artist, into the shared address.

The status bar, the now-playing screen and the cover wheel resolve the playing track's album this way, off `PlayerState.activeItem` on the same poll title and artist already ride, and fall back to `playingArtworkUrl()` for a track the library holds no album for. A playlist row, a queue entry or a wheel neighbour with a library path reads the same canonical address; one with no library path but a known playlist position reads `playlistRowArtworkUrl()` instead, and one with neither draws no cover. The media session takes neither address directly: the OS fetches whatever it is given itself, out of process from the page, so it is handed a `data:` URL built from the cover Jean already fetched. `src/app/CLAUDE.md`'s *The media session* has that half.
