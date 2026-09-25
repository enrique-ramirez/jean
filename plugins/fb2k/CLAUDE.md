# foo_jean: notes for a coding agent

A foobar2000 component serving Jean's page and the whole HTTP API behind it: playback and the player's state, playlists and the play queue, the media library as one columnar snapshot, cover art, tag writing, autoplaylists, and a live stream of the player's output. `plugins/fb2k/README.md` is what it is and how to run it. `plugins/fb2k/ARCHITECTURE.md` is how the pieces fit, which thread owns what, and why the boundaries sit where they do. `plugins/fb2k/CONTRIBUTING.md` is how to write code in it, and every rule about style, tests, comments, the `core`/`fb2k` boundary and the API contract lives there rather than here. `plugins/fb2k/src/README.md` maps the source tree.

This file holds only what the other four do not: the priorities, the rules about touching a real player, and where the work stands. Every other path here is relative to `plugins/fb2k/`. **Those three documents are named in full wherever they appear**, because Jean keeps a `README.md`, an `ARCHITECTURE.md` and a `CONTRIBUTING.md` of its own at the root and under `ui/`, and a bare name would send a reader to the wrong one.

## Priorities, in order

**1. Security, and it is not a close first.** This component opens a listening port into a machine that holds a music library and can rewrite its files. Assume no perimeter: it must be safe when it is the only thing between the network and the files. The rules that follow from that are `plugins/fb2k/CONTRIBUTING.md`, *Security rules*, and not one of them is negotiable for a feature.

**2. Performance, and mostly not this component's problem.** For tags and playlists this is a messenger: accept a request, hand the work to foobar2000, answer. Do not build a cache, an index or a clever data structure for either of those. Two things are held on purpose and both are designed around a constraint that is real and written down: the stream, and the media library snapshot. `plugins/fb2k/ARCHITECTURE.md` has each of them, and a third would need the same argument made afresh.

**3. Cross-platform where it is free, and it is not a requirement.** foobar2000 for Mac exists and the SDK builds with Xcode, so keeping the seam sharp is worth a bias but not a contortion: prefer portable libraries and `std::` threading over Win32 equivalents.

## Ground rules

- **How to write code here is `plugins/fb2k/CONTRIBUTING.md`, and *Design*, *Comments* and *Documentation* are the three that get ignored first.** Structure must earn its place, and documentation states only the current design. What the player does is `plugins/fb2k/ARCHITECTURE.md`, *Facts about the player*.
- **Measure, do not assume.** Nearly every plausible approach to this problem is wrong in a way that only shows up on a real install. Where a document states a constraint a measurement established, take the measurement again rather than reasoning from the sentence.

## Driving the player

Four roles, and a script that touches one MUST NOT assume it is another: **a build machine**, Windows, the only place the component compiles and the only place `src/fb2k/` is tested; **a player**, whose music files are never written, on which playback and playlists are fair game; **a disposable install**, for anything that writes tags, built and torn down by `scripts/test-fixtures.ps1`; and **a deploy target**, reached only to deploy, as the last step of finishing a task.

The loop against the build machine is: edit, sync, build over SSH, install, restart, test. `scripts/deploy.local.sh` does that round trip and refuses to sync if the tests fail; `--skip-tests` overrides that when a change is genuinely Windows-only.

**A deploy reaches two installs off one build: the player on the build machine as staging, and the deploy target as production.** `deploy.local.sh --install --deploy` is that run. `--install` leaves the staging player stopped, so start it again afterwards.

| | |
|---|---|
| Build machine | `<build-machine>`, key auth, **default shell is `cmd`** |
| Player | portable install at `<foobar2000-install>`; the profile is beside the executable, *not* in `%APPDATA%` |
| foo_jean | port 8881; config and log in `<profile>/foo_jean/` |
| Library | `<library-root>`. **Never written to.** Do not scan it; ask `foo_jean`'s own library export for paths |
| Disposable install | `<fixtures-dir>`, built by `scripts/test-fixtures.ps1`, in their own playlist |
| Restart | `schtasks /run /tn foo_jean_exit` then `/tn foo_jean_start` |

- **Never run `foobar2000.exe` over SSH, with any argument or none.** An SSH session is session 0, so it starts a *second* instance in the wrong window station, which then intercepts the single-instance IPC and makes the next `/exit` hang. `/add` is the same trap and is where the stray usually comes from. Use the interactive (`/it`) scheduled tasks above, or `scripts/lib/player.ps1`, which is what everything in `scripts/` uses.
- **If it happens:** `tasklist /fi "imagename eq foobar2000.exe"` shows two rows, one `Console` and one `Services`. Kill the `Services` one by PID. It holds no ports and does not own the profile.
- **Never point a tag write at the real library.** `scripts/test-fixtures.ps1` copies a corpus kept for the purpose into a tree of its own, and that tree is the only thing writes are aimed at. **Never restock that corpus out of the library**: no copy of somebody's music produces the cases it is there to hold. Registering the tree's two roots as media library folders is a manual step nothing checks, and a run that skipped it reaches the positional address form and none of the library ones.
- **Registering a media library folder is a binary edit with the player stopped.** `<profile>/library-v2.0/folders` is a count, then a length, a path and a zero for each folder, and `filters` must exist beside it or the library subsystem never initialises and no scan runs. With one folder the per-entry and terminator-once readings are byte-identical, so the format only becomes legible once more than one is written. A path takes the absolute or the install-relative form and the two can be mixed.
- **Never test a destructive guard against a real playlist.** `notOurs`, the check that refuses to update or delete a playlist this component did not create, is the one guard with no live coverage. Exercise it against a playlist created for the purpose.
- **Do not scan whole drives over SSH.** Go to the known path, or ask.
- Because the default shell is `cmd`, anything beyond a one-liner is easier written as a `.ps1`, copied over and run with `powershell -NoProfile -ExecutionPolicy Bypass -File`. Chained `cmd` builtins over SSH fail silently. The PowerShell 5.1 encoding traps are in `plugins/fb2k/CONTRIBUTING.md`, *PowerShell scripts*.
- **Mojibake in an SSH console is not mojibake on disk.** `dir` renders accented filenames wrongly because of the console code page. Set `[Console]::OutputEncoding=[Text.Encoding]::UTF8` before concluding a filename is broken.
- Build traps are written down where they are enforced, and `plugins/fb2k/README.md`, *Build traps*, says which file carries which. Read them before debugging a link or resource-compiler error.

## State

**All three goals work end to end** against a real player: tag writing, autoplaylists, and streaming in Opus and AAC with a timeline. Listening moves the sound rather than doubling it, and `GET /api/stream/listeners` says who else has it. The component builds, packages, installs and loads unsigned, with no manifest and no ceremony. The preferences page is in, and so is Jean's own page, served from the component, same-origin with the API it calls. `scripts/verify-tag-write.ps1`, `scripts/verify-stream.ps1` and `scripts/verify-listeners.ps1` make three of those round trips repeatable.

**The media library is a snapshot this component builds and keeps fresh**, in the columns whoever asks for it declares, with two generations and a per-column delta so a client patches what it holds rather than fetching it again. `core/` holds the snapshot, the encoding and every decision a request meets; `src/fb2k/library.cpp` walks the player, and like everything in that directory it is reviewed rather than tested until `scripts/build.ps1` has run.

**`GET /api/artwork` answers a cover from that snapshot**, addressed by a track's library-relative path so that one record is one URL in every view and the browser's own cache does the keeping.

**Next**, in order:

1. **`scripts/verify-autoplaylist.ps1`.** The autoplaylist round trip is still done by hand. Same shape as `verify-tag-write.ps1`: create, check the count against a preview, check `GET /api/playlists` sees it, update, delete, and assert the playlist set is unchanged at the end. It should create its own playlist to exercise `notOurs` against.
2. **The client half of autoplaylists.** The component half is done; `/api/capabilities` reports `canCreateAutoPlaylists` and `maxAutoPlaylists`, and `preview` reports `libraryEnabled` so a client can warn before creating a folder that cannot fill.
3. **The playback-commands half.** `GET /api/state` already names the playing track, says which playlist it is playing from and where, and serves the now-playing cover. What is left is a component route that takes a playback mode by name, which `playerOrderFor` already implements with only tests calling it, and a client control that can express all seven modes `foo_jean` offers rather than the single shuffle toggle Jean draws today; the two halves need not land together. **That control is a product decision nobody has taken.**
