# foo_jean: notes for a coding agent

A foobar2000 component exposing over HTTP what beefweb does not: tag writing, autoplaylists, and a live stream of the player's output. `plugins/fb2k/README.md` is what it is and how to run it. `plugins/fb2k/ARCHITECTURE.md` is how the pieces fit, which thread owns what, and why the boundaries sit where they do. `plugins/fb2k/CONTRIBUTING.md` is how to write code in it, and every rule about style, tests, comments, the `core`/`fb2k` boundary and the API contract lives there rather than here. `plugins/fb2k/src/README.md` maps the source tree.

This file holds only what cannot be read off the code: the priorities, the rules about touching a real player, and where the work stands. Every other path here is relative to `plugins/fb2k/`. **Those three documents are named in full wherever they appear**, because Jean keeps a `README.md`, an `ARCHITECTURE.md` and a `CONTRIBUTING.md` of its own at the root and under `ui/`, and a bare name would send a reader to the wrong one.

## Priorities, in order

**1. Security, and it is not a close first.** This component opens a listening port into a machine that holds a music library and can rewrite its files. Assume no perimeter: it must be safe when it is the only thing between the network and the files. Authentication is mandatory and never defaulted off, paths from clients are never trusted, writes are allowlisted by field, and bodies are capped. The full list is `plugins/fb2k/CONTRIBUTING.md`, *Security rules*.

**2. Performance, and mostly not this component's problem.** For tags and playlists this is a messenger: accept a request, hand the work to foobar2000, answer. Do not build caches, indexes or clever data structures. Streaming is the exception, and it is already designed around its real constraint; see `plugins/fb2k/ARCHITECTURE.md`.

**3. Cross-platform where it is free, and it is not a requirement.** foobar2000 for Mac exists and the SDK builds with Xcode, so keeping the seam sharp is worth a bias but not a contortion: prefer portable libraries and `std::` threading over Win32 equivalents, and keep ATL and WTL out of this component's own code.

## Ground rules

- **Never run a git command that writes.** No `commit`, `init`, `add`, `push`, `remote add`, no branches, no tags. The owner does all of that. Write and edit files, then stop and say what is ready. `git status`, `diff` and `log` are fine.
- **Run the tests that cover what you changed, and only those.** `scripts/test.sh '-sf=*cors_test.cpp'` for one file, `'-tc=*bearer*'` for one case. They need no SDK and no player, so run them as often as you like. A full run is a final step rather than a habit, and threaded code goes under `--sanitize=thread` before it is called ready: `plugins/fb2k/CONTRIBUTING.md`, *Tests*.
- **Run `scripts/format.sh`** before saying a change is ready, and `scripts/lint.sh` if clang-tidy is installed.
- **How to write code here is `plugins/fb2k/CONTRIBUTING.md`, and *Design*, *Comments* and *Documentation* are the three that get ignored first.** Structure must earn its place, and documentation states only the current design.
- **Write a comment only for a fact from outside this repository**, and name the system it is about. Why a value was chosen is a named constant; what the code does is the code; how the pieces fit is `plugins/fb2k/ARCHITECTURE.md`; what the player does is *Facts about the player*, below. An external fact lives in one place, and it is usually not a source file. `src/` is near zero and an exception should be a surprise; tests carry more, because why a case exists is worth saying.
- **`src/fb2k/` is reviewed, not tested, until `scripts/build.ps1` has run.** Say which of the two you did.
- **`contract/openapi.yaml`, at the repository root rather than in this tree, changes in the same pass as any change to a response shape, status code or error string.** `tests/api_contract_test.cpp` pins the key sets; it cannot write the prose.
- **Measure, do not assume.** Nearly every plausible approach to this problem is wrong in a way that only shows up on a real install. Where a claim in the docs is a measurement, re-run it rather than reasoning about it.

## Driving the player

The build happens on Windows, never on the editing machine. The loop is: edit, sync, build over SSH, install, restart, test. `scripts/deploy.local.sh` does the round trip and refuses to sync if the tests fail; `--skip-tests` overrides that when a change is genuinely Windows-only.

| | |
|---|---|
| Player | `<player-host>`, key auth, **default shell is `cmd`** |
| foobar2000 | portable install at `<foobar2000-install>`; the profile is beside the executable, *not* in `%APPDATA%` |
| beefweb | port 8880 |
| foo_jean | port 8881; config and log in `<profile>/foo_jean/` |
| Library | `<library-root>`. **Never written to.** Do not scan it; ask beefweb for paths |
| Fixtures | `<fixtures-dir>`, built by `scripts/test-fixtures.ps1`, in their own playlist |
| Restart | `schtasks /run /tn foo_jean_exit` then `/tn foo_jean_start` |

- **Never run `foobar2000.exe` over SSH, with any argument or none.** An SSH session is session 0, so it starts a *second* instance in the wrong window station, which then intercepts the single-instance IPC and makes the next `/exit` hang. `/add` is the same trap and is where the stray usually comes from. Use the interactive (`/it`) scheduled tasks above, or `scripts/lib/player.ps1`, which is what everything in `scripts/` uses.
- **If it happens:** `tasklist /fi "imagename eq foobar2000.exe"` shows two rows, one `Console` and one `Services`. Kill the `Services` one by PID. It holds no ports and does not own the profile.
- **Never point a tag write at the real library.** `scripts/test-fixtures.ps1` makes a corpus of copies, and it is the only thing writes are aimed at. Its fourth fixture has a non-ASCII filename on purpose, because track identity is a path and three files called `sample.*` exercise none of that.
- **Never test a destructive guard against a real playlist.** `notOurs`, the check that refuses to update or delete a playlist this component did not create, is the one guard with no live coverage. Exercise it against a playlist created for the purpose.
- **Do not scan whole drives over SSH.** Go to the known path, or ask.
- Because the default shell is `cmd`, anything beyond a one-liner is easier written as a `.ps1`, copied over and run with `powershell -NoProfile -ExecutionPolicy Bypass -File`. Chained `cmd` builtins over SSH fail silently. The PowerShell 5.1 encoding traps are in `plugins/fb2k/CONTRIBUTING.md`, *PowerShell scripts*.
- **Mojibake in an SSH console is not mojibake on disk.** `dir` renders accented filenames wrongly because of the console code page. Set `[Console]::OutputEncoding=[Text.Encoding]::UTF8` before concluding a filename is broken.
- Build traps are in `plugins/fb2k/README.md`, *Build traps*. Read them before debugging a link or resource-compiler error.

## Facts about the player that constrain the design

Each of these is measured, and each is a trap to design back into.

- **`metadb_io_v2` is the interface** and must be called on the main thread; `metadb_io::update_info_multi` is deprecated. Use `op_flag_silent`, or a failure raises a dialog nobody is there to dismiss. `file_info_filter::create` takes a lambda that runs on the tag updater's thread, so it MUST capture by value.
- **`metadb::handle_create` will build a handle for any path at all.** Being on the field allowlist is not being a track the player manages; check the Media Library *and* the open playlists, because plenty of installs have no library configured.
- **The SDK cannot tell you an autoplaylist's query.** There is no `get_query`, and `get_configuration` is an undocumented blob, so the component keeps its own record in a playlist property. Use `add_client_simple`, so the autoplaylists belong to the core and survive this component being removed.
- **beefweb's playlist id lives in a playlist property**, which is read and never written: beefweb assigns ids lazily, so a just-created playlist reports `beefwebId: null` until beefweb next looks.
- **The audio capture is post-DSP and pre-volume**, which is the premise of the streaming feature: muting the player leaves the stream at full level. `core/output_hold.h` is what that buys: choosing a device moves the sound rather than doubling it.
- **foobar2000 has no mute flag.** `is_muted()` is `get_volume() == -100`, so a mute is a volume everybody can see: the player's own window, beefweb, and every client reading it. Anyone may undo it from either end, which is why the hold never takes one back it has seen undone. What it will not leave behind is a **silent player**: the level from the start of an episode comes back when the last listener stops, whichever end the silence came from, because a player muted with nothing on screen to say why is the worst failure this has. Take a mute with `volume_mute_toggle()` rather than by setting -100, or the player's own unmute button restores a level from whenever it was last pressed.
- **Captured samples exceed full scale.** Peaks above +1 dBFS are routine on modern masters. Nothing in the path may assume `[-1, 1]`.
- **Every millisecond the stream holds back becomes permanent lag.** Delivery is 1x and a listener never catches up, so latency added anywhere in the pipeline is paid for the whole session. Two defaults charged for it: `ogg_stream_pageout` gathers 4096 bytes before it emits a page, measured on the wire at **260 ms** of audio per page at 128 kbps, and cpp-httplib leaves Nagle on, which holds a sub-segment page back until the last one is acknowledged. `ogg_stream_pageout_fill` with a byte count derived from the bitrate takes the page to **100 ms** for about 1% more bitrate in page headers; libogg will not build a page from fewer than four packets, so 80 ms is the floor. **`set_tcp_nodelay` is not optional once pages are small** or the kernel takes back what the muxer gave up.
- **Capture chunk size varies** on one player, so never size a buffer against an observed interval. Pass an explicit `requestInterval` to `playback_stream_capture_v2::add_callback_v2`, which the `-1` default does not do.
- **`fb2k::audioEncoder` has no implementations registered**, in the core or in common components. Encode with something this component ships or something the OS ships; the AAC path uses `CLSID_AACMFTEncoder` through Media Foundation.
- **Media Foundation, four traps:** the encoder thread must `CoInitializeEx` itself; a sample without `SetSampleTime` *and* `SetSampleDuration` is refused with `0xc00d36c8`; the output type must be set before the input type; and `MF_MT_AAC_PAYLOAD_TYPE` of 0 means the ADTS header per frame is ours to write. `certutil -error <hresult>` on the player names any of these in one line.
- **`metadb_handle::get_path()` answers the canonical path**, which on a portable install is `file-relative://...` where beefweb answers an absolute path. Anything published to a client goes through `filesystem::g_get_display_path`.
- **Safari cannot play Opus before 18.4**, which is the whole reason the AAC path exists as well. **An HTML `<audio>` element issues a plain GET with no custom body and no custom header**, and no `<audio>` element can POST at all. It also probes a source with `Range: bytes=0-1` before it will play, which is why one listening device routinely counts as two connections and why the stream response denies ranges. A stream ticket is minted over a request a script controls and then carries the device's identity into the `<audio>` element's own GET, in the URL, because that GET cannot carry it any other way.

## State

**All three goals work end to end** against a real player: tag writing, autoplaylists, and streaming in Opus and AAC with a timeline. Listening moves the sound rather than doubling it, and `GET /api/stream/listeners` says who else has it. The component builds, packages, installs and loads unsigned, with no manifest and no ceremony. The preferences page, device pairing and the discovery record are in. `scripts/verify-tag-write.ps1`, `scripts/verify-stream.ps1` and `scripts/verify-listeners.ps1` make three of those round trips repeatable.

**Next**, in order:

1. **`scripts/verify-autoplaylist.ps1`.** The autoplaylist round trip is still done by hand. Same shape as `verify-tag-write.ps1`: create, check the count against a preview, check beefweb sees it, update, delete, and assert the playlist set is unchanged at the end. It should create its own playlist to exercise `notOurs` against.
2. **The client half of autoplaylists.** The component half is done; `/api/capabilities` reports `canCreateAutoPlaylists` and `maxAutoPlaylists`, and `preview` reports `libraryEnabled` so a client can warn before creating a folder that cannot fill.
3. **Evaluating a query without materialising a playlist**, deliberately not built yet. `preview` already counts matches through the core's library index; returning the matching tracks instead would be the beginnings of the library API beefweb lacks: browse by genre with no playlist tabs and no ongoing cost to the player. It does not replace autoplaylists, because playback goes through beefweb and beefweb plays playlist items.
