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
