# Tracks

## Ratings

- `rating.ts` bands a raw value by magnitude, because one library holds several taggers' scales at once: foobar2000's 0–5, 0–10, FLAC's 0–100 `RATING`, and a POPM byte on the thresholds Windows Explorer, foobar2000 and MediaMonkey share. The banding is per value, never one scale per library.
- Jean writes whole stars on foobar2000's native 0–5, so a track stored on a larger scale is read-only, asked per track through `isWritableScale()`. The empty string removes the tag; `"0"` is a rating some taggers read as unrated.
- A 403 means the allowlist lacks the field, which then stops being offered for the session. A 504 is not rolled back: the write may still land, so the value is re-read.
- `0`–`5` rate a layer's track, else the cursor row, else the playing track. A layer publishes through `ratingTarget.ts` even where its value is read-only, so a digit never falls through to the row behind.

## The list

- Following playback measures the row against the scroll container, since overscan mounts rows past the fold. The virtualiser's `align: "auto"` is minimal scrolling, not centring.
- `jumpToPlaying.ts` is raised when the route lands, never at the click.
- *Playback follows cursor* skips arrival, never replays the track that just ended, runs before the cursor moves, and reads the cursor through a ref.
- Undo removes the range that landed, and a `409` on the removal says the playlist changed underneath.

## Holding a library

- Nothing per row is held, and `rowAt()` is the only thing that builds a row. A question of the whole library sweeps the dictionary through `byValue()`, `tagGrouper()` or `columnReader()`, never the rows.
- `pathTable.ts` interns the one path Jean holds. A sliced string keeps its whole original alive, and a string is one byte per character only if every character is, so remainders are joined in blocks.

## TanStack Virtual

- Measurements are cached by item key, which defaults to the index. Different data at the same index needs `getItemKey`, and a forced `measure()` then discards the new measurements; the same data in a new shape needs `measure()`.
- `scrollMargin` is the height of what sits above the list, re-measured as it moves and subtracted from the row transform.

## Rows

- Tags compare through `sameTagValue()` and display as spelt.
- A list component takes `source`, never a playlist id. Queueing goes through the source's `queueTargets`, since a library row is in no playlist.
