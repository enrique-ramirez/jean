# The demo

Jean running with no player behind it, so somebody can click around the whole app before installing anything. `site/build.ts` builds it into the landing page at `demo/`, and `.github/workflows/site.yml` publishes the two together on every push to `main`.

**It is the app, unmodified.** Nothing under `src/` knows a demo exists, and nothing may learn. `demo/main.ts` is the only file that does: it installs the player, waits for it to answer, then imports `src/main.tsx`. **If a feature ever needs a branch in the app to work here, the demo is wrong, not the app.**

## Why a service worker

The player is `test/fake-api/`, the same one the suite runs against, wired to a `fetch` event instead of a socket through the `Responder` seam. [test/README.md](../test/README.md) is the rest of it.

**A patched `window.fetch` cannot do this job**, because covers are `<img src="/api/artwork/…">` and only a worker sees those. Everything else under `/api/` could be answered by a patched fetch alone, but the worker answers all of it in one place rather than splitting the fake between two seams.

**Everything under `/api/` is answered here**, since the demo's own origin has no `foo_jean` behind it: the capabilities probe, pairing and a rating write all run exactly as they run against a real install.

**`canStream: false`**, since there is no audio in the bundle: a real state the app already draws, not a hole in the fake.

## The library is real, and that is the point

Captured off a real player by the same tool that captures the test fixture. `albums.ts` names the records and says why each is there; `library.json` and `artwork/` are what came back, and both are committed.

**It MUST stay real.** The front door is a set of claims about a collection: what you play most, what you played to death and put down, what you have never opened, how the genres divide. Against generated data every one of those is a picture of the generator. Real records also carry what nobody would think to invent: an album with four genres in one tag, two neighbouring records spelling one genre differently, a multi-disc live set, an album half in one codec and half in another. **A genre list showing two spellings of one genre is Jean being right**; see the tag-hygiene rule in `CONTRIBUTING.md`.

**Two things are adjusted, both deliberately.** Last-played dates are slid forward on load so the newest becomes today, with relative distances untouched: a capture is a photograph of one afternoon, and a demo still serving it a year later says "a year ago" about everything. And lyrics are captured for a handful of albums only, flagged in `albums.ts`, enough to show the tab, the scroll-in-time and tapping a line to seek, without a public repo carrying licensed lyrics wholesale. Everywhere else the Lyrics tab shows its empty state, which is what an install without `foo_openlyrics` looks like.

## The clock is the one thing added to the player

The fake never ticks, because beefweb pushes on change and never on a timer, and a suite depending on a tick would test something the player does not do. A demo where the track never ends is a demo of one row, so `clock.ts` wraps the state and fires **at the end of a track only**, the way a player does. It also writes the true position back before anything reads it, since the fake holds whatever position it was last told about and a pause that skipped that would report the track back at its start.

It wraps rather than living in `fake-api/`: the tests want none of it.

## What a service worker costs

**The browser stops an idle worker** and starts a fresh one for the next request, taking the player's state with it. So the library is re-read from `library.json`, fetched rather than bundled, or the whole capture would be revalidated and re-downloaded for every change to anything else in the worker. The *writes* are journalled to the Cache API and replayed on the way up (`journal.ts`). A reload keeps your ratings and your playlists, and so does a worker the browser shut down mid-session. The journal is capped, and the chip's Reset button (or `?reset`) clears it. Position within a track is not journalled: a replay puts a track back at its start.

## Frames on the site page

A demo opened with `?embed` is one of the windows on the landing page rather than the demo itself, and `embed.ts` is everything that follows from it: no chip, a record already playing so a frame is not a stopped player, the settings a frame declares for itself, and a `localStorage` the frame keeps to itself. `../site/CLAUDE.md` says why that last one is not the real one.

## Building it

`pnpm demo` runs **two** Vite builds into `dist-demo/`, since a service worker is fetched by URL rather than imported: the app bundles normally, and `sw.ts` bundles separately to `sw.js` beside `index.html`, which is also what puts its scope at the root of the demo rather than inside `assets/`. `base` is relative, so the same output works under any prefix without a rebuild.

## Adding to it

Nothing, usually. A feature becomes demoable when its routes land in `test/fake-api/` for its own specs, which is where they were going anyway. The demo needs touching only when a feature needs *state* the fake has no route for, or a seeded setting to be worth looking at, and `main.ts` holds those and holds nothing else. What a frame on the site page needs is the exception, and it lives in `embed.ts` rather than growing this file.

Adding a record is one line in `albums.ts` and a re-capture, which needs a player in reach. **Nothing in the suite depends on this library**, so getting it wrong costs a rebuild rather than a red suite.
