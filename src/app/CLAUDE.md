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

**Settings is the fourth surface and deliberately not that pattern.** It is a
dialog: `isSettingsOpen` state in `App`, no hash, opened by the gear or `Mod+,`,
dismissed by Escape, the scrim or the close button. The test is whether the thing
is a *place*. Now playing is one -- it has a subject, survives a reload, Back means
something. Settings is a drawer you open over your work and shut. A route would
have to answer "what is behind this" and "where does dismissing it go", and both
answers are "wherever you already were".

It is therefore not linkable and does not survive a reload. Nothing linked to it,
so the trade was cheap -- but a fifth surface anything needs to point at SHOULD be
a route.

**An overlay leaves the app behind it live, where a route unmounted it.** The
track list still answered to `V`, `H` and `S`, and `Space` on a focused switch
both flipped it and paused the music. See `shared/keyboard/CLAUDE.md`.

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
identity of the app. Keep the warmth. **On dark.**

**Light is not the dark theme with the ramp reversed, and trying to make it one is what
was wrong with it.** The rule here used to be "one hue, two lightness ramps": darken the
accent for light and the two stay in sync. That produced a burnt orange over a warm
off-white, and the reason it never looked right is not contrast — the darkened accent
clears 4.5:1 — it is that **a warm accent on a near-black page is a lamp and the same
hue on a near-white page is a stain.** It has nothing to glow against, so it reads as the
page being dirty rather than as a colour anybody chose.

So light drops the hue almost entirely and accents in **charcoal** — near-black fills,
white glyphs, the artwork as the only colour in the frame. The two themes now share a
structure and not a hue, and `tokens.css` is where the whole of it is written down.

**Three accent tokens, because an accent does three jobs and a charcoal can only do
one of them.**

| | | |
|---|---|---|
| `--accent` | *ink* — opaque fills and small shapes: the play button, a set star, the tab rail, the seek fill, the cursor bar | charcoal on light |
| `--tint-l/c/h` | *wash* — large translucent areas: the play-count heat, the header gradients, `--album-ground` | blue on light |
| `--accent-text` | *mark* — a foreground whose whole job is to differ from `--text` | blue on light |
| `--star` | a set star, and nothing else | gold in **both** |

On dark all three are the same yellow, and nothing about that theme changed.

**`--star` is the fourth, and it is the exception that proves the split is about
jobs rather than about hue.** A set star stays gold in *both* themes, because
gold is not Jean's accent being reused -- it is what a rating is drawn in
everywhere, from Amazon to Letterboxd to the App Store, and a star in the page's
own charcoal reads as a checkbox. Light deepens it one notch rather than reusing
`#ffb454` verbatim: *measured*, the dark yellow is **1.69:1** against the light
page and looks bleached -- peach rather than gold -- while `oklch(0.78 0.165 72)`
is `#f7a30d` and **1.97:1**, between Amazon's `#FFA41C` (1.90) and above Google
Play's `#FBBC04` (1.64). Deliberately under WCAG's 3:1 for graphical objects:
clearing that puts it at `#d97600`, which is orange, and what carries the meaning
here is **fill against outline** -- the empty star is `--border-strong` and is
the one drawn most.

**`--positive` is the fifth**, because on dark the accent could not say "this is
fine": the foo_jean badge read "Connected" in a yellow one notch from `--danger`'s
red. Green in both themes, held at C 0.13 -- it marks a thing that is working, next
to body copy, not a traffic light.

The two splits came out of the same fact and are worth stating separately, because each
was found by something breaking:

- **A near-black at 6–22% alpha over white is a grey vignette.** A row washed in it says
  *disabled*, which is the opposite of what a heavily played track is. Hence `--tint`.
- **`--accent` at L 0.27 and `--text` at L 0.26 are the same colour to the eye.** Every
  place the accent was carrying *state* as a text colour stopped carrying anything: the
  playing playlist's icon matched the four silent ones, "shuffle is on" matched "you are
  hovering shuffle", and an album card's hover changed nothing at all. Hence
  `--accent-text`, and the test for reaching for it is **what the alternative state is
  drawn in.** If it is `--text` or `--muted`, use `--accent-text`. If the thing has a
  background, a border or a shape of its own — a filled pill, an outlined star, a 2px
  rail — it keeps the ink, because a black disc is obviously not the page.

The neutrals follow the accent's hue rather than a warm one, for the same reason the old
palette was internally consistent: warm greys under a blue-cast charcoal read as two
palettes that met by accident.
