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

**Two panels flank the content, and they are the same shape mirrored.** The sidebar
is a grid column on the left and a fixed drawer from the left below the breakpoint;
the queue is a grid column on the right and a fixed drawer from the right. Left is
where music comes from, right is where it is going.

The queue is deliberately *not* an action sheet, though the app has one and the
house style prefers it. A sheet is where you choose a command and leave; the queue
is a surface you work inside -- scroll it, drag rows around it, take rows off it --
and a detached sheet has neither the height nor the scroll for that. If a third
sheet-shaped thing ever appears, the chrome in `ActionMenu` should be extracted
rather than copied a second time.

Both panels' columns are set as **named custom properties on `.body`** rather than
by writing the whole `grid-template-columns` out once per combination. Two
independent toggles are four such rules that all have to agree, and the third one
added is the one that will not. The transition survives it: a custom property is
not animatable, but the `grid-template-columns` it resolves to is.

**A panel in a zero-width column still has to clip.** `min-width: 0` lets the column
reach zero and does nothing about the content, which paints out of it and widens the
document -- that surfaced as the library header's figures suddenly able to push the
page sideways, a test that had been green for months. `overflow: hidden` on the
panel, with the scroll on a child.

**Skipping is desktop-only in the status bar.** Two 32px targets flanking Play are a
miss waiting to happen on a thumb, and a miss on Previous costs you the track you
were enjoying. The phone gets shuffle, play, the queue and volume; previous and next
belong to the now-playing screen, where they are a swipe across the whole width
rather than a button between two other buttons.

**The queue button is destined for that screen too**, and is in the compact status
bar only until it exists -- removing it first would leave the panel with nothing to
open it on a phone. Deleting it there is a one-line change to `StatusBar`.

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
