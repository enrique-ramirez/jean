# The shell

The grid every feature is drawn inside, hash routing, the themes, the browser tab and the OS media session. `ARCHITECTURE.md` has why the shell is a fixed-height flex column, the `z-index` scale a new layer has to be placed against, and the styling rules.

## Surfaces

**The test for a new surface is whether the thing is a *place*.** A place has a subject, survives a reload, and Back means something, so it is a route. A drawer you open over your work and shut is not: a route would have to answer "what is behind this" and "where does dismissing it go", and both answers are "wherever you already were". **A fifth surface anything needs to point at SHOULD be a route.**

**A route can still be drawn as a layer.** The hash decides whether it is open while `App` goes on resolving the route underneath, so the shell still draws what it covers. That is what makes an overlay possible at all, but **an overlay leaves the app behind it live, where a route unmounted it**, which is what `keyboardOwner` exists to answer. See `shared/keyboard/CLAUDE.md`.

**Two panels flank the content and they are not the same kind of thing.** The sidebar is a grid column the content makes room for; the queue is an overlay sliding over the top of it, at every width.

**Both panels stop at the chrome rather than covering it**, so the top bar and the status bar stay live behind them. **The row they sit in is what clips a parked panel**: closed, the queue sits translated off the right edge of its own containing block, and without `overflow: hidden` there it becomes horizontal document overflow.

**The sidebar is a keyboard destination, not just a column**, and revealing it *with a key* also puts the caret on a row, where revealing it with a click leaves the caret alone. The shell owns whether the column is open and the sidebar owns which row gets the caret, so it travels as an ask (`sidebarFocus.ts`) rather than a prop: the reveal has to have committed before the focus is looked for. **Hiding it MUST blur a focused row.** A caret left on a collapsed column sends every key after it somewhere invisible.

**Every row of the grid carries `min-width: 0`, and the top bar is the one that keeps being forgotten.** A grid item may not be sized below its own min-content, so a single control that refuses to shrink sets a floor for the whole shell, and the document is as wide as the shell. On a phone that is two faults from one cause: the page scrolls sideways, and the browser widens the visual viewport to fit the excess, which leaves the full-height grid short of the bottom of the screen. Neither shows above about 400px, so `shell.spec.ts` asks at the narrowest phone worth drawing for.

## Routing

**Hash routing, because beefweb's static server has no SPA fallback**, for the reason `shared/api/README.md` gives.

**Where each view was left is remembered per view, and keyed on the route *underneath* the layer.** Keyed on the raw route instead, opening a layer would scroll the list behind it to the top and closing it would restore an offset over whatever had just been asked for. `useScrollMemory` also has to stand aside for a view being opened to be taken somewhere in particular, since the two would otherwise fight for as long as rows keep arriving.

**The front door opens where the sound is**, once per load, and waits for the player and the playlists since neither has answered on the first render. **`#/home` is exempt**: an empty hash is where a bookmark and the player's own link land, while `#/home` is somewhere the user asked to be. **Record where a layer was opened from before changing the hash, never after.** `useHashRoute` reads the new hash in the same render, so written the other way round the front door overwrites it and dismissing goes to the wrong place.

## Breakpoints, and there are two

**The JavaScript compact flag switches at 860px; the main CSS breakpoint is 720px.** `useIsCompactViewport()` drives what is a different *component* below it: a drawer instead of a column, a sheet instead of a popover, a stacked layout instead of a side-by-side one. Media queries drive what is the same component at a different *size*: gutters, type, row heights.

The band between them is real and easy to forget. **Anything spatial belongs to the media query.** If a JS flag is setting padding, that is the bug. The now-playing screen's gatefold threshold is the one exception, a container query against the screen's own box, because that box sits in a grid column beside the sidebar and no longer tracks the viewport.

## Theming

**Light is not the dark theme with the ramp reversed, and the two share a structure rather than a hue.** Dark accents in a warm amber; light drops that hue almost entirely and accents in charcoal, with the artwork as the only colour in the frame. `tokens.css` is the whole of it. Keep the warmth on dark.

**There are several accent tokens because an accent does several jobs and a charcoal can only do one.** Two rules the splits encode:

- **A near-black at low alpha over white is a grey vignette**, and a row washed in it reads *disabled*, the opposite of what a heavily played track is. Large translucent areas therefore take a separate tint token rather than the accent.
- **On light, the charcoal accent and the body text are the same colour to the eye**, so anywhere the accent carried *state* as a text colour it stopped carrying anything. **The test for reaching for the text accent is what the alternative state is drawn in**: if that is plain or muted body copy, use it; if the thing has a background, a border or a shape of its own, it keeps the ink.

**The star stays gold in both themes.** It is deliberately under WCAG's 3:1 for graphical objects: clearing that turns it orange, and what carries the meaning here is **fill against outline**, not the hue.

The neutrals follow the accent's hue rather than a warm one.

## The tab

**The favicon carries state and the title carries content.**

**A CSS-animated SVG favicon only animates in Firefox.** Chrome, Edge and Safari draw one static frame. So `favicon.ts` rasterises the SVG onto a canvas at a set of angles and swaps `link.href` between them, rendering each frame once and caching it. **Everything in the source file except the sheen is centred and circular**, so rotating the whole image is the same picture as rotating the sheen alone, which is what lets one SVG be both the static icon and the animation source. The file carries **no `prefers-color-scheme`**: a media query inside an SVG loaded as an `<img>` resolves inconsistently, and keeping it out is what keeps the file rasterisable.

**The source is fetched, so it MUST be resolved against the document and never written root-relative.** beefweb serves Jean under a subpath, where a root-relative path belongs to whatever is at the root rather than to this app. Written absolute it 404s in the only deployment that matters, the image never loads, and the record simply never spins, while dev, served at the root, looks perfect. Vite's relative `base` covers the tag in `index.html`; anything the code fetches for itself is on the code.

**State is the label's colour and never the motion.** A background tab's timers are clamped to about a second, so a spinning icon freezes exactly when the tab strip is the only thing visible. **No output or speaker mark either**: the browser already badges an audible tab with a speaker glyph immediately beside the favicon.

**The title never animates.** A marquee rewrites `document.title` several times a second forever, and history, bookmarks and the tab's tooltip each snapshot whichever frame they catch. A tab ellipsises early, so the track leads and the app name trails, and there is no play or pause glyph, because `▶` renders as a colour emoji on some platforms.

**`Disconnected` in the title never fires.** `usePlayer` is a `skipToken` query with no `queryFn` of its own; `["player"]` is only ever written by `setQueryData`, so its `isError` cannot become true, not on a failed first load and not afterwards. A player that quits while the tab is open leaves the last track in the title, and the status bar has the same blind spot. Closing it means noticing a poll that keeps failing, which `playerPoll.ts` does not do today: `fetchState`'s failures return early and touch nothing react-query would call an error.

**There is no `apple-touch-icon`.** iOS ignores SVG icons on a home screen and wants a PNG at a fixed size.

## The media session

The Android lock screen, macOS Now Playing and the media keys, iOS Control Centre, Bluetooth and car head units, Chrome's media hub. `useMediaSession` is a third consumer of what `useDocumentIdentity` derives, beside the title and the favicon, so nothing about the current track is worked out twice.

**Two things gate it, and neither is optional.** `navigator.mediaSession` is **secure-context only**, so an install served over plain HTTP on a LAN, which is the normal one, has no session at all and must go on working. And a session belongs to whatever is *audible*: as a remote for a player in another room Jean has no element and claims nothing. **A silent looping element to claim the controls anyway is rejected**: it badges every Jean tab as audible and spends a phone's battery for a notification.

**Everything it publishes is the audible copy**, so the lock screen changes track when the speaker does rather than early. Position is published on a push and never per frame. The OS interpolates from `playbackRate` between calls, so a frame loop would buy nothing and cost everything.

**The handlers drive the player, never the element.** Pausing the element would cut the sound still draining out of the buffer; see `src/domain/player/CLAUDE.md`. `play` and `pause` each check before pressing `foo_jean`'s single `POST /api/playback/play-pause`, since the OS sends `play` freely including when it already is playing. Stopping ends the listening session as well: a stopped player with the stream still attached would hold the component's mute for audio nobody is hearing.

Two traps worth keeping: Chrome throws a **`TypeError` on a position past the duration**, which a live stream's own clock will produce, and `setActionHandler` **throws for an action the browser does not know** rather than ignoring it. Both are caught: losing the scrubber is not worth losing the session.

**The session carries the playing cover, redrawn rather than addressed.** The browser and the OS fetch whatever address they are given themselves, so Jean cannot attach the bearer token `foo_jean`'s cover routes require and hands over no address at all: `shrinkForLockScreen()` is where the cover Jean already fetched with the token is redrawn into something the session can take instead, and why.

**The album and the album artist ride the same poll as title and artist, on `PlayerState.activeItem`.** The media session keys its cover off them directly, the way the status bar and the now-playing screen do, rather than waiting on `useNowPlayingTrack`'s own per-track read: that query still exists for the now-playing screen's lyrics, rating and detail panels, but nothing here depends on it, and nothing in this file should start to.
