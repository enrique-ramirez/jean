# Shared UI

The pieces every feature draws with.

## Menus and controls

- An exit animation's closing flag is derived during render, never set in an effect, or the remount steals focus from whatever the chosen action focused. `usePresence` follows the same rule, and the duration it is given matches the stylesheet.
- A menu returns focus on close only if it still has it.
- A disabled control carries its reason in its own label (`columns.unavailable`, `track.queueLimited`). With `useCanControlPlayback()` false a playback control stays drawn with `aria-disabled`; with `writePlaylists` off a playlist-editing control is absent. `switch-changes.spec.ts` holds both.
- Toasts are for what the user cannot already see.

## Pointer, touch, dragging

- A list whose rows can appear under a resting pointer gates `onMouseEnter` on `useEarnedHover`.
- Only a mouse drags: a coarse pointer gets an explicit handle or nothing.
- Capture the pointer only once the gesture is a drag, except on a small handle.
- A sortable row's key is its identity plus an occurrence counter, never its position, and its `style` is composed after the sortable spread, which owns `transform`.
- A layered surface passes a boundary to `scrollParent.ts`, or the walk returns the scroller underneath.
- A write driven by a drag goes through `useCoalescedWrite`.

## Artwork

- `src` has three states: `undefined` is still resolving, `null` is no cover. Hold `undefined` until `null` is certain.
- `identity` and `src` come from the same condition, since `holdArtwork` stores under one what it fetched from the other.
- Nothing in Jean stores a cover. The browser's HTTP cache does, and a group's `cover` in `domain/track/grouping.ts` gives each record one URL.
