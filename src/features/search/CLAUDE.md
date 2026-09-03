# Search

The library-wide search. How its results become playable is in `src/domain/library/CLAUDE.md`.

**Search is a persistent, always-visible control** that is *also* bound to `Mod+K` and `/`. Not a keyboard shortcut with an icon added later: mobile has no keyboard, and an invisible affordance means the feature does not exist there. On mobile it belongs within thumb reach.

**Search results shuffle, because playing them makes them a real playlist.** Playback order draws from the active playlist, so shuffling results that were never materialised starts inside them and then wanders the whole library. Materialising on play fixes the cause rather than the symptom.

**Without `permissions.changePlaylists` there is no playlist to make**, so the Shuffle button is not drawn.
