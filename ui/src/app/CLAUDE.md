# The shell

## Layout

- The sidebar is a grid column; the queue is an overlay at every width. Both stop at the chrome, and the row they sit in clips a parked panel with `overflow: hidden`, or it becomes horizontal document overflow.
- Every row of the grid carries `min-width: 0`, the top bar included, for the reason `ui/ARCHITECTURE.md`, *Facts about the browser*, gives. The fault shows only on a narrow phone, which is the width `shell.spec.ts` asks at.
- Revealing the sidebar with a key puts the caret on a row, through the ask in `sidebarFocus.ts`, and hiding it blurs a focused row.
- `useIsCompactViewport()` switches at 860px and decides which component draws; the main CSS breakpoint is 720px and decides sizes. The now-playing gatefold is a container query against its own box.

## Routing

- A route can be drawn as a layer while `App` resolves the route underneath, which leaves the app behind it live; `shared/keyboard` answers that.
- Scroll is remembered per view, keyed on the route underneath the layer.
- The front door opens where the sound is, once per load, and `#/home` is exempt. Where a layer was opened from is recorded before the hash changes, since `useHashRoute` reads the new hash in the same render.

## Theming

- A large translucent area takes a tint token rather than the accent, which on light is a grey wash that reads disabled. State carried by text colour alone uses the text accent, since on light the charcoal accent and body text look alike.

## The tab

- `favicon.ts` rasterises the SVG onto a canvas at a set of angles and swaps `link.href`. Everything in the source but the sheen is centred and circular, and it carries no `prefers-color-scheme`.
- Anything the code fetches for itself resolves against the document, never root-relative, because the build's `base` is relative for the demo.
- State is the label's colour, never motion.

## The media session

- It exists only in a secure context and only while this device is audible; an install over plain HTTP has none.
- The handlers drive the player, never the element. `play` and `pause` check the state before sending `foo_jean`'s single `POST /api/playback/play-pause`. Stop ends the listening session too.
- The cover is the one Jean already fetched, redrawn into a `data:` URL by `shrinkForLockScreen()` for every platform.
- Album and album artist come off `PlayerState.activeItem`, never `useNowPlayingTrack`.
