# Architecture

For somebody about to build on this: how the pieces fit, which thread owns what, and why the boundaries sit where they do. [plugins/fb2k/README.md](README.md) is what the component is and how to run it, [plugins/fb2k/CONTRIBUTING.md](CONTRIBUTING.md) is how to write its code, and [src/README.md](src/README.md) is the source tree file by file.

foo_jean is a DLL foobar2000 loads, an HTTP listener on a port of its own, a snapshot of the media library, and one live encode of the player's output. It runs alongside beefweb rather than replacing it: beefweb owns playback, playlists, artwork and the filesystem, and a client talks to both.

## The shape of it

```mermaid
flowchart TB
  subgraph machine["The player's machine"]
    subgraph player["foobar2000"]
      main["main thread<br/>metadb_io_v2 · autoplaylist_manager · volume"]
      cap["playback_stream_capture_v2<br/>post-DSP, pre-volume"]
      main --- cap
    end
    bw["foo_beefweb :8880<br/>playback, playlists, clientconfig"]
    main --- bw

    subgraph fb2k["src/fb2k/ — knows the SDK"]
      queue["MainThreadQueue<br/>coalescing, over fb2k::inMainThread"]
      work["tag_writer · playlists · player_mute"]
      feed["LibraryFeed<br/>change callbacks, and a worker of its own"]
      str["Streamer"]
      prefs["preferences page<br/>Tools → Jean"]
      adv["advertise"]
    end

    subgraph core["src/core/ — knows nothing of foobar2000"]
      http["HttpServer :8881<br/>cpp-httplib, one thread per connection"]
      pure["settings · tag_write · playlists · pairing<br/>rate_limit · stream_ticket · api"]
      lib["Library<br/>one snapshot · two generations"]
      aud["Audience"]
      hold["OutputHold<br/>a thread of its own"]
    end
  end

  subgraph net["The network"]
    client["a client"]
    ears["listeners<br/>&lt;audio&gt; elements"]
  end

  cap -->|audio_chunk| str
  work -->|blocking calls| queue
  queue -->|marshalled work| main
  prefs --> queue
  adv -->|writes clientconfig/foo_jean.json| bw
  main -->|added · removed · modified| feed

  work -.->|Player callbacks| http
  str -.->|StreamOpener · formats · timeline| http
  feed -->|a built snapshot| lib
  http --> pure
  http --> lib
  http --> aud
  aud -->|anybody listening?| hold
  hold -->|mute · restore| queue

  client -->|REST, Bearer| http
  client -->|GET /api/clientconfig/foo_jean| bw
  ears -->|GET /api/stream?ticket=…| http
```

Dotted arrows are the inverted ones: `fb2k/` hands `core/` a set of callbacks, and `core/` never names a foobar2000 type.

## The one boundary

`src/core/` compiles with a C++17 compiler and nothing else: no SDK, no Windows, no player. `src/fb2k/` is everything that touches any of the three. Whatever `core/` needs from the player arrives as a callback or a plain value handed in from `fb2k/`, so the dependency points inward and the player is the detail.

**The build enforces it rather than a reviewer.** `src/foo_jean.vcxproj` compiles every `core/*.cpp` with `PrecompiledHeader=NotUsing`, and the precompiled header is the SDK, so a `core/` file that reaches for an SDK type stops compiling. It is a glob, so a new file inherits the rule without anybody remembering. The rule is not taste: cpp-httplib includes `<winsock2.h>`, the SDK includes `<windows.h>`, and the wrong order is a page of Winsock redefinition errors that name none of it.

What the seam buys is the reason to keep it sharp. The security-critical half, meaning the bearer check, CORS, the write allowlist, config parsing, ticket lifetime and the pairing rules, lives in `core/`, so a real `HttpServer` on a real port covers it in a second on any machine. `src/fb2k/` has no coverage at all off the build machine. Put the decision in `core/` and the mechanism in `fb2k/` and that ratio stays good; put a decision in `fb2k/` and it is tested by hand or not at all.

## The seams

Three, all the same shape: `core/` declares what it needs, `fb2k/` supplies it in the component, and `tests/` supplies something else.

| seam | declared in | supplied by | absent means |
|---|---|---|---|
| `Player`, a struct of `std::function`s, one per thing the player can be asked | `core/http_server.h` | `fb2k/component.cpp`, assembled field by field so two callbacks of the same signature cannot swap silently | that route answers `503` |
| `StreamOpener` and `StreamSession` | `core/stream.h` | `fb2k/streamer.cpp` | no streaming, and `canStream` is false |
| `logInfo` and `logError` | `core/log.h` | `fb2k/log.cpp`, or `tests/support/log_capture.cpp` | a link error |

Every `Player` callback blocks until foobar2000 has finished or given up, so each belongs on an HTTP worker and never on the main thread. `fb2k/ask_player.h` is how all of them get there. A null callback is not a fault. It is how an install that switched something off says so, and the route answers `503` rather than pretending. Two do not follow the pattern. `refreshLibrary` returns early: it hands a column set to the snapshot worker and comes straight back, because the client is answered `202` and polls. `readArtwork` never reaches the main thread at all: it resolves an address against the snapshot and then talks to foobar2000's album art loader and the filesystem on the connection thread, because a cover is file I/O and the main thread may not wait for one.

`HttpServer` takes a `Library*` as well, and that is not a fourth seam. `Library` lives in `core/`, carries its own mutex and is read from a connection thread directly, so wrapping it in callbacks would buy an abstraction with one implementation. Null is how an install with the library switched off says so, and every library route then answers `503` like any other absent capability.

## The audio path

```mermaid
flowchart LR
  subgraph mt["foobar2000's main thread — may never block"]
    ch["on_chunk<br/>an explicit requestInterval, never the default"]
    mk["on_playback_new_track · on_playback_seek<br/>StreamMark, held for the next block"]
  end

  pcm["PcmRing<br/>bounded in seconds · write never blocks · drops the oldest"]

  subgraph enc["one encoder thread, both formats"]
    conv["Converter<br/>resampler_manager_v3 chain<br/>any rate and layout → 48 kHz stereo float"]
    op["OpusStream<br/>20 ms frames → whole Ogg pages"]
    ac["AacEncoder<br/>Media Foundation AAC-LC → ADTS frames"]
    tl["Timeline<br/>stream seconds and the last few marks"]
  end

  ogg["BroadcastRing · ogg"]
  adts["BroadcastRing · adts"]

  subgraph conns["one thread per connection"]
    c1["Cursor<br/>absolute offset"]
    c2["Cursor"]
    s1["socket · TCP_NODELAY · chunked"]
    s2["socket"]
  end

  mk -.->|attached to| ch
  ch --> pcm
  pcm --> conv
  pcm --> tl
  conv --> op
  conv --> ac
  op -->|whole pages only| ogg
  ac -->|whole frames only| adts
  ogg --> c1 --> s1
  adts --> c2 --> s2
  tl -.->|GET /api/stream/timeline| s1
```

**Neither end ever stalls the player.** A block the main thread cannot hand off is discarded rather than queued, and a listener the writer laps is dropped rather than waited for. A cursor is an absolute byte offset, so how far behind a listener has fallen is a subtraction that no wraparound can confuse.

**The clock advances from each block's own duration**, not from what was encoded, so it keeps running while nobody is listening. Otherwise every track change during an idle spell would collapse onto one instant. A mark is taken on the main thread, travels attached to the next block of audio rather than being read separately, and is stamped by the encoder with the stream time of the audio it introduces, so the timeline describes what a listener hears rather than what the player is doing.

**A format nobody is listening to is never encoded**, so an idle player burns no core, and the two formats fail apart: one encoder giving up closes its own ring, which ends its listeners' responses so they can reconnect, while the other keeps playing rather than going silent for a fault it did not have.

**Ogg needs its header pages before any audio; ADTS is self-describing**, so a listener joins it at any frame. That is the whole difference between the two preambles. The Ogg stream is never restarted at a track change either, because Firefox stops at the first chained boundary. A decoder can only start reading Ogg from a page boundary, never mid-page, which is why encoded output is gathered into whole pages and handed to the ring in one write per block rather than as each page is produced. A listener's cursor starts wherever the ring currently ends, and that position must be one a fresh decoder can begin at.

**Delivery is 1x and a listener never catches up**, so latency added anywhere is paid for the whole session rather than absorbed. Two defaults charge for it, and both are overridden: libogg gathers a byte count before it emits a page, so pages are built to a duration derived from the bitrate instead (`core/opus_stream.h` has the floor and why it exists), and cpp-httplib leaves Nagle on, so `set_tcp_nodelay` is mandatory once a page is smaller than a segment.

**A connection ends when cpp-httplib drops its content provider, and not reliably before that.** `Audience::Membership`'s destructor is what a socket closing actually triggers, and `StreamSession::next` returning `false` or the writer lambda returning `false` is what makes that happen; nothing else in this component is told a listener is gone.

## Threads, and what may block

The thing least visible from any one file.

| thread | owned by | blocks on | must never |
|---|---|---|---|
| the main thread | foobar2000 | nothing | wait for anything this component does |
| one encoder thread | `Streamer` | `PcmRing::read` | let an exception escape, because it is a thread entry point |
| the snapshot worker | `LibraryFeed` | one main-thread hop for `library_manager::get_all_items`, then `metadb_v2::queryMultiParallel`, a slice at a time | hold the main thread for anything past that hop, or let an exception escape |
| the hold's watcher | `OutputHold` | `Audience::awaitChangeFrom` | run where the player's volume callback holds a lock |
| the listener | `HttpServer` | `accept` | outlive `stop()` |
| one per connection | cpp-httplib's pool, `max(8, cores - 1)` | `BroadcastRing::read`, a `Player` callback, or foobar2000's album art loader and the file under it | outlive `HttpServer::stop()` |

**The main thread reaches this component from five places**: the capture callback, the two playback callbacks that take a mark, the volume callback, the preferences page, and every batch `MainThreadQueue` dispatches. None of them may block. `PcmRing::write` drops its oldest block rather than wait, `MainThreadQueue` coalesces a burst of requests into one main-thread callback rather than one each, and `OutputHold::playerVolumeChanged` takes no lock at all: the mute the hold takes lands on the main thread and comes straight back as a volume callback, which against a held lock is a deadlock.

**Shutdown is `Plugin`'s field order read backwards, with one pair the destructor body governs.** Reverse declaration order would destroy the server before the streamer, and `~HttpServer` joins connection threads that only `Streamer::stop()` can unblock, so the body stops the streamer and then the server. The fields handle the rest: the volume watch dies before the hold it fires at, the hold before the audience it waits on, the audience before the streamer, and `MainThreadQueue` last, so nothing marshals work onto a queue being torn down.

All of that runs from `on_quit`, on the main thread. That is why `askPlayer` runs its work inline when it is already on the main thread: `fb2k::inMainThread` always defers, so queuing from there would wait out the whole timeout for a callback only this thread can dispatch, and the caller that does it is the hold, asking the player to unmute.

**A rebuild in flight makes a quit wait for it.** `~LibraryFeed` joins the snapshot worker, and it runs after the server that reads the snapshot and before the `Library` that holds it. `metadb_v2::queryMultiParallel` takes no abort callback, so the info query goes out in slices rather than as one call over the whole library, and a quit waits out a slice instead of the lot. The rest needs no such handling: sorting is in-memory work with nothing to abort partway, so it runs to completion inside whatever a quit already costs.

**The destructor's first act is `MainThreadQueue::close()`, and it is first for the mirror-image reason.** A request already on a connection thread has marshalled work onto a main thread that is now inside the destructor and will never dispatch it, and `HttpServer::stop()` at the end of the body waits for exactly those requests to finish. So `close()` refuses further work and runs each pending item's `abandon`, settling the answer the caller is blocked on, rather than leaving it to time out. Dropping the work alone would not do: the caller waits on the answer, not on the queue.

## Track identity, and two spellings of a path

Track identity is `%path%` plus `%subsong%`. Playlist items have no id, and any mutation invalidates indices, so every route addresses a track by path.

There are two spellings of that path and they are not interchangeable. `metadb_handle::get_path()` answers the canonical form, which on a portable install is `file-relative://..\Music\x.mp3` where beefweb answers an absolute path for the same file, so a client joining the two on equality would never match. **Everything published to a client goes through `filesystem::g_get_display_path`**, and `POST /api/tags` accepts the display form, so anything answering in the other dialect makes the API disagree with itself.

`metadb::handle_create` will build a handle for any path at all, so being on the write allowlist is not being a track the player manages. The check that the player already knows the track, through the Media Library or an open playlist since plenty of installs have no library configured, is what stands between an allowlisted field and a file foobar2000 has never seen.

## The media library

Paging a library needs a stable sorted order, and producing one needs a full pass over every track. So either a client holds the whole library or this component does, and it is held here: this is the machine where foobar2000 already keeps the database in memory, and where `library_callback_v2_dynamic` says when it changed. The client is a browser on a phone.

`core/library.h` owns the snapshot, the two generations, what a request may ask for, and the bytes that go on the wire. `fb2k/library.h` owns the walk of the player: the change callbacks, the info query and the title formatting. Nothing in `core/` knows how the rows got there.

**The client declares the columns, and the export request is the declaration.** `GET /api/library/export?columns=…` carries the title-formatting expressions a client wants, and the component evaluates exactly those and interprets none of them, which is what keeps it general and what keeps a client's own `?` detection working. Every later rebuild reuses the last declared set, so `LibraryRefresher` takes columns rather than nothing. At most two built sets are kept and a third evicts one, because varying the column set is the cheap way to ask for repeated full rebuilds. Title formatting reads tags and does arithmetic, with no file access and no way to write, so an expression is a compute cost and never an escape: bound the compute and there is nothing left.

Beside the declared columns the snapshot carries a spine it owns, because it needs that to do its own job: `directory` and `filename`, library-relative and forward-slashed, and `subsong`. foobar2000's library root never reaches a client. Directories repeat heavily, so splitting the path in two halves the largest column. **Ordinals are handed out in library-relative path order, and foobar2000 does the comparing.** `fb2k/library.cpp` builds one `fb2k::sortString_t` per track and hands `ordinalOrder` the comparison the player's own `sort_by_relative_path` uses, so a client's view is in the order a playlist the player filled and sorted is in, by construction rather than by luck. `core/` supplies the rest: the tie is broken by subsong and then by the player's own canonical path, because a client's refs are ordinals and an order that is not total shuffles them between rebuilds for nothing. A second comparison living in `core/` could only drift from the first, so there is not one.

### Staleness

Three mechanisms, in descending order of trust, and one promise none of them makes.

**The player says so.** `library_callback_v2_dynamic` delivers added, removed and modified on the main thread, and every tag write arrives as `on_items_modified_v2`: a rating, a lyric written during playback, an edit in foobar2000's own dialog, one this component made itself. `library_callback::is_modified_from_hook()` separates a real tag change from a display-hook refresh, which is how a play-count component announces itself. Both are taken. The distinction is worth a log line and nothing else, and nothing may filter on it. On the main thread the callback does the cheap half, mapping a handle to an ordinal and marking it dirty; the re-query and the formatting happen on the worker. A library import fires thousands of these, so dirty marks accumulate and a rebuild waits for a quiet period.

**Playback is always suspect.** The commonest change of all is a play count going up, and it is the one a component may keep to itself: `plugins/fb2k/CLAUDE.md`, *Facts about the player*, has what `foo_enhanced_playcount` does about that. So a track that stops being the active one is marked dirty whether or not anything said to. One row re-queried per track played buys the play count, the last-played date and a lyric written mid-play, out of a component that never notifies.

**A hand on the wheel.** `POST /api/library/refresh` rebuilds from scratch, rate limited.

**What none of it promises.** A component keeping its data in a private database, publishing it through a title-formatting hook and never touching the metadb, leaves a value stale until that track next plays or somebody refreshes. foobar2000's own playlist columns show the same stale value. `contract/openapi.yaml` says so on the route rather than implying a freshness this cannot deliver.

### Two generations

`structure` moves when tracks are added or removed. Ordinals shift, a client's arrays mean nothing, and it exports again. `revision` moves when a row changes in place. Ordinals hold, so a client asks for a delta and patches what it already has.

They are two because the two kinds of churn are nothing alike. A modification lands once per play, all day. An add or a remove is rare and is something the user just did, so paying for one with a re-download charges it at the moment somebody expects to wait.

**Dictionaries are append-only within a structure generation.** That is what makes a delta small: it carries the entries added since, plus the changed ids, and a client never rebuilds a dictionary it already holds. A value that falls out of use leaves a dead entry behind, and the next structure rebuild compacts it.

**A delta is per column, and it names the columns that moved.** A client keys its derived structures on the identity of a column's array, so one bumped `revision` meaning "something, somewhere" would rebuild the folded search text and the album, artist and genre indices on every track played. Nothing about a play changes a title.

**The retained window is spent by listening rather than by the clock.** A track that stops playing is marked dirty whether or not anything announced it, so `revision` moves about once per track played and stands still while nobody is listening. `kRevisionsPerListeningHour` and `kRetainedListeningHours` in `core/library.h` are the two figures `kRetainedRevisions` is the product of, and sizing it that way is what keeps a phone that slept through a night inside the window rather than re-exporting the whole library over the connection least able to carry it. What one retained revision costs is a changed-ordinal list per column, so the window is bounded in memory by the column count and not by the library size.

Both generations sit in `GET /api/library`, which is small, ETagged and polled. There is no event stream behind them, for the reason *Absences* gives for there being none anywhere here.

### Artwork

`GET /api/artwork` addresses a cover by a track's library-relative path rather than by an ordinal. An ordinal is only meaningful against a `structure`, so a URL built from one would have to carry the generation and would change whenever a track was added anywhere in the library; a relative path survives a rebuild, a restart and a change of column set. That is what lets a client point every row of a record at one URL and hand persistence, deduplication and revalidation to the browser's own cache, which is the whole reason the route exists.

**The address is a lookup key and it is never joined to anything.** `fb2k/library.cpp` keeps ordinal order and a map from relative path into it, replaced whole by a rebuild and read through a `shared_ptr` so a connection thread never reads what the worker is writing. A hit yields a `metadb_handle` the player itself produced, and everything downstream works from that. Traversal is not filtered, because there is nothing for a client string to escape from.

**The validator is a `stat` and not the picture.** `album_art_extractor_instance_v2::query_paths` names the file the cover actually came from, and the `ETag` is a fold over each of those paths with its size and modification time. So a `304` costs the resolution and one stat, with no read and no decode, and it is also the only thing that catches a folder image replaced in place, for the reason `plugins/fb2k/CLAUDE.md`, *Facts about the player*, gives. A source naming no file, which is what an `album_art_fallback` component answering from the network is, is validated by its bytes instead and pays a read every time.

`Cache-Control` is `no-cache`, meaning revalidate always and reuse the stored copy when it has not moved. Never `no-store`: the client is meant to keep the bytes.

## The HTTP contract

**`contract/openapi.yaml`, at the repository root, is the contract, and it is hand-written.** There is no framework here to generate one from, and a generated spec would describe the implementation rather than the promise: the descriptions carry the reasoning a client needs, which is the half that matters and the half no generator produces. Clients generate their types from it, so a stale spec is a client that compiles and is wrong. It changes in the same pass as any change to a response shape, a status code or an error string.

Two mechanical checks keep the code and the spec together, and neither can read prose. `tests/api_contract_test.cpp` pins the exact key set of every document the component publishes and drives the stream routes to compare their statuses with the spec's, reading the operation list through `tests/support/spec.h`. `scripts/test.sh` compares the spec's version with `src/core/version.h` before it builds anything.

`core/api.cpp` is the one place a published document is built, which is what stops `/api/status` and the discovery record drifting apart. Every answer of 400 or above carries a JSON `error` string. Bodies are capped at `kMaxBodyBytes`, which the spec documents by that number.

Three routes are reachable without a bearer token: `/api/status`, which says less than a port scan, and `/api/pair` and `/api/stream`, which carry credentials of their own. **A fourth means revisiting the permissive CORS default in the same change**, because that default is safe only while the unauthenticated routes stay that harmless.

## Pairing, and one accepted risk

The token is 64 hex characters, and pairing exists so that nobody has to type it into a phone or a television remote. `POST /api/pair` cannot require a credential, because the caller is asking for one. Four bounds carry it instead: a window somebody opened at the player, with no route that opens one remotely; one grant, the first success closing the window; private source addresses only, parsed rather than prefix-matched and checked *before* the window is consulted, so a caller from outside neither learns whether one is open nor spends the grant; and a history the pane shows and the log keeps, so a pairing nobody performed leaves evidence.

CORS is the fifth. Every other route reflects any origin by default, because every other route needs a token; this one hands one out, so with no `allowedOrigins` configured it admits only an origin whose host matches the `Host` the request was addressed to. `Content-Type: application/json` is required as well, so that a cross-origin caller is always preflighted and a simple `POST` cannot burn a grant blind.

**That same-host rule is defeated by DNS rebinding, and the risk is accepted.** A page served from a hostname resolving to the player's private address satisfies the origin check and the address check both. Requiring an IP literal would close it and would also stop anyone pairing through `http://player.local:8881`, which is how people reach the player. What remains is bounded on every other axis: a two-minute window only a person at the player can open, exactly one grant inside it, a private source, and a pane that names what paired. The attack needs a rebinding page loaded on the local network during a window somebody just opened by hand; the defence against it costs the feature its reason to exist. The trade is deliberate.

Pairing hands out the token the install already has rather than minting one per device, so regenerating the token locks out every device at once. `POST /api/pair` accepts an optional `name`, which is where per-device tokens would attach if they are ever added.

## Absences that shape the design

The code says what is there. These are the gaps to design back into rather than fill.

- **No event stream.** cpp-httplib is thread-per-connection, so a subscription would cost a thread for as long as a client held it. beefweb already raises its `playlists` event for playlists this component creates, so a client subscribed there re-reads `GET /api/playlists` and has the annotation. Streaming is the one thing worth a held thread, which is exactly what `maxConcurrentStreams` bounds.
- **No second copy of anything the player answers cheaply.** For tags and playlists this component is a messenger: accept a request, hand the work to foobar2000, answer, and hold nothing between one request and the next. A copy of a playlist would be wrong the moment somebody edited it in the player, and there is nothing to win by keeping one. The media library is the exception, and it is a snapshot rather than a cache: what makes it safe to hold is that `library_callback_v2_dynamic` says when the library changed, so nothing here has to guess whether what it holds is still true. *The media library* is what that costs.
- **No library scan.** Nothing here walks a directory. Paths arrive from a client and are resolved against what the player reports, and `preview` counts a query through the core's own library index rather than reading anything off disk.
- **No second abstraction behind the boundary.** One architectural seam is enough. `core/` has no plugin registry, no strategy interface with a single implementation, and no layer between a route and the pure function it calls.
- **No per-request bitrate, and no seeking.** One encoder per format feeds every listener of it; a second bitrate would mean a second encoder and a second buffer for as long as anybody held it. Seeking means asking foobar2000 to seek, which moves every listener at once.
- **No route that takes the output hold.** A client may ask for the player to be audible alongside the listeners. When they should be one output again is this component's decision, and it makes it afresh once everybody has stopped listening.
