# Now playing

## The screen

- Closing the screen returns to the route that opened it, never `history.back()`, which on a direct load leaves Jean.
- The screen stays mounted while closed, so its Escape gate leads with whether it is open. The capture helper ignores an event from a field.
- `LyricsScreen` is a sibling of the screen, not a child, or a flick in it also skips a track. The panel's own lyric unmounts while it is up.
- Every scroller lookup here is bounded by `data-now-playing`, or it finds the track list behind the layer.

## Gestures and the cover wheel

- A control that follows the finger carries `data-owns-touch`, on its popover as well, and so does every action sheet. The sleeve takes no touch (`pointer-events: none`), and nothing on the screen is keyed on the track.
- The wheel's radius (stylesheet) and gearing (component) move together. Three nodes keyed by index modulo three serve every position.
- A skip holds the title from the gesture until the sound catches up, while whether a turn was refused is read off the player's track. An unanswered turn times out, since at a playlist's end the player takes the skip and reports nothing.

## Lyrics

- The lyric tag and the details come from one `GET /api/track/playing` per track, keyed on the file, and the answer's `path` and `subsong` are checked against the track shown before anything is drawn.
- `foo_openlyrics` writes the tag after a track starts and nothing announces it, so the lyric column alone is asked again, a few times, while the panels are mounted.
- LRCLIB wants clients named; a browser cannot set `User-Agent`, so Jean sends `Lrclib-Client` and pays a preflight. Ignoring `Retry-After` after a `429` risks a ban. `/api/search` returns at most 20 records; `/api/get` matches duration within 2 s.
- Every value goes through `readValue()`; read raw, a missing field is the string `?`.
- LRC in real files carries `\r\n` or a lone `\r`, several timestamps on one line, an `[offset:…]` in milliseconds to subtract, and fractions of one to three digits. `SYNCED_MIN_SPAN` calls a lyric synced by the span of its timing.

## Rating

- `useNowPlayingRating` serves the stars, the menu and the digits, and offers nothing until the track's rating has arrived. `isLocalFile` gates ahead of `canWrite`, because the rating answers `?` for a stream and an unrated file alike.
