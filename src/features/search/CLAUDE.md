# Search

The library-wide search. How its results become playable is in
`src/domain/library/CLAUDE.md`.

**Search is a persistent, always-visible control** that is *also* bound to `⌘K` and `/`.
Not a keyboard shortcut with an icon added later — mobile has no keyboard, and an invisible
affordance means the feature does not exist there. On mobile it belongs within thumb reach.

**Search results shuffle too, because playing them makes them a real playlist.**
That was not true for a while and the button was removed: the order draws from
the active playlist, so shuffling a set of results started inside them and then
wandered the whole library. Materialising the results on play fixes the cause
rather than the symptom -- see *Search results are a view until you play them* in
`src/domain/library/CLAUDE.md`.
Without `permissions.changePlaylists` there is no playlist to make, so the
button goes again.
