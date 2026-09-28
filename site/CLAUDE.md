# The site and the demo

`site/` is the landing page and `ui/demo/` is Jean running with no player behind it. `pnpm site` builds the page and then the demo into its `demo/`, and `.github/workflows/site.yml` publishes both.

## The page

- **Its words are `README.md`**, sliced on `<!-- site:name -->` markers. A missing region fails the build and `test/site.test.ts`. `part()` takes a region's `###` heading and its words as one. `<meta name="description">` and the Open Graph tags are hand-written in `index.html`.
- Each frame is the demo in an iframe at a hash route, declared in `embeds.ts` with a distinct `title`. One origin and one service worker give every frame one player state.
- A frame is `inert` until clicked. Escape inside it hands the keyboard back when Jean has nothing to dismiss, which works only because the frames are same-origin.
- `focus: "search"` is the one screen a route cannot reach; `ui/demo/embed.ts` focuses the field after the app has drawn.

## The demo

- **Nothing under `ui/src/` knows the demo exists.** `demo/main.ts` installs the player, waits for it to answer, then imports `src/main.tsx`.
- The player is `ui/test/fake-api/` answering a service worker's `fetch` event through `Responder`, since covers are `<img>` requests only a worker sees. `canStream` is false.
- `library.json` and `artwork/` are captured off a real player; `albums.ts` names the records. Last-played dates slide forward on load so the newest is today, and only the albums `albums.ts` flags carry lyrics.
- `clock.ts` wraps the fake and ends a track at its end, writing the true position back before anything reads it. The fake itself never ticks.
- A browser stops an idle worker, so the library is re-read from `library.json` and the writes are journalled to the Cache API by `journal.ts` and replayed. The journal is capped; `?reset` clears it.
- `?embed` is a frame on the page: `embed.ts` hides the chip, starts a record, applies the frame's settings and gives it a `localStorage` of its own, since settings are read once at mount.
- `pnpm demo` runs two Vite builds, the app and `sw.ts` to `sw.js` beside `index.html` so its scope is the demo's root. `base` is relative.
- `main.ts` holds only state the fake has no route for and seeded settings. Nothing in the suite reads the demo's library.
