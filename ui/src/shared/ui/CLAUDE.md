# Shared UI

The pieces every feature draws with. `ui/ARCHITECTURE.md`, *Facts about the browser*, has the browser behaviour most of these rules answer.

## Menus and controls

- `ActionMenu.tsx` draws every popover, action sheet and confirmation from an array of actions; `Menu.tsx` is the dropdown anchored to a visible button.
- An exit animation's closing flag is derived during render, never set in an effect, or the remount steals focus from whatever the chosen action focused. `usePresence` follows the same rule, and the duration it is given matches the stylesheet.
- A menu returns focus on close only if it still has it.
- A disabled control carries its reason in its own label (`columns.unavailable`, `track.queueLimited`). With `canControlPlayback` off a playback control stays drawn with `aria-disabled`; with `writePlaylists` off a playlist-editing control is absent. `switch-changes.spec.ts` holds both.
- Toasts are for what the user cannot already see.

## Pointer, touch, dragging

- A list whose rows can appear under a resting pointer gates `onMouseEnter` on `useEarnedHover`.
- Only a mouse drags: a coarse pointer gets an explicit handle or nothing. `useSortableList.ts` reorders one short list; `dnd.ts` drags across containers by hit-testing to `[data-drop-target]`. Both take the autoscroll ramp from `dragGeometry.ts`.
- Capture the pointer only once the gesture is a drag, except on a small handle.
- A sortable row's key is its identity plus an occurrence counter, never its position, and its `style` is composed after the sortable spread, which owns `transform`.
- The track list does not subscribe to the drag store.
- `useSwipe.ts` reads touch events, settles a gesture that competes with scrolling by scroll position, and ignores a touch that begins under `data-owns-touch`.
- A layered surface passes a boundary to `scrollParent.ts`, or the walk returns the scroller underneath.
- A write driven by a drag goes through `useCoalescedWrite`.

## Artwork

- `nearViewport.ts` decides whether to ask and `artworkQueue.ts` how many ask at once; the settle gate is the half that matters. `revealsInstantly` skips only the first gate, and is for the cover wheel's neighbours.
- `src` has three states: `undefined` is still resolving, `null` is no cover. Hold `undefined` until `null` is certain.
- `identity` and `src` come from the same condition, since `holdArtwork` stores under one what it fetched from the other. `coverIdentity()` says what a cover is.
- Nothing in Jean stores a cover. The browser's HTTP cache does, and `albumCoverRows` gives each record one URL.
