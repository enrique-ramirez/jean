# The demo

`https://enrique-ramirez.github.io/jean/` — Jean, running with no player behind
it, so somebody can click around the whole app before installing anything.

**It is the app, unmodified.** Nothing under `src/` knows a demo exists, and
nothing may learn. `main.ts` is the only file that does: it installs the player,
waits for it to answer, and then imports `src/main.tsx`. If a feature ever needs
a branch in the app to work here, the demo is wrong, not the app.

## Why a service worker

The player is `test/fake-api/`, the same one the suite runs against, wired to a
`fetch` event instead of a socket. That is what `Responder` in
`fake-api/http.ts` is for: four methods, satisfied by node's `ServerResponse` on
one side and `responder.ts` on the other, so there is one route table and not
two implementations drifting apart.

A patched `window.fetch` would have been simpler and does not work: covers are
`<img src="/api/artwork/...">`, and only a worker sees those. It also catches
the update stream and the component's own port, both of which the app reaches
without going through anything Jean could hand it.

**The component is answered too.** `foo_jean` listens on a port of its own, so
the app builds `https://<this host>:8881/...` and the worker answers *that* --
cross-origin requests from a controlled page are still its to answer, and a
response it makes itself is not subject to CORS or a preflight. So discovery,
the status probe, pairing and a rating write all run here exactly as they run
against a real install.

## What the demo has, and what it cannot

Installed, listening, paired, and `allowedFields: ["rating"]`, so ratings write
and come back through beefweb on a reload. `canStream: false`, because there is
no audio in the bundle and never will be -- that is a real state the app already
draws, rather than a hole in the fake.

## The library is real, and that is the whole point

152 albums, 2,317 tracks, six and a half days of music, captured off a real
foobar2000 by the same tool that captures the test fixture:

```sh
node test/fake-api/capture.ts --url http://your-player:8880 \
     --albums demo/albums.ts --out demo
```

`albums.ts` names them and says why each is there; `library.json` and
`artwork/` are what came back, and both are committed.

It used to be five captured albums plus two hundred synthesised ones with drawn
covers, and **that was worse in a way worth remembering.** The app's front door
is a set of claims about a collection -- what you play most, what you played to
death and put down, what you have never opened, how the genres divide, what
percentage is played -- and against generated data every one of those was a
picture of the generator rather than of a library. Real records also mean the
things nobody would think to invent: an album tagged `Alternative rock, blues
rock, psychedelic rock, hard rock`, another spelled `Alternative rock` where its
neighbour says `Alternative Rock`, a three-disc live set, an album half in AAC
and half in FLAC. The genre list showing two spellings of one genre is Jean
being right -- see the tag-hygiene rule in the root CLAUDE.md -- and it took a
real library to show it.

**Two things are adjusted, both deliberately.** The last-played dates are slid
forward on load so the newest becomes today, because a capture is a photograph
of one afternoon and a demo still serving it a year later says "a year ago"
about everything and its recency shelves stop meaning anything; relative
distances are untouched. And lyrics are captured for **six albums only**,
flagged in `albums.ts` -- enough to show the tab, the scroll-in-time and
tapping a line to seek, without a public repo carrying a thousand licensed
lyrics. Everywhere else the Lyrics tab shows its empty state, which is what an
install without `foo_openlyrics` looks like.

## The clock is the one thing added to the player

The fake never ticks -- beefweb pushes on change and never on a timer, and a
suite that depended on a tick would be testing something the player does not do.
A demo where the track never ends is a demo of one row, so `clock.ts` wraps the
state and fires **at the end of a track only**, the way a player does. It also
writes the true position back before anything reads it, since the fake holds
whatever position it was last told about, and a pause that skipped that would
report the track back at its start.

It wraps rather than lives in `fake-api/`: the tests want none of this.

## What survives, and what a service worker costs

**The browser stops an idle worker after about thirty seconds** and starts a
fresh one for the next request, taking the player's state with it. So the
library is re-read from `library.json` -- fetched rather than bundled, because
2.5 MB inside a worker that is revalidated on every visit would be 2.5 MB
re-downloaded for every change to anything else in it -- and the *writes* are
journalled to the Cache API and replayed on the way up (`journal.ts`). A reload keeps your ratings and your playlists; so does a worker
the browser decided to shut down mid-session. The journal is capped, and the
chip's **Reset** button (or `?reset`) clears it.

Position within a track is not journalled and is not worth journalling: a replay
puts a track back at its start, and nothing about that is worth the machinery.

## Building it

```sh
pnpm demo           # two Vite builds into dist-demo/, plus the library and covers
pnpm demo:preview   # serve it
```

Two builds because a service worker is fetched by URL rather than imported: the
app bundles normally, and `sw.ts` bundles separately to `sw.js` beside
`index.html` -- which is also what puts its scope at the root of the demo rather
than inside `assets/`. `base` is relative, so the same output works at
`/jean/` or at the root of a domain without a rebuild.

`.github/workflows/demo.yml` does both on every push to `main`.

## Adding to it

Nothing, usually. A feature becomes demoable when its routes land in
`test/fake-api/` for its own specs, which is where they were going anyway. The
demo only needs touching when a feature needs *state* the fake has no route for,
or when it needs a seeded setting to be worth looking at -- `main.ts` holds
those, and holds nothing else.

Adding a record is one line in `albums.ts` and a re-capture, which needs the
player in reach. Nothing in the suite depends on this library, so getting it
wrong costs a rebuild rather than a red suite -- and `capture.ts` skips an album
it cannot find here, rather than failing the way it does for the fixture.
