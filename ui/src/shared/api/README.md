# API reference

What `foo_jean` answers, as Jean uses it, and the foobar2000 behaviour behind it that Jean relies on. `foo_jean` is a foobar2000 component listening on a port of its own, typically 8881, and it serves Jean itself from that origin. Its source is `plugins/fb2k/`. Everything Jean asks of the player arrives through it: playback, the player's own state, the playlist list and every edit to it, the queue, the library and its covers, writing tags, creating autoplaylists, and streaming the player's output.

**`contract/openapi.yaml` is that component's contract, and it is the reference for every route below.** Jean's types are generated from it and its descriptions carry the reasoning a client needs. `plugins/fb2k/ARCHITECTURE.md` is the design behind it, including the facts about foobar2000 the component relies on. What follows is what Jean does about an answer.

## Reaching it

| | |
|---|---|
| Base URL | `http://<player-host>:8881`, the origin Jean is served from |
| CORS | same-origin from Jean, so nothing it sends to the player crosses one. `allowedOrigins` in the component's `config.json` is what a differently-hosted interface would need |
| SPA fallback | none. A path that names no file is a `404`, and a directory answers its own `index.html`, so a client-side route has to live in the hash |
| Owner's config | `<profile>/foo_jean/config.json`, which Jean never edits and has no route to. `plugins/fb2k/README.md` has the keys |

**`POST /api/tags`, `POST /api/autoplaylists/preview`, `GET /api/track/library` and `GET /api/track/playing` each have a rate limit of their own, and a request past it is refused `429` with `Retry-After`**, having written or run nothing. `contract/openapi.yaml` has the budgets. Jean retries all four through `retryWhenTooFast` in `client.ts`.

## Discovery

`ui/ARCHITECTURE.md`, *The `foo_jean` security model*, is how `discoverFooJean()` in `discovery.ts` reaches `GET /api/capabilities` and the states that call resolves to.

An unreachable component might yet turn up, and `shared/hooks/useFooJean.ts` widens the interval between attempts while it stays that way, so a player started after the page still turns up without a reload. The widening happens inside the query function, since react-query may consult `refetchInterval` more than once per cycle.

## Types

`fooJeanSchema.d.ts` is generated from `contract/openapi.yaml` by `pnpm types:api` and committed; `contract/README.md` is how it is kept current. `types.ts` is hand-written: the shapes the rest of the app reads the player through once an answer has been mapped. The fake player is checked against both.

## Columns and title formatting

Every `columns` parameter takes **foobar2000 title-formatting expressions**, evaluated by the player and answered as a positional array in the order requested. The player computes, so the reachable surface is far wider than any fixed schema: any component publishing fields or functions to the title-formatting engine becomes readable this way, and installing a playback-statistics component makes its fields start answering values instead of `?`.

`ui/ARCHITECTURE.md`, *Capability detection*, is how Jean declares a column set so the positions cannot drift.

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
| `%publisher%` `%composer%` | tags | |
| `$if2($meta_sep(genre,$char(31)),%genre%)` | tags | a genre per value, separated by U+001F; `multiValue.ts` has why |
| `%length_seconds%` `%codec%` `%codec_profile%` `%bitrate%` `%samplerate%` `%channels%` | core | |
| `%filesize_natural%` `%filename_ext%` `%path%` `%subsong%` | core | `%path%` is absolute and platform-separated |
| `$if2($meta(rating),%rating%)` | tags, then `foo_playcount` | `foo_playcount` takes `%rating%` over, answering `''` where its database has no rating even if the file has a tag, in the library export and the playing-track route but not in playlist rows, so the tag is read first. `rating.ts` |
| `%replaygain_track_gain%` `%replaygain_album_gain%` `%bpm%` | tags | |
| `%lastfm_play_count%` `%lastfm_last_played%` `%lastfm_first_played%` | `foo_enhanced_playcount` | counts scrobbles across every device. `0` and `N/A` when unplayed, not `?` |
| `%play_count%` `%last_played%` `%first_played%` | `foo_playcount` | counts plays on this machine. Every play is also scrobbled, so this is ahead of the last.fm pair only while last.fm is behind or cannot match the track. Where both answer, Jean shows the higher count, the later last play and the earlier first play, never a sum; `0`, `N/A`, `''` and `?` are no answer. `fields.ts` |
| `%added%` | `foo_playcount` | when the track entered the media library, in the same `YYYY-MM-DD HH:MM:SS` form as the play dates |
| `$meta_sep(artists,$char(31))` `$meta_sep(albumartists,$char(31))` | tags, as MusicBrainz Picard writes them | one artist per value. Empty, not `?`, where the tag is missing |
| `$meta_sep(musicbrainz_artistid,$char(31))` `$meta_sep(musicbrainz_albumartistid,$char(31))` | tags, as MusicBrainz Picard writes them | one id per credited artist, in credit order, so the count says how many artists a credit like `A & B` names. `domain/artist/credits.ts` |
| `$if2($meta(unsynced lyrics),$if2($meta(lyrics),$if2($meta(syncedlyrics),$meta(unsyncedlyrics))))` | tags | the first present of `UNSYNCED LYRICS`, `LYRICS`, `SYNCEDLYRICS` and `UNSYNCEDLYRICS`, the order `foo_openlyrics` reads them in. **The tag name has a space.** `%lyrics%` answers `?`, and a write goes to `UNSYNCED LYRICS` alone |

Which of these resolve varies by install, by component and by how the library was tagged. Detect; never assume.

> **There is no play history, only a last play.** A play count is a lifetime total and a last-played is the most recent play and nothing else, so a track played today and again weeks ago reports only today. Any per-day or per-week chart built on it undercounts every older bucket and slopes upward whatever the listening did. A window can honestly report how many *distinct tracks* were touched since a date, and must say so in those words.

> **`%added%` starts on the day `foo_playcount` is installed.** Its first run stamps every track already in the library with that moment, so on a new install most of the library carries times seconds apart and only tracks added afterwards carry a real one. `foo_enhanced_playcount`'s `%added_enhanced%` resolves and answers `<invalid timestamp>` for every track, and its `%lastfm_added%` is the first scrobble. `%last_modified%` is not a substitute either: playback can rewrite tags, which bumps the file's mtime, so it is `max(added, last played or retagged)`, wrong precisely at the recent end, where a "recently added" view would look.

> **Lyrics need no component.** The four tags above return whatever is in them, which is LRC-timestamped only some of the time and is plain text more often than not. Real content includes several timestamps on one line, credit lines, and tags holding nothing but a URL. LRC in real files also carries `\r\n` or a lone `\r` between lines, fractions of one to three digits, and an `[offset:…]` in milliseconds to subtract. The field is large enough that it is fetched per track through `GET /api/track/playing` and **MUST never go in the library export's columns**, which carry every track. `foo_openlyrics` is what *writes* the tag.

## Paths

> **The player and the library disagree about what a path is.** The playing track's `path` in `GET /api/state` is the absolute, platform-separated form foobar2000 evaluates `%path%` to; a library path is relative to the media library folders and `/`-separated on every platform, Windows included. `player.libraryPath` carries the relative form where the media library holds the playing track. Nothing tells a client where the library folders are, so where only the absolute form is at hand the two are matched **by suffix** after normalising separators: `libraryPathMatcher()` in `src/shared/api/playerState.ts`.

## What Jean does about state

`GET /api/state` is the one route `domain/player/playerPoll.ts` asks, on a one-second interval with `If-None-Match`. Its sections ride together: `library` carries the two generations covered next, in *What Jean does about the library*, `player` carries what the player, or the session the poll names, is doing right now, and `mainThread` says whether foobar2000's main thread is still answering, since `player` goes on describing the last thing the player said while it is not. `contract/openapi.yaml`'s `State`, `Library`, `PlayerState` and `MainThread` schemas are the reference; this is only the part that catches an unwary client.

- **The route answers `Cache-Control: private, no-cache`, and its `ETag` does not cover every field that moves tick to tick.** Left alone, a browser revalidates an untagged read on its own and hands back the last cached `200` body on a `304`, however stale. `fetchState()` in `state.ts` sends every read with `cache: "no-store"` so nothing but Jean's own `If-None-Match` ever decides whether a read is fresh.
- **`player.position` is a mark, not a moving number.** It carries `seconds`, the position at the moment the component last looked, and `ageSeconds`, how long ago that was. A client adds the two to place the mark and then keeps counting on its own while `player.playback` is `playing`, which `src/domain/player/position.ts` does.
- **`player` carries no `info` block.** The player's name and version do not change while it runs, so the poll does not repeat them; they come off a startup read of `GET /api/capabilities` instead, alongside the volume range (`volumeMin`, `volumeMax`, `volumeUnit`), the four permissions (`canControlPlayback`, `canWritePlaylists`, `canChangeOutput`, `canStream`) and the list of playback modes this install can be put into.
- **`player.playbackMode` crosses the wire as Jean's own name**, one of `inOrder`, `repeatAll`, `repeatOne`, `random`, `shuffleTracks`, `shuffleAlbums` or `shuffleFolders`, mapped from whatever the player calls its own orders. `null` means the player is in an order this component has no name for, never a wrong one.
- **A manual skip leaves no empty track between two.** foobar2000 stops the outgoing track before it opens the next one, and reports that stop as one that is starting another. `foo_jean` ignores a stop of that kind, so `player` goes on naming the outgoing track, title, path and artwork, until the next one replaces it. A client that saw nothing playing across a skip would flash an empty cover and `0:00` on every manual change, and only on manual ones.

## What Jean does about playback

`shared/api/playback.ts` sends every transport, seek, mode and volume command to `foo_jean`: `POST /api/playback/play-pause`, `/pause`, `/resume`, `/next`, `/previous`, `/stop`, `/seek` and `/mode`, plus `POST /api/volume`. `contract/openapi.yaml` is the reference for each body, its statuses and the "exactly one of" rule the seek and volume routes read off which fields are present rather than off what they hold.

- **A mode travels by name, never by ordinal.** `POST /api/playback/mode` takes one of the seven `PlaybackMode` names off `GET /api/capabilities`'s `playbackModes`; a name this install does not offer answers `409` rather than being guessed at. The player's own ordinal means whatever this install's enum says it means, and its order and wording both vary.
- **On the player, playback order applies to the active playlist, and playing a row sets it.** Shuffle draws only from the playlist the playing row belongs to, and foobar2000 has no selection to shuffle within, so confining playback to a set of tracks means getting those tracks into a playlist. That is what the scratch playlist is for. A detached session takes the set itself through `POST /api/playback/play` and plays it without a playlist, and the component refuses that route for the player.
- **`playback.ts` also holds `takeSkipAsked`**, the record of which way a skip was asked for. foobar2000 never says which direction a track change moved, and the cover wheel needs the direction before the player has answered anything.
- **A skip's `POST` answers as soon as the command is queued onto foobar2000's main thread, not once the track there has actually changed.** A read sent the instant it resolves still names the old one, which is why `useTransport.ts`'s `useSkip` waits before polling.
- **At a playlist's end foobar2000 takes a skip and reports nothing.** No track change follows it, so the cover wheel times out a turn nothing answers.

## What Jean does about outputs

`GET /api/outputs` answers the devices the player currently lists and which one is active; `POST /api/outputs/active`, taking `{ deviceId }`, switches to one of them. `setActiveOutput` in `playback.ts` sends the write and `fetchOutputs` in `outputs.ts` sends the read; `contract/openapi.yaml` is the reference for both, including the statuses a client has to plan for.

- **A `deviceId` is opaque.** It is the output module's GUID and the device's GUID as the player prints and joins them, and nothing in Jean parses, splits or builds one: it is only ever read off `GET /api/outputs` and sent back exactly as read.
- **Which device is playing rides `GET /api/state`; the list of devices does not.** `outputDeviceId` can move under the client's feet whenever a picker might be open, and it is one string, so the poll carries it on every tick. The list is a set nobody is looking at most of the time, so it is read on demand rather than watched: once at discovery, whenever a picker opens, when the tab becomes visible again, and when `canChangeOutput` turns true.

## What Jean does about the library

`GET /api/library/export?columns=…` answers the whole library in one binary body. `jlib.ts` decodes it and `fooJeanLibrary.ts` is the loop that asks for it. `contract/openapi.yaml`, *The media library*, is the format, the two generations and every status. On this side:

- **Jean sends `TRACK_EXPRESSIONS`, one `columns` parameter per expression, never comma-separated**: a title-formatting expression may contain a comma.
- **`GET /api/library/changes` takes the pair Jean holds, `since` and `structure`.** A `splice` is edited into the arrays in place, and a `410` is an export again whatever moved.
- **`only` and `spine=false` on the export narrow the body without changing the declaration.** The header describes every declared column either way and `carried` lists the ones whose ids arrived, so a column not in it is not loaded rather than unresolved.
- **A delta or a splice may name a column the tab has not loaded, and Jean ignores it.** The late part is brought to the revision held before it joins, so nothing the ignored entry said is lost.
- **`snapshotId` is compared for equality only**, read with `trackCount`. It tells a stored copy from a stale one.
- **`?`, `''` and `N/A` arrive exactly as the player produced them.** Nothing in the component parses, normalises or types a value, which is what keeps Jean's capability detection working. **Never coerce one to `null`**: `Number(null)` is `0` and every field would then read as available.
- **The header answers capability detection exactly**, so a field that resolves on one track in ten thousand is detected rather than missed by a sample. Detection is still a guess a Settings switch overrules.
- **An export a tab held from before the component restarted stands for a snapshot that is no longer there.** `library.ready` is false from the moment `foo_jean` starts until it has built its first snapshot, and every library address is a `404` in that window. The generation held when a read came back unbuilt is what tells a stale export from a live one, and any generation since that mark outranks it. `playerPoll.ts` takes the mark and `librarySource.ts`'s `libraryAddressesResolve` reads it before a library address is sent.
- **A `{structure, revision}` pair compares for equality only, never for order.** A pair read after a restart can be lower than one already held without being older, and a pair stored before the restart is answered `409`. `libraryLoader.ts`'s `recheckMissed` holds the pair a poll answered while an entry was busy and, once idle, checks it against the one the entry landed on. A mismatch is worth a fresh, untagged `GET /api/state`: the route is `ETag`ged, so once the player settles every later poll answers `304`, and a generation seen mid-export would otherwise never surface again. A failed read keeps the pair, and the next tick the player answers asks again.
- **Progress rides `library.build`.** `fetchLibrary` hands each poll's `build` to `onProgress` only when it has changed, so a view learns of a further phase or slice without waiting for the whole build to finish.
- **`GET /api/library/summary` is asked once per pair of the library Jean holds, and the document it keeps is read only at the `structure` it carries.** The roles are the declared expressions, built in `useLibrarySummary.ts` from `TRACK_EXPRESSIONS`. A `202` waits for the poll to report the library ready, a `409` for the next export to declare again, a `429` for its `Retry-After`, a `400` for the pair to move, and anything else for an answered tick after 5 s doubling to 60 s, as the late part does. The previous document stays in view meanwhile; `atStructure` gives no rows at a `structure` the document was not computed at. `librarySummary.ts` is the request.
- **`GET /api/library/album`, `/artist`, `/genre` and `/search` answer the tracks one album, artist or genre holds, or a query matches, and an answer is read only at the `structure` it carries.** A `202` is a success to the typed client and carries the library document, not an answer. A `409` waits for the next export to declare again, a `429` for its `Retry-After`, and a `400` for the `structure` to move; the holds are the summary's, in `libraryHolds.ts`. The artist's three sets share no ordinal, and the page merges them into one. `libraryQuestions.ts` is the request and `libraryAsker.ts` the asker.
- **`library.halted` answers `halted` at once**, on the poll or on the export's `202`, since a component that stopped reading its library builds nothing more however long a client waits. A library already held stays usable.
- **A stalled build is what answers `timeout`, not a slow one.** `fetchLibrary` waits 60 s with no change to `build` before it gives up; a build that goes on moving is waited out however long it takes.
- **A transient failure is retried on the poll, not off it.** The store asks again only on a `GET /api/state` tick that answers, once the wait since the failure has passed, 5 s doubling to 60 s and reset by a read that succeeds, so a player that is not answering yields no answered ticks and costs no extra requests; a `refused`, `too-large`, `unavailable` or `halted` failure is never retried at all.

**A playlist's own `structure` and `revision` are a different pair from this one, and they travel as strings of decimal digits rather than numbers.** `contract/openapi.yaml`'s `PlaylistAnnotation.structure` has why; `playlistEntries.ts` keeps a playlist's feed and the library's feed as two shapes because of it. `recheckMissedPlaylist` replays a missed playlist generation directly against `recheckPlaylist`, since it came from `GET /api/playlists`, a plain read that never answers `304`.

## What Jean does about playlists

`GET /api/playlists` is the list, and every route here names a playlist by the foobar2000 GUID an entry carries. `usePlaylists.ts`'s `followPlaylists` reads it. The rows come from `GET /api/playlists/{id}/items` and its `changes` companion, through `usePlaylistItems.ts` into `playlistLoader.ts`; the writes live in `usePlaylistActions.ts`, `librarySource.ts` and `useAddTracks.ts`. `contract/openapi.yaml`'s playlist paths are the reference for every route, including which of them `writePlaylists` refuses. On this side:

- **`itemCount` is the count as of the read that carried it.** foobar2000's own window, another client and an autoplaylist refilling itself can all edit a playlist after that read, and the list is only re-read when a poll notices. Arithmetic on it that cannot survive being wrong, such as how many rows to remove or whether a cached view still matches, MUST re-read it first; trusting it removes the wrong rows and plays whatever drifted into the row that was clicked.
- **An autoplaylist refuses an added row with `409`.** foobar2000 locks a playlist per edit and the component reports the refusal, so a client has no count to check after an add. A `200` with an empty `positions` is only ever an add sent with `duplicates: skip` whose every track the target held, and `skipped` names them.
- **`duplicates: skip` compares file and subsong, never tags.** `contract/openapi.yaml`'s `Duplicates` says why. `useAddTracks.ts` sends every add with `skip` first and sends what came back in `skipped` again, without it, once somebody has said to.
- **Emptying or deleting the playing playlist does not stop playback.** The current track keeps playing with no row behind it, so `player.playingLocation` is `null` while `path` still names it. Emptying is harmless when a play follows at once, which is how the scratch is refilled. Deleting is not: at the end of the track the player falls back to another playlist and carries on.
- **A `GET /playlists/{id}/items/changes` that fails for anything but a `409` or a `410` leaves the held rows where they are rather than reloading.** `playlistLoader.ts`'s `recheckPlaylist` marks the read unread for the next tick to retry: a timeout or a dropped connection says nothing about whether the playlist actually moved, and the next revision the poll notices retries the diff at no extra request, where reloading now would cost one for no better answer.
- **A move and a sort both answer the playlist's new `structure`, and a sort adds `order`.** `order[n]` is the old position of the row now at `n`. That is how Jean re-keys the rows it holds instead of reading the playlist again: `carryPlaylist` in `playlistLoader.ts`. The carried feed holds a revision from before the structure moved, which the component does not compare with the new structure's, so the first `GET /playlists/{id}/items/changes` after a carry answers `410` and `recheckPlaylist` adopts the poll's revision rather than reloading.
- **`POST /autoplaylists/preview` with `rows: true` names the matching tracks as library ordinals**, counted in the `structure` it answers. A client compares that with the `structure` of the library snapshot it holds and asks again once it has caught up. A track the component's snapshot does not hold is left out, so `ordinals` can be shorter than `matches`.
- **A `SORT BY` at the end of an autoplaylist's query is applied by foobar2000 exactly as `sort` with `forceSort` would be.** `SORT DESCENDING BY` reverses it. `managed` records the clause as part of `query` and leaves `sort` empty.
- **The update and delete routes take any autoplaylist, whoever made it, and refuse a plain playlist.** Only an autoplaylist this component made has a `managed` record. For any other `managed` is `null` and the query cannot be read from the player, so a client editing one has no text to start from. For one this component made, `managed.query` is what it last wrote.

## What Jean does about the queue

The play queue outranks Jean's own *Playback follows cursor*: a track that came off the queue is left playing, whatever row the cursor is on. A queued track leaves the queue the moment it starts, so the queue is only ever what is still to come. `plugins/fb2k/ARCHITECTURE.md`, *Facts about the player*, has how foobar2000 orders it.

`GET /api/queue` answers every entry in the player's own order, or a named session's, plus the revision they were read at. `domain/player/queue.ts` reads it through `followRevision`, only when `GET /api/state`'s `queueRevision` has moved from the one already held, off the same one-second poll that already carries player state, so a client watching the queue costs nothing beyond the poll it already runs.

Queueing, moving, removing and clearing each send exactly one request: `POST /queue`, `POST /queue/move`, `DELETE /queue/{index}` and `DELETE /queue`. Every one is optimistic against the cached read and reconciled by the next poll; a write against a queue that has since moved answers `409`, and Jean takes no local guess at the true order in that case. **The revision advances by exactly one per accepted mutation**, so a caller chaining several writes against one cached read can predict the next revision without a re-read between them.

**A write that comes back failed rather than stale answers nothing about the player's own queue.** The response can go missing after the write already landed, LAN link or not, so a client cannot read a refusal as proof the queue is still where it was. `useQueue.ts`'s `settle` only rolls an optimistic patch back while the cache still holds the revision it was taken against; once that has moved, a poll has already caught up and rolling back would undo it.

**A queued entry plays whether or not it still carries a `location`.** `location` is `null` both for a library track queued by handle and for a playlist row whose position the player has lost, and against a real player both reach the head and play, `title`, `artist` and `duration` intact. Every entry the route answers is a real one, with nothing to warn a person about.

## What Jean does about the stream

The component's stream clock is what a listener hears, and the player's reported position runs ahead of it; the spec carries the arithmetic that turns one into the other, and `ui/ARCHITECTURE.md`, *Listening on this device*, is what Jean builds on it.

`foo_jean` lays a timeline mark shortly after the change it marks, so a client reads `GET /stream/timeline` again a moment after a track change or a seek rather than at once.

> **The ticket is the one credential `foo_jean` asks for, because an `<audio>` element sends no header at all.** the `stream` tag in `contract/openapi.yaml` has what a ticket grants and its lifetime. Clients MUST NOT store, log, or otherwise place a ticket where a credential would not go.

- `deviceId` labels a row in somebody else's picker, and the contract calls a private session a courtesy rather than a boundary. Generate it at random, keep it, and never derive it from anything about the person.
- `foo_jean` silences the player while anybody listens to the player's own session, counting the whole audience, and a device listening to a detached session never does. A client sends no mute of its own, and reads `outputSilent` beside `muted` and the volume to tell that hold from a mute by hand.
- A reconnect and a departure both close the socket, so a device that stops listening or leaves a session says so with `POST /stream/leave`.

## What Jean does about artwork

`libraryArtworkUrl()`, `playingArtworkUrl()` and `playlistRowArtworkUrl()` in `artwork.ts` build the three client-side addresses; `GET /artwork`, `GET /artwork/playing` and the positional route in the contract are what they name, and the contract's *Artwork* section is the reference for what each one answers. Every in-library cover is addressed by its album's canonical track rather than by the row's own path: `canonicalTrackRefs` and `albumCanonicalIndex` in `domain/track/grouping.ts` pick that track once from the library index, and `canonicalArtworkUrl()` / `canonicalPlayingArtworkUrl()` in `domain/track/librarySource.ts` turn a raw path, or the playing track's album and album artist, into the shared address.

The status bar, the now-playing screen and the cover wheel resolve the playing track's album this way, off `PlayerState.activeItem` on the same poll title and artist already ride, and fall back to `playingArtworkUrl()` for a track the library holds no album for. A playlist row, a queue entry or a wheel neighbour with a library path reads the same canonical address; one with no library path but a known playlist position reads `playlistRowArtworkUrl()` instead, and one with neither draws no cover. The media session takes neither address directly: the OS fetches whatever it is given itself, out of process from the page, so it is handed a `data:` URL that `shrinkForLockScreen()` builds from the cover Jean already fetched.
