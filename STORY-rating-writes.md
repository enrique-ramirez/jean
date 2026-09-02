# Story: rating writes, through `foo_jean`

**Goal.** A person can set a track's rating from Jean, and it sticks. Jean without
`foo_jean` installed is exactly the app it is today, with ratings read-only.

**Scope is one field: `rating`.** `foo_jean` writes whatever its allowlist names, but
this story ships one control. Everything else it might eventually write — genre,
comment, artist — is out of scope, and the seam should not be shaped around a
speculative second field. Read the allowlist, use it to decide whether the rating
control appears, ignore the rest.

Read `CLAUDE.md` first, especially *Detecting `foo_jean`, and why its answer cannot be
trusted*. The discovery design is settled there and this story does not restate it.
What this adds is the write API, which now exists, and the decisions the UI has to make.

---

## The API

`foo_jean` publishes an OpenAPI spec, and it is the contract rather than a summary:

```
~/Projects/personal/foo_jean/docs/openapi.yaml
```

**Generate the types, do not hand-write them:**

```sh
npx openapi-typescript ../foo_jean/docs/openapi.yaml -o src/shared/api/fooJean.d.ts
```

It generates discriminated unions that do most of the work — `written: true | false`,
and `error` as a string-literal union — so the error handling type-checks itself.
Commit the generated file; do not add a codegen step to `pnpm build` for a sibling
repo that may not be checked out.

Three routes matter here. The spec has the full detail, including every status:

| | |
|---|---|
| `GET /api/status` | **No credential.** Says `name`, `version`, `apiVersion`, `authRequired`. This is the probe that makes a discovery record safe to act on. |
| `GET /api/capabilities` | Bearer. `allowedFields`, `canWrite`. This is what decides whether the rating control is interactive. |
| `POST /api/tags` | Bearer. `{ path, subsong?, fields: { rating: "4" } }`. One track per request. |

An empty string **removes** the tag: `{ rating: "" }` clears a rating rather than
setting it to zero. That is how the control's "no rating" state should be sent.

Every response of 400 or above is JSON with an `error` string. On `POST /api/tags`
they also carry `written: false`, except `401` and `413`, which are refused before the
route is reached — so branch on the HTTP status, not on the presence of `written`.

The ones with a UI consequence:

- **`403`** — the field is not on this install's allowlist. Retrying will never work.
  The control should not have been offered; treat reaching this as a bug in the
  capability check, log it, and stop offering the control for the session.
- **`404`** — foobar2000 does not manage that track. Real, and not necessarily the
  user's fault: a file present on disk that the player has never been told about
  answers this.
- **`504`** — the player did not answer in 30 seconds. **The write may still land.**
  Re-read rather than assuming failure, and do not roll the optimistic update back on
  this one.

---

## Two things that will bite, and are not obvious

### `foo_jean` is loopback-only by default

`bindAddress` defaults to `127.0.0.1`. Jean is served by beefweb and is usually opened
from *another* device — and a browser on a phone cannot reach the player's loopback,
however correct the advertised port is. **The common case for a remote device is a
component that is installed, advertised, healthy, and unreachable.**

So `GET /api/status` failing is not "not installed". It is a distinct state and needs
its own message, naming the fix: set `bindAddress` in
`<profile>/foo_jean/config.json` to the LAN address or `0.0.0.0`, and restart
foobar2000. Silently rendering ratings read-only here is the thing to avoid; the user
has done everything right and has no way to find out what is wrong.

Four states, and they are all different:

| what happened | what Jean should do |
|---|---|
| `clientconfig` is `null` | Not installed. Read-only ratings, no error, no nagging. |
| Record present, `listening: false` | Show its `error`. "Installed but could not start on port 8881" is actionable. |
| Record present, `/api/status` unreachable | Almost certainly the loopback default. Say so, with the fix. |
| `/api/status` answers, no token stored | Prompt for the token, once. |

### The rating scale is not one scale

`src/domain/track/rating.ts` already reads four conventions — foobar2000's 0–5, the
0–10 `foo_playcount` writes, FLAC's 0–100, and a POPM byte — and infers which by
magnitude. That is on **read**.

On write there is no inference available, and writing `"4"` to a file whose `RATING`
was on the 0–100 scale silently changes a 4% rating into a 4-star one. That is a
change to somebody's tags they did not ask for, which is the one thing this feature
must never do.

For this story: **write foobar2000's native 0–5 integers, and only offer the control
where that is unambiguous.** If a track's raw rating is above 5, it is on another
scale — render it read-only rather than rescaling it. `ratingOf` already gives the
stars; what the control needs is the *raw* value too, to decide whether it may write.

`hasHalfStars` exists for the related question and the answer for now is: **whole
stars only.** Introducing halves into a library that has none is also a change nobody
asked for.

---

## The seam

`CLAUDE.md` specifies `{ kind, canWrite, allowedFields, write(track, fields) }`, in
the shape of `librarySource.ts`. Note that `librarySource.ts` actually lives in
`src/domain/track/`, not `src/domain/library/` as `CLAUDE.md` says — put `tagWriter.ts`
beside the real one and fix that line while you are there.

Two implementations for this story:

- **`none`** — nothing reachable. `canWrite: false`, `write` never called. Every
  install works.
- **`agent`** — `foo_jean`, verified and holding a token.

`beefweb` stays a comment until [#384](https://github.com/hyperblast/beefweb/issues/384)
ships. Do not build a placeholder for it.

**If anything outside `tagWriter.ts` has to ask which writer it holds, the seam is in
the wrong place.** A component renders a rating control, or it does not, and the
reason is `canWrite`.

Ratings are written per track and a user clicking through stars generates a burst, so
`useCoalescedWrite` is the existing thing to reach for rather than a new one.

---

## Settings

**Yes, this belongs in Jean's UI, not in foobar2000's preferences.** The reasoning,
since the question is reasonable:

`foo_jean` deliberately draws no UI at all — no ATL, no WTL — because it is built for
a headless install where nobody can open a preferences dialog. Its own settings live
in `<profile>/foo_jean/config.json` and are the *player owner's* business: port, bind
address, which fields may ever be written. Those are not Jean's to change, and Jean
should never try.

What Jean owns is the client half, and it is one setting:

- **The bearer token.** Generated on the component's first run into
  `<profile>/foo_jean/config.json`, and copied out by hand exactly once. It is
  deliberately not in the discovery record, so there is no way to obtain it
  automatically and there should not be.

Everything else Jean *displays* and does not edit: the detected port, the version, the
allowlist from `/api/capabilities`, and which of the four states above it is in. A
"test connection" button that runs the probe and reports plainly is worth more than
any amount of configuration.

### The one hard rule about storing it

`useStoredState` says these values "should end up in beefweb's `/api/clientconfig` so
they follow the user between devices". **The token must never go there.** Anyone who
can reach beefweb can read `clientconfig`, and beefweb ships with no authentication —
so syncing the token through it would turn "can reach beefweb" into "can rewrite my
music", which is the exact escalation `foo_jean` was designed to prevent.

Keep it in `localStorage`, and if `clientconfig`-backed settings ever land, put an
explicit exclusion in that code with this reason written next to it.

---

## Testing

Everything goes through the fake, as `test/README.md` requires. Two additions:

**1. The discovery record.** The fake serves beefweb, so it serves
`GET /api/clientconfig/foo_jean`. A fixture option — `fooJean` — should be able to
produce all four states: absent (`null`), `listening: false` with an error, listening,
and listening-but-unreachable.

**2. A second listener.** `foo_jean` is on a *different port*, so it is genuinely
cross-origin from the app. Faking it as another route on the same server would test an
arrangement that does not exist and would skip CORS and the preflight entirely. Give
the fake a second listener on its own port and have the record advertise it.

### What the fake has to get wrong on purpose

`test/README.md` has a section by this name, and this adds to it:

- **The unreachable case must actually not answer**, not answer 500. A refused
  connection and an error response are different things in the browser and Jean has to
  distinguish them.
- **`413` may never arrive.** Over 256 KB the component answers and closes while the
  body is still in flight; measured at roughly one request in three on loopback, the
  client sees a dropped connection instead. Not reachable with a rating write, but if
  the fake models the limit, model it that way.

### Tests worth having

- Ratings are read-only with no component, and the app is otherwise identical.
- Each of the four states renders its own message; the unreachable one names the fix.
- With a component and a token, clicking a star sends **one** `POST /api/tags` with the
  expected body — assert off `player.requests`, the way the existing specs do.
- A `403` stops the control being offered rather than retrying.
- A track whose raw rating is above 5 renders read-only and sends nothing.
- `allowedFields: []` (`canWrite: false`) behaves exactly like no component.

---

## Verifying against the real player

The fake proves Jean's behaviour. It cannot prove the two ends agree, so do that once,
by hand, at the end.

> ### Do not write tags to the music library
>
> `F:\Musica` on the player holds **30,441 real, irreplaceable tracks**. Nothing in
> this story writes to it. Not one file, not once, not "just to check".
>
> There is a corpus that exists precisely so that writes have somewhere safe to go.
> Point everything at that, and if you find yourself about to send a path under
> `F:\Musica`, stop.

The fixtures live in `F:\foo_jean-test` and are in the playlist **`#foo_jean test`**.
There are **four** — the story brief said three, and a fourth was added since:

| file | format | why it is there |
|---|---|---|
| `sample.mp3` | MP3 | rating is an ID3v2 frame |
| `sample.flac` | FLAC | rating is a Vorbis comment |
| `sample.m4a` | AAC | rating is an MP4 atom |
| `05. Maldita Tú.mp3` | MP3 | **non-ASCII path** — track identity is the path, and the rest are pure ASCII |

Three formats because a rating is written by three different code paths inside
foobar2000, and a writer that works on one says nothing about the others. All four sit
at `%rating%` of 5, so there is a value to change and change back.

**Resolve the playlist by title, not by id.** It is currently `p30`; it was `p29`
before the fixture script was re-run, and it will move again.

`foo_jean` has a script for the round trip that is worth copying rather than
reinventing — it writes a rating to every track in that playlist and reads it back
through beefweb, which is the only thing that proves foobar2000's *database* learned
about the write:

```powershell
scripts\verify-tag-write.ps1 -Rating 3    # on the player
scripts\verify-tag-write.ps1 -Rating 5    # put them back
```

It refuses to run against a playlist holding more than 20 items, which is the guard
against exactly the mistake above.

---

## Done means

- Jean with no `foo_jean` is unchanged, and its suite is green.
- All four discovery states render something a person can act on.
- A star click writes, and the value survives a reload — through beefweb, not from
  Jean's own cache.
- A track on an unrecognised rating scale is read-only, and nothing was rescaled.
- Nothing outside `tagWriter.ts` knows which writer it has.
- The four fixtures are back at rating 5, and `F:\Musica` is untouched.
