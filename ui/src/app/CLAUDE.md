# The shell

## Layout

- The row the sidebar and the queue sit in clips a parked panel with `overflow: hidden`, or it becomes horizontal document overflow.
- Every row of the grid carries `min-width: 0`, the top bar included, for the reason `ui/ARCHITECTURE.md`, _Facts about the browser_, gives. The fault shows only on a narrow phone, which is the width `shell.spec.ts` asks at.
- `useIsCompactViewport()` switches at 860px and decides which component draws; the main CSS breakpoint is 720px and decides sizes. The now-playing gatefold is a container query against its own box.

## Routing

- A route can be drawn as a layer while `App` resolves the route underneath, which leaves the app behind it live; `shared/keyboard` answers that.
- Where a layer was opened from is recorded before the hash changes, since `useHashRoute` reads the new hash in the same render. `navigation.spec.ts`, "with a track loaded it opens that track, over the set it came from", holds the order.

## Theming

- A large translucent area takes a tint token rather than the accent, which on light is a grey wash that reads disabled. State carried by text colour alone uses the text accent, since on light the charcoal accent and body text look alike.

## The tab

- `favicon.ts` turns `public/favicon.svg` on a canvas, so everything in that file but the sheen is centred and circular, and it carries no `prefers-color-scheme`.
- Anything the code fetches for itself resolves against the document, never root-relative, because the build's `base` is relative for the demo.
