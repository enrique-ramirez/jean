# The demo

Jean running with no player behind it, so somebody can click around the whole app before installing anything. Published from `.github/workflows/demo.yml` on every push to `main`.

**It is the app, unmodified.** Nothing under `src/` knows a demo exists, and nothing may learn. `demo/main.ts` is the only file that does: it installs the player, waits for it to answer, then imports `src/main.tsx`. **If a feature ever needs a branch in the app to work here, the demo is wrong, not the app.**

## Why a service worker

The player is `test/fake-api/`, the same one the suite runs against, wired to a `fetch` event instead of a socket. That is what `Responder` in `fake-api/http.ts` is for: four methods, satisfied by node's `ServerResponse` on one side and `responder.ts` on the other, so there is one route table rather than two implementations drifting apart.

A patched `window.fetch` would have been simpler and does not work: covers are `<img src="/api/artwork/...">` and only a worker sees those. It also catches the update stream and the component's own port, both of which the app reaches without going through anything Jean could hand it.

**The component is answered too.** `foo_jean` listens on a port of its own, so the app builds `https://<this host>:8881/...` and the worker answers *that* — cross-origin requests from a controlled page are still its to answer, and a response it makes itself is subject to neither CORS nor a preflight. So discovery, the status probe, pairing and a rating write all run here exactly as they run against a real install.

## What the demo has

Installed, listening, paired, and `allowedFields: ["rating"]`, so ratings write and come back through beefweb on a reload. **`canStream: false`**, because there is no audio in the bundle and never will be — that is a real state the app already draws, not a hole in the fake.

## The library is real, and that is the point

152 albums, 2,317 tracks, captured off a real player by the same tool that captures the test fixture:

```sh
node test/fake-api/capture.ts --url http://<player-host>:8880 \
     --albums demo/albums.ts --out demo
```

`albums.ts` names them and says why each is there; `library.json` and `artwork/` are what came back, and both are committed.

The reason it must stay real: the front door is a set of claims about a collection — what you play most, what you played to death and put down, what you have never opened, how the genres divide, what percentage is played. Against generated data every one of those is a picture of the generator. Real records also carry what nobody would think to invent: an album tagged `Alternative rock, blues rock, psychedelic rock, hard rock`, another spelled `Alternative rock` where its neighbour says `Alternative Rock`, a three-disc live set, an album half in AAC and half in FLAC. A genre list showing two spellings of one genre is Jean being right — see the tag-hygiene rule in `CONTRIBUTING.md`.

**Two things are adjusted, both deliberately.** Last-played dates are slid forward on load so the newest becomes today, because a capture is a photograph of one afternoon and a demo still serving it a year later says "a year ago" about everything; relative distances are untouched. And lyrics are captured for **six albums only**, flagged in `albums.ts` — enough to show the tab, the scroll-in-time and tapping a line to seek, without a public repo carrying a thousand licensed lyrics. Everywhere else the Lyrics tab shows its empty state, which is what an install without `foo_openlyrics` looks like.

## The clock is the one thing added to the player

The fake never ticks — beefweb pushes on change and never on a timer, and a suite depending on a tick would test something the player does not do. A demo where the track never ends is a demo of one row, so `clock.ts` wraps the state and fires **at the end of a track only**, the way a player does. It also writes the true position back before anything reads it, since the fake holds whatever position it was last told about and a pause that skipped that would report the track back at its start.

It wraps rather than lives in `fake-api/`: the tests want none of it.

## What a service worker costs

**The browser stops an idle worker after about thirty seconds** and starts a fresh one for the next request, taking the player's state with it. So the library is re-read from `library.json` — fetched rather than bundled, because 2.5 MB inside a worker revalidated on every visit would be 2.5 MB re-downloaded for every change to anything else in it — and the *writes* are journalled to the Cache API and replayed on the way up (`journal.ts`). A reload keeps your ratings and your playlists, and so does a worker the browser shut down mid-session. The journal is capped, and the chip's **Reset** button (or `?reset`) clears it.

Position within a track is not journalled and is not worth journalling: a replay puts a track back at its start.

## Building it

```sh
pnpm demo           # two Vite builds into dist-demo/, plus the library and covers
pnpm demo:preview   # serve it
```

Two builds, because a service worker is fetched by URL rather than imported: the app bundles normally, and `sw.ts` bundles separately to `sw.js` beside `index.html` — which is also what puts its scope at the root of the demo rather than inside `assets/`. `base` is relative, so the same output works under any prefix without a rebuild.

## Adding to it

Nothing, usually. A feature becomes demoable when its routes land in `test/fake-api/` for its own specs, which is where they were going anyway. The demo needs touching only when a feature needs *state* the fake has no route for, or a seeded setting to be worth looking at — `main.ts` holds those and holds nothing else.

Adding a record is one line in `albums.ts` and a re-capture, which needs a player in reach. Nothing in the suite depends on this library, so getting it wrong costs a rebuild rather than a red suite; `capture.ts` skips an album it cannot find here, where it fails for the fixture.
