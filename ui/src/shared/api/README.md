# API reference

What `foo_jean` answers, as Jean uses it, and the foobar2000 behaviour behind it that Jean relies on. `foo_jean` is a foobar2000 component listening on a port of its own, typically 8881, and it serves Jean itself from that origin. Its source is `plugins/fb2k/`. Everything Jean asks of the player arrives through it: playback, the player's own state, the playlist list and every edit to it, the queue, the library and its covers, writing tags, creating autoplaylists, and streaming the player's output.

**`contract/openapi.yaml` is that component's contract, and it is the reference for every route below.** Jean's types are generated from it and its descriptions carry the reasoning a client needs. `plugins/fb2k/ARCHITECTURE.md` is the design behind it, including the facts about foobar2000 the component relies on. What follows is what a client could not infer from the contract alone.

## Reaching it

|                |                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL       | `http://<player-host>:8881`, the origin Jean is served from                                                                                                               |
| CORS           | same-origin from Jean, so nothing it sends to the player crosses one. `allowedOrigins` in the component's `config.json` is what a differently-hosted interface would need |
| SPA fallback   | none. A path that names no file is a `404`, and a directory answers its own `index.html`, so a client-side route has to live in the hash                                  |
| Owner's config | `<profile>/foo_jean/config.json`, which Jean never edits and has no route to. `plugins/fb2k/README.md` has the keys                                                       |

`POST /api/tags`, `POST /api/autoplaylists/preview`, `GET /api/track/library` and `GET /api/track/playing` each have a rate limit of their own. A request past it is refused `429` with `Retry-After`, having written or run nothing. `contract/openapi.yaml` has the budgets. Jean retries all four through `retryWhenTooFast` in `client.ts`.

## Discovery

`ui/ARCHITECTURE.md`, _The `foo_jean` security model_, is how `discoverFooJean()` in `discovery.ts` reaches `GET /api/capabilities` and the states that call resolves to.

An unreachable component might yet turn up, and `shared/hooks/useFooJean.ts` widens the interval between attempts while it stays that way, so a player started after the page still turns up without a reload. The widening happens inside the query function, since react-query may consult `refetchInterval` more than once per cycle.

## Types

`fooJeanSchema.d.ts` is generated from `contract/openapi.yaml` by `pnpm types:api` and committed; `contract/README.md` is how it is kept current. `types.ts` is hand-written: the shapes the rest of the app reads the player through once an answer has been mapped. The fake player is checked against both.

## Columns and title formatting

Every `columns` parameter takes **foobar2000 title-formatting expressions**, evaluated by the player and answered as a positional array in the order requested. The player computes, so the reachable surface is far wider than any fixed schema: any component publishing fields or functions to the title-formatting engine becomes readable this way, and installing a playback-statistics component makes its fields start answering values instead of `?`.

`ui/ARCHITECTURE.md`, _Capability detection_, is how Jean declares a column set so the positions cannot drift.

### Capability detection

A field that does not exist answers `?`. A field that exists but is empty answers `''`, `0` or `N/A`. That difference is the whole of the capability probe: ask for a column set and enable whatever resolves. The probe reads the raw text, and `Number(null)` is `0`, so a value turned into `null` before the probe sees it reads as available.

- `$meta(x)` cannot be feature-detected. It answers `''` for a field that does not exist, where `%x%` answers `?`. Probe with `%x%`.
- Sparse fields defeat sampling. A field only some tracks carry can be missed by a fixed sample. Detect per track where a field is sparse, as the Details panel does.
- Which fields resolve is a fact about the install, not about a set of rows. A playlist of untagged rips answers `?` for `%year%` while the library resolves it, so ask the library and let every view read that one answer. `src/domain/track/fieldAvailability.ts`.

### Expressions Jean uses

| Expression                                                                                         | Supplied by                             | Notes                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `%artist%` `%title%` `%album%` `%album artist%`                                                    | core                                    |                                                                                                                                                                                                                                                                                                                           |
| `%tracknumber%` `%discnumber%` `%totaltracks%` `%totaldiscs%`                                      | core                                    |                                                                                                                                                                                                                                                                                                                           |
| `%year%`                                                                                           | core                                    | clean and integer-shaped. Sort and group by this                                                                                                                                                                                                                                                                          |
| `%date%`                                                                                           | tags                                    | an ordinary messy user tag, **not a date-added field**: year-only, full ISO and untidy values all appear. Parse leniently                                                                                                                                                                                                 |
| `%publisher%` `%composer%`                                                                         | tags                                    |                                                                                                                                                                                                                                                                                                                           |
| `$if2($meta_sep(genre,$char(31)),%genre%)`                                                         | tags                                    | a genre per value, separated by U+001F; `multiValue.ts` has why                                                                                                                                                                                                                                                           |
| `%length_seconds%` `%codec%` `%codec_profile%` `%bitrate%` `%samplerate%` `%channels%`             | core                                    |                                                                                                                                                                                                                                                                                                                           |
| `%filesize_natural%` `%filename_ext%` `%path%` `%subsong%`                                         | core                                    | `%path%` is absolute and platform-separated                                                                                                                                                                                                                                                                               |
| `$if2($meta(rating),%rating%)`                                                                     | tags, then `foo_playcount`              | `foo_playcount` takes `%rating%` over, answering `''` where its database has no rating even if the file has a tag, in the library rows and the playing-track route but not in playlist rows, so the tag is read first. `rating.ts`                                                                                        |
| `%replaygain_track_gain%` `%replaygain_album_gain%` `%bpm%`                                        | tags                                    |                                                                                                                                                                                                                                                                                                                           |
| `%lastfm_play_count%` `%lastfm_last_played%` `%lastfm_first_played%`                               | `foo_enhanced_playcount`                | counts scrobbles across every device. `0` and `N/A` when unplayed, not `?`                                                                                                                                                                                                                                                |
| `%play_count%` `%last_played%` `%first_played%`                                                    | `foo_playcount`                         | counts plays on this machine. Every play is also scrobbled, so this is ahead of the last.fm pair only while last.fm is behind or cannot match the track. Where both answer, Jean shows the higher count, the later last play and the earlier first play, never a sum; `0`, `N/A`, `''` and `?` are no answer. `fields.ts` |
| `%added%`                                                                                          | `foo_playcount`                         | when the track entered the media library, in the same `YYYY-MM-DD HH:MM:SS` form as the play dates                                                                                                                                                                                                                        |
| `$meta_sep(artists,$char(31))` `$meta_sep(albumartists,$char(31))`                                 | tags, as MusicBrainz Picard writes them | one artist per value. Empty, not `?`, where the tag is missing                                                                                                                                                                                                                                                            |
| `$if2(%artistsort%,%artistsortorder%)`                                                             | tags, as MusicBrainz Picard writes them | the artist's sort name, read by search alone. A FLAC or an MP4 carries it as `ARTISTSORT`, and foobar2000 maps ID3v2's `TSOP` frame to `ARTISTSORTORDER`, so one expression reads both                                                                                                                                    |
| `$meta_sep(musicbrainz_artistid,$char(31))` `$meta_sep(musicbrainz_albumartistid,$char(31))`       | tags, as MusicBrainz Picard writes them | one id per credited artist, in credit order, so the count says how many artists a credit like `A & B` names. `domain/artist/credits.ts`                                                                                                                                                                                   |
| `$if2($meta(unsynced lyrics),$if2($meta(lyrics),$if2($meta(syncedlyrics),$meta(unsyncedlyrics))))` | tags                                    | the first present of `UNSYNCED LYRICS`, `LYRICS`, `SYNCEDLYRICS` and `UNSYNCEDLYRICS`, the order `foo_openlyrics` reads them in. **The tag name has a space.** `%lyrics%` answers `?`, and a write goes to `UNSYNCED LYRICS` alone                                                                                        |

Which of these resolve varies by install, by component and by how the library was tagged. Detect; never assume.

A tag written as an array of values (`POST /api/tags` has the form) reads back through `%field%` as one string, the values joined with `, `, so a value that holds a comma cannot be told from two. Only `$meta_sep(field,$char(31))` gives them one by one.

> **There is no play history, only a last play.** A play count is a lifetime total and a last-played is the most recent play and nothing else, so a track played today and again weeks ago reports only today. Any per-day or per-week chart built on it undercounts every older bucket and slopes upward whatever the listening did. A window can honestly report how many _distinct tracks_ were touched since a date, and must say so in those words.

> `%added%` starts on the day `foo_playcount` is installed. Its first run stamps every track already in the library with that moment, so on a new install most of the library carries times seconds apart and only tracks added afterwards carry a real one. `foo_enhanced_playcount`'s `%added_enhanced%` resolves and answers `<invalid timestamp>` for every track, and its `%lastfm_added%` is the first scrobble. `%last_modified%` is not a substitute either: playback can rewrite tags, which bumps the file's mtime, so it is `max(added, last played or retagged)`, wrong precisely at the recent end, where a "recently added" view would look.

> Lyrics need no component. The four tags above return whatever is in them, which is LRC-timestamped only some of the time and is plain text more often than not. Real content includes several timestamps on one line, credit lines, and tags holding nothing but a URL. LRC in real files also carries `\r\n` or a lone `\r` between lines, fractions of one to three digits, and an `[offset:…]` in milliseconds to subtract. The field is large enough that it is fetched per track through `GET /api/track/playing` and **MUST never go in the rows declaration's columns**, which are read for every track. `foo_openlyrics` is what _writes_ the tag.

## The library

`contract/openapi.yaml`, _The media library_, defines the `{structure, revision}` pair and the rows, runs and question routes that carry it.

- A pair is compared for equality only, never for order. A pair read after the player restarts can be lower than the one before it without being older.
- A `409` from a rows or runs read means `structure` moved under the request. The windows read at the old `structure` are dropped and the column declaration is sent again before anything is drawn.

## Paths

> The player and the library disagree about what a path is. The playing track's `path` in `GET /api/state` is the absolute, platform-separated form foobar2000 evaluates `%path%` to; a library path is relative to the media library folders and `/`-separated on every platform, Windows included. `player.libraryPath` carries the relative form where the media library holds the playing track. Nothing tells a client where the library folders are, so where only the absolute form is at hand the two are matched **by suffix** after normalising separators: `libraryPathMatcher()` in `src/shared/api/playerState.ts`.

## The state document

`GET /api/state` carries three sections that ride together. `library` is the two generations `contract/openapi.yaml`, _The media library_, defines. `player` is what the player, or the session the poll names, is doing now. `mainThread` says whether foobar2000's main thread is still answering, and `player` goes on describing the last thing the player said while it is not. The `State`, `Library`, `PlayerState` and `MainThread` schemas are the reference; this is the part that catches an unwary client.

- The route's `ETag` does not cover every field that moves tick to tick. A browser left to itself revalidates an untagged read and hands back the last cached `200` body on a `304`, however stale, so every read goes out with `cache: "no-store"` (`fetchState()` in `state.ts`) and only Jean's own `If-None-Match` decides whether a read is fresh.
- `player.position` is a mark, not a moving number: `seconds` at the moment the component last looked, and `ageSeconds` since. A client adds the two and counts on from there while `player.playback` is `playing`.
- A manual skip leaves no empty track between two. foobar2000 stops the outgoing track before it opens the next and reports that stop as one that is starting another. `foo_jean` ignores a stop of that kind, so `player` goes on naming the outgoing track until the next replaces it. A client that read nothing playing across a skip would flash an empty cover and `0:00` on every manual change, and only on manual ones.

## Playback

`contract/openapi.yaml` has each command's body and statuses, and the "exactly one of" rule the seek and volume routes read off which fields are present rather than off what they hold.

- The player's own playback-order ordinal means whatever this install's enum says it means, and its order and wording both vary. That is why a mode travels by name, one of `GET /api/capabilities`'s `playbackModes`.
- On the player, playback order applies to the active playlist, and playing a row makes its playlist active. Shuffle draws only from that playlist, and foobar2000 has no selection to shuffle within. Confining playback to a set of tracks therefore means getting the set into a playlist, which is what the scratch playlist is for. A detached session takes the set itself through `POST /api/playback/play`, and the component refuses that route for the player.
- foobar2000 never says which direction a track change moved. The cover wheel needs the direction before the player has answered anything, so `takeSkipAsked` in `playback.ts` records which way a skip was asked for.
- A skip's `POST` answers as soon as the command is queued onto foobar2000's main thread, not once the track there has changed. A read sent the instant it resolves still names the old track, which is why `useSkip` in `useTransport.ts` waits before polling.
- At a playlist's end foobar2000 takes a skip and reports nothing. No track change follows, and the cover wheel times out a turn nothing answers.

## Playlists

`contract/openapi.yaml`'s playlist paths are the reference for every route, including which of them `writePlaylists` refuses.

- `itemCount` is the count as of the read that carried it. foobar2000's own window, another client and an autoplaylist refilling itself can all edit a playlist after that read, and the list is re-read only when a poll notices. Arithmetic on it that cannot survive being wrong, such as how many rows to remove or whether a cached view still matches, MUST re-read it first.
- An autoplaylist refuses an added row with `409`, since foobar2000 locks a playlist per edit, so a client has no count to check after an add.
- Emptying or deleting the playing playlist does not stop playback. The track keeps playing with no row behind it, so `player.playingLocation` is `null` while `path` still names it. Emptying is harmless when a play follows at once, which is how the scratch is refilled. Deleting is not: at the end of the track the player falls back to another playlist and carries on.
- A `SORT BY` clause at the end of an autoplaylist's query is applied by foobar2000 exactly as `sort` with `forceSort` would be, and `SORT DESCENDING BY` reverses it. `managed` records the clause as part of `query` and leaves `sort` empty.
- The player gives no way to read an autoplaylist's query back. Only one this component made carries a `managed` record, so a client editing any other has no text to start from.

## The queue

The play queue outranks _Playback follows cursor_: a track that came off the queue is left playing whatever row the cursor is on. A queued track leaves the queue the moment it starts, so the queue is only ever what is still to come. `plugins/fb2k/ARCHITECTURE.md`, _Facts about the player_, has how foobar2000 orders it.

`queueRevision` advances by exactly one per accepted mutation, so a caller chaining several writes against one cached read can predict the next revision without a re-read between them.

A queued entry plays whether or not its `location` is set. `location` is `null` for a track queued from outside any playlist, and the entry is no less playable for it.

## The stream

The component's stream clock is what a listener hears, and the player's reported position runs ahead of it. The `stream` tag in `contract/openapi.yaml` carries the arithmetic between the two, and `ui/ARCHITECTURE.md`, _Listening on this device_, is what Jean builds on it.

- The ticket is the one credential `foo_jean` asks for, since an `<audio>` element sends no header of its own. Clients MUST NOT store, log or otherwise place a ticket where a credential would not go.
- `deviceId` labels a row in somebody else's picker, and a private session is a courtesy rather than a boundary. Generate it at random, keep it, and never derive it from anything about the person.
- `foo_jean` silences the player while anybody listens to the player's own session, counting the whole audience, and never while a device listens to a detached session. A client sends no mute of its own. It reads `outputSilent` beside `muted` and the volume to tell that hold from a mute by hand.
- A reconnect and a departure both close the socket, so a device that stops listening or leaves a session says so with `POST /stream/leave`.
