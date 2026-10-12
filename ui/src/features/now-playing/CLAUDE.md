# Now playing

## The screen

- `LyricsScreen` is a sibling of the screen, not a child, or a flick in it also skips a track.
- Every scroller lookup here is bounded by `data-now-playing`, or it finds the track list behind the layer.

## Gestures and the cover wheel

- A control that follows the finger carries `data-owns-touch`, on its popover as well, and so does every action sheet. The sleeve takes no touch (`pointer-events: none`), and nothing on the screen is keyed on the track.
- The wheel's radius (stylesheet) and gearing (component) move together.

## Lyrics

- LRCLIB wants clients named; a browser cannot set `User-Agent`, so Jean sends `Lrclib-Client` and pays a preflight. Ignoring `Retry-After` after a `429` risks a ban. `/api/search` returns at most 20 records; `/api/get` matches duration within 2 s.
- Every value goes through `readValue()`; read raw, a missing field is the string `?`.

## Rating

- In `useNowPlayingRating`, `isLocalFile` gates ahead of `canWrite`, because the rating answers `?` for a stream and an unrated file alike.
