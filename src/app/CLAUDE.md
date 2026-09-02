# The shell

The app grid, the breakpoints and the themes.

## Layout

The app shell is a `100dvh` grid, rows `auto / 1fr / auto` — chrome, content, status bar —
where **the content row is the only scroll container**. Not `vh`; mobile browser chrome
breaks it.

That one choice buys three things: the status bar is pinned by construction rather than
`position: sticky` (no z-index fights, no iOS sticky bugs), the virtualizer gets the
explicit scroll element it needs, and safe-area insets have somewhere to live. Do not move
scrolling to `<body>`.

The status bar is **one component with two shapes**, not two components: a full-width
footer on desktop, a compact strip that expands to a full-screen sheet on mobile.

**Two panels flank the content, and they are not the same kind of thing.** The
sidebar is a grid column the content makes room for; the queue is an overlay that
slides in from the right over the top of it, at every width. Left is where music
comes from, right is where it is going.

That asymmetry is the point. The sidebar is where you *are* -- it changes what the
main pane shows, so the two belong side by side. The queue is a glance at what
happens next, opened and shut around whatever you were already doing, and
reflowing a table you were reading in order to show it is a poor trade. It slides
rather than appears so the direction says where it came from and where dismissing
it will send it back to.

The queue is deliberately *not* an action sheet, though the app has one and the
house style prefers it. A sheet is where you choose a command and leave; the queue
is a surface you work inside -- scroll it, drag rows around it, take rows off it --
and a detached sheet has neither the height nor the scroll for that. If a third
sheet-shaped thing ever appears, the chrome in `ActionMenu` should be extracted
rather than copied a second time.

**Both panels stop at the chrome rather than covering it.** They are positioned
inside `.body`, so the top bar and the status bar stay live behind them -- which
matters most on a phone, where the queue covers nearly everything else and the
button that opened it is the obvious thing to reach for to close it again. Only
the compact viewport gets a scrim, and it dims the content and nothing else.

**`.body` is what clips the parked panel.** Closed, the queue sits at
`translateX(100%)`, off the right edge of its own containing block; without
`overflow: hidden` there it becomes horizontal document overflow, which is how the
library header's figures once gained the ability to push the page sideways.

**The compact status bar is Play and volume, and nothing else.** Two 32px targets
flanking Play are a miss waiting to happen on a thumb, and a miss on Previous costs
you the track you were enjoying -- so skipping, shuffle and the queue all live on the
now-playing screen now, at full size. Volume stays, *left* of Play, so Play is the
rightmost thing in the bar and therefore closest to a right thumb; it earns the slot
because it is the player's volume and the handset's hardware keys cannot reach it.

**The cover-and-names block is the way in**, on both surfaces -- a ~200px target
rather than a 44px one. `#/playing` is a route rather than a fourth panel, so Back
works and a reload lands on it.

**Now playing is a third kind of surface, and it is neither of the two above.**
The sidebar is a grid column and the queue is an overlay you work inside; this
is a *route drawn as a layer* -- the hash decides whether it is open, and `App`
goes on resolving the route underneath so the shell still draws what it covers.
That is what gives it something to slide over, and it is why dismissing it is a
navigation rather than a state change. If a fourth surface ever appears, this
is the pattern to copy for anything that is both a place and a thing over a
place.

**On a phone that route replaces the status bar**, which is the one place in the app
where a route does. The screen is the whole viewport and carries its own transport;
leaving the strip below it puts two Play buttons and the same cover on screen at once.
The desktop keeps it -- there the screen is a pane inside the shell and the status bar
is the only transport there is.

Model **what is playing** separately from **where it is playing**. Output is a named
target, not an assumption that audio comes from the remote player.

## Two breakpoints, and they are not the same one

**CSS switches at 720px. JavaScript switches at 860px.** `useIsCompactViewport()` drives
the things that are a different *component* below it — the sidebar becoming a drawer, the
action sheet instead of a popover, the album cover stacking above its tracks, how many
columns are worth showing. The media queries drive the things that are the same component
at a different *size*: gutters, type, row heights.

That split is defensible, but the band between them is real and easy to forget. An album
group once took its horizontal gutter from `data-compact` — a JS-driven attribute — while
the toolbar above it took its own from a media query, so between 720 and 860 the list
indented itself to the phone gutter and nothing lined up with anything. **Anything
spatial belongs to the media query.** If a JS flag is setting padding, that is the bug.

## Theming

The accent is `#ffb454` on `#0e1013` — effectively the Ayu Dark palette, and the
identity of the app. Keep the warmth.

`#ffb454` on white is ~1.7:1 and unreadable, so the **light theme must darken the accent**
(Ayu Light's `#fa8d3e` is the reference), not reuse it. Define both themes in `oklch` as
one hue with different lightness ramps, so they stay in sync rather than drifting into two
hand-tuned palettes.
