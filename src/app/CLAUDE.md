# The shell

The app grid, the breakpoints, the themes and the browser tab.

## Layout

The shell is a `100dvh` grid, rows `auto / 1fr / auto` — chrome, content, status bar — where **the content row is the only scroll container**. Not `vh`; mobile browser chrome breaks it. **Do not move scrolling to `<body>`.**

That buys three things: the status bar is pinned by construction rather than `position: sticky` (no z-index fights, no iOS sticky bugs), the virtualiser gets the explicit scroll element it needs, and safe-area insets have somewhere to live.

**Two panels flank the content, and they are not the same kind of thing.** The sidebar is a grid column the content makes room for; the queue is an overlay sliding in from the right over the top of it, at every width. Left is where music comes from, right is where it is going. The sidebar changes what the main pane shows, so the two belong side by side; the queue is a glance at what happens next, opened and shut around whatever you were already doing, and reflowing a table to show it is a poor trade.

The queue is deliberately **not** an action sheet, though the app has one. A sheet is where you choose a command and leave; the queue is a surface you work inside — scroll it, drag rows around it, take rows off it. If a third sheet-shaped thing appears, extract the chrome in `ActionMenu` rather than copying it again.

**Both panels stop at the chrome rather than covering it.** They are positioned inside `.body`, so the top bar and the status bar stay live behind them — which matters most on a phone, where the queue covers nearly everything and the button that opened it is the obvious thing to reach for. Only the compact viewport gets a scrim, and it dims the content alone.

**`.body` is what clips the parked panel.** Closed, the queue sits at `translateX(100%)`, off the right edge of its own containing block; without `overflow: hidden` there it becomes horizontal document overflow.

## Four surfaces, and what each one is

| | |
|---|---|
| Sidebar | a grid column |
| Queue | an overlay you work inside, at every width |
| Now playing (`#/playing`) | a **route drawn as a layer**: the hash decides whether it is open, and `App` goes on resolving the route underneath so the shell still draws what it covers |
| Settings | a **dialog**: state in `App`, no hash, opened by the gear or `Mod+,`, dismissed by Escape, the scrim or the close button |

**The test is whether the thing is a *place*.** Now playing has a subject, survives a reload, and Back means something. Settings is a drawer you open over your work and shut; a route would have to answer "what is behind this" and "where does dismissing it go", and both answers are "wherever you already were". Settings is therefore not linkable and does not survive a reload. **A fifth surface anything needs to point at SHOULD be a route.**

**The front door opens where the sound is.** Landing on `#/` with a track loaded goes to `#/playing` and points the view under the layer at whatever is playing — the set Jean materialised for it, or the playlist the player holds it in. It happens once per load and waits for the player and the playlists, since neither has answered on the first render; a stopped player reports `index` of -1 and the front door stays the front door. **`#/home` is exempt**: an empty hash is where a bookmark and the player's own link land, while `#/home` is somewhere the user asked to be. **Set `openedFrom` before the hash, never after** — `useHashRoute` reads the new hash in the same render, so the effect that records the route sees `#/playing` and leaves it alone; written the other way round it overwrites the set with the front door and dismissing goes to the wrong place.

**An overlay leaves the app behind it live, where a route unmounted it.** See `shared/keyboard/CLAUDE.md` for what that costs and how `keyboardOwner` answers it.

## The status bar

**One component with two shapes**, not two components: a full-width footer on desktop, a compact strip that expands to a full-screen sheet on mobile.

**The compact status bar is Play and volume, and nothing else.** Two 32px targets flanking Play are a miss waiting to happen on a thumb, and a miss on Previous costs the track you were enjoying — so skipping, shuffle and the queue live on the now-playing screen at full size. Volume stays *left* of Play, so Play is the rightmost thing in the bar and therefore closest to a right thumb; it earns the slot because it is the player's volume and the handset's hardware keys cannot reach it.

**The cover-and-names block is the way in**, on both surfaces — a ~200px target rather than a 44px one.

**On a phone `#/playing` replaces the status bar**, the one place in the app where a route does: the screen is the whole viewport and carries its own transport, and leaving the strip below it puts two Play buttons and the same cover on screen at once. The desktop keeps it, where the screen is a pane inside the shell.

Model **what is playing** separately from **where it is playing**. Output is a named target, not an assumption that audio comes from the remote player.

## Two breakpoints, and they are not the same one

**CSS switches at 720px. JavaScript switches at 860px.** `useIsCompactViewport()` drives what is a different *component* below it — the sidebar becoming a drawer, the action sheet instead of a popover, the album cover stacking above its tracks, how many columns are worth showing. Media queries drive what is the same component at a different *size*: gutters, type, row heights.

The band between them is real and easy to forget. **Anything spatial belongs to the media query.** If a JS flag is setting padding, that is the bug.

## Theming

The accent is `#ffb454` on `#0e1013`, effectively the Ayu Dark palette, and the identity of the app. Keep the warmth. **On dark.**

**Light is not the dark theme with the ramp reversed.** A warm accent on a near-black page is a lamp; the same hue on a near-white page is a stain — it has nothing to glow against, so it reads as the page being dirty rather than as a colour anybody chose. Contrast is not the problem: a darkened accent clears 4.5:1 and still looks wrong. So light drops the hue almost entirely and accents in **charcoal** — near-black fills, white glyphs, the artwork as the only colour in the frame. The two themes share a structure, not a hue. `tokens.css` is the whole of it.

**Five accent tokens, because an accent does several jobs and a charcoal can only do one.**

| | | |
|---|---|---|
| `--accent` | *ink* — opaque fills and small shapes: the play button, a set star, the tab rail, the seek fill, the cursor bar | charcoal on light |
| `--tint-l/c/h` | *wash* — large translucent areas: play-count heat, header gradients, `--album-ground` | blue on light |
| `--accent-text` | *mark* — a foreground whose whole job is to differ from `--text` | blue on light |
| `--star` | a set star, and nothing else | gold in **both** |
| `--positive` | a thing that is working, next to body copy — not a traffic light | green in both, held at C 0.13 |

On dark the first three are the same yellow.

Two rules the splits encode, each found by something breaking:

- **A near-black at 6–22% alpha over white is a grey vignette.** A row washed in it reads *disabled*, which is the opposite of what a heavily played track is. Hence `--tint`.
- **`--accent` at L 0.27 and `--text` at L 0.26 are the same colour to the eye**, so anywhere the accent carried *state* as a text colour it stopped carrying anything. Hence `--accent-text`. **The test for reaching for it is what the alternative state is drawn in**: if that is `--text` or `--muted`, use `--accent-text`; if the thing has a background, a border or a shape of its own, it keeps the ink.

**`--star` stays gold in both themes**, because gold is what a rating is drawn in everywhere and a star in the page's own charcoal reads as a checkbox. Light deepens it one notch — `oklch(0.78 0.165 72)`, `#f7a30d`, 1.97:1 against the light page, between Amazon's `#FFA41C` and above Google Play's `#FBBC04`. Deliberately under WCAG's 3:1 for graphical objects: clearing that puts it at `#d97600`, which is orange, and what carries the meaning here is **fill against outline** — the empty star is `--border-strong` and is the one drawn most.

The neutrals follow the accent's hue rather than a warm one: warm greys under a blue-cast charcoal read as two palettes that met by accident.

## The tab

**The favicon carries state and the title carries content**, and that split is what makes each legible.

**A CSS-animated SVG favicon only animates in Firefox.** Chrome, Edge and Safari draw one static frame. So `favicon.ts` rasterises `public/favicon.svg` onto a 32px canvas at twelve angles and swaps `link.href` between them — twelve frames at 150 ms is a 1.8 s revolution, which is 33⅓ rpm. Frames render once, lazily, and are cached; the loop assigns an href and does no drawing.

**The source is fetched, so it is resolved against the document and never written root-relative.** beefweb serves Jean under a subpath through `urlMappings`, where `/favicon.svg` belongs to whatever is at the root rather than to this app. Written absolute it 404s in the only deployment that matters, the image never loads, and the record simply never spins — while dev, served at the root, looks perfect. Vite's `base: "./"` covers the tag in `index.html`; anything the code fetches for itself is on the code.

**Everything in the file except the sheen is centred and circular**, so rotating the whole image is the same picture as rotating the sheen alone. That is what lets one SVG be both the static icon and the animation source.

**State is the label's colour and never the motion.** A background tab's timers are clamped to about a second, so a spinning icon freezes exactly when the tab strip is the only thing visible. The accent means audio is coming out and nothing else; paused and stopped are one appearance, and unreachable is a third in `--danger`. (A page that is itself playing audio is exempt from throttling — which is a reason to leave the colour doing the work rather than to rely on motion when Jean streams.)

**No output or speaker mark.** The browser already badges an audible tab with a speaker glyph immediately beside the favicon.

**The label is the icon at 16px and the vinyl is its ground.** At 41% of the diameter it reads as a dot; at 33% — roughly a real LP — it reads as both. Because the label always sits on dark vinyl rather than on the page, `#ffb454` works over a light tab strip as well as a dark one. The sheen is two shapes because one cannot do both sizes: the gradient wedge reads at 32px and vanishes at 16, the specular streak reads at 16 and looks stuck on at 64. The rim is a single light hairline and the file carries **no `prefers-color-scheme`** — a media query inside an SVG loaded as an `<img>` resolves inconsistently, and keeping it out is what keeps the file rasterisable.

### The title

A tab ellipsises at around forty characters and a narrow one shows nearer fifteen, so **the track leads and `Jean` trails**. No play or pause glyph: the favicon says it better, and `▶` renders as a colour emoji on some platforms. Nothing playing is `Jean` alone.

**The title never animates.** A marquee rewrites `document.title` several times a second forever, and history, bookmarks and the tab's tooltip each snapshot whichever frame they catch.

**`Disconnected · Jean` only covers a failed first load.** `usePlayer` has `staleTime: Infinity` and never refetches, so `isError` is set by a load that did not succeed and by nothing afterwards: a player that quits while the tab is open leaves the last track in the title. The status bar has the same blind spot. Closing it means watching the `EventSource`'s own `readyState`, which is a store in `domain/player`.

### Not built here

There is no `apple-touch-icon`. `index.html` sets `mobile-web-app-capable`, and iOS ignores SVG icons on a home screen — it wants a 180px PNG.

## The media session

The Android lock screen, macOS Now Playing and the media keys, iOS Control Centre, Bluetooth and car head units, Chrome's media hub. `useMediaSession` is a third consumer of what `useDocumentIdentity` derives, beside the title and the favicon, so nothing about the current track is worked out twice.

**Two things gate it, and neither is optional.** `navigator.mediaSession` is **secure-context only**, so an install served over plain HTTP on a LAN — which is the normal one — has no session at all and must go on working. And a session belongs to whatever is *audible*: the metadata takes effect only while this page holds media the OS can see, which is while the stream is attached here. As a remote for a player in another room Jean has no element, claims nothing, and should not — a lock screen offering buttons for sound coming out of a different machine is a lie about which device it controls. **A silent looping element to claim the controls anyway is rejected**: it badges every Jean tab as audible and spends a phone's battery for a notification.

**Everything it publishes is the audible copy.** `useDocumentIdentity` reads `useAudiblePlayer`, so the lock screen changes track when the speaker does rather than a second and a half early, and `setPositionState` is fed `audibleAt` for the same reason. Position is published on a push and never per frame — the OS interpolates from `playbackRate` between calls, so a frame loop would buy nothing and cost everything.

**The handlers drive the player, never the element.** Pausing the element would cut the second of sound still draining out of the buffer; the rule and the measurement are in `src/domain/player/CLAUDE.md`. So `playbackState` is set from the player while the stream runs on underneath, and `play` and `pause` each check before pressing beefweb's single `play-pause`, because the OS sends `play` freely including when it already is playing. `seekto` goes through the ordinary patch, which calls `beginSeek`, so the OS scrubber holds at the target instead of snapping back to the audio still buffered.

**Stopping ends the listening session as well.** A lock screen's stop means "I am done with this", and a stopped player with the stream still attached would hold the component's mute for audio nobody is hearing.

Two traps worth keeping: Chrome throws a **`TypeError` on a position past the duration**, which a live stream's own clock will produce, and `setActionHandler` **throws for an action the browser does not know** rather than ignoring it. Both are caught — losing the scrubber is not worth losing the session.

`%album%` is the one field on the lock screen that the update stream does not carry, and it must not join it: `UPDATES_URL` re-evaluates its `trcolumns` on every push. It comes from `useNowPlayingTrack`, whose `enabled` flag exists for this — one shared query, so the screen and the lock screen never ask twice.
