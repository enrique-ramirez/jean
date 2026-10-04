# foo_jean

`plugins/fb2k/CONTRIBUTING.md` is how to write code here. Other paths are relative to `plugins/fb2k/`.

## Priorities, in order

1. **Security.** The component is safe as the only thing between the network and files it can rewrite. `plugins/fb2k/CONTRIBUTING.md`, *Security rules*, binds every feature.
2. **Performance, mostly foobar2000's.** For tags and playlists the component is a messenger, holding nothing. Three things are held on purpose: the stream, the media library snapshot and detached playback sessions.
3. **Cross-platform where it is free**: portable libraries and `std::` threading over Win32.

Measure on a real install rather than reasoning from a sentence.

## Driving the player

Four roles, and a script touching one assumes nothing of another: **a build machine**, the only place `src/fb2k/` compiles; **a player**, whose music files are never written; **a disposable install** for tag writes, built by `scripts/test-fixtures.ps1`; and **a deploy target**, reached only to deploy.

`scripts/deploy.local.sh` runs the tests, syncs, builds, installs and restarts; `--install --deploy` reaches the build machine's player as staging and the deploy target as production, and leaves the staging player stopped.

| | |
|---|---|
| Build machine | `<build-machine>`, key auth, default shell `cmd` |
| Player | portable install at `<foobar2000-install>`, profile beside the executable |
| foo_jean | port 8881; config and log in `<profile>/foo_jean/` |
| Library | `<library-root>`, never written and never scanned |
| Restart | `Invoke-PlayerCommand -Arguments @('/exit')`, then `@('/hide')`, from `scripts/lib/player.ps1` |

- **Never run `foobar2000.exe` over SSH.** An SSH session is session 0, so it starts a second instance that intercepts the single-instance IPC and hangs the next `/exit`. Use `scripts/lib/player.ps1`. A stray shows in `tasklist` as a `Services` row; kill that PID.
- Tag writes go only to the tree `scripts/test-fixtures.ps1` builds from its own corpus. Registering its two roots as media library folders is manual.
- `<profile>/library-v2.0/folders` is a count, then a length, a path and a zero per folder, and `filters` must exist beside it or no scan runs. Edit it with the player stopped.
- Exercise `notAnAutoPlaylist` only against a playlist made for the purpose, and an autoplaylist update or delete only against one made for it: both replace or remove a real playlist.
- Chained `cmd` builtins over SSH fail silently, so anything longer is a `.ps1` run with `powershell -NoProfile -ExecutionPolicy Bypass -File`.
- Set `[Console]::OutputEncoding=[Text.Encoding]::UTF8` before calling an accented filename broken; the console code page mangles it.
