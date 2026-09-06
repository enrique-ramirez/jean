# Search

The library-wide search control. How its results become playable is in `src/domain/library/CLAUDE.md`; find-in-list is a different feature and lives in `src/domain/track/`.

**Search is a persistent, always-visible control** that is *also* bound to `Mod+K`. It cannot be a keyboard shortcut with an icon added later: mobile has no keyboard, and an invisible affordance means the feature does not exist there. On mobile it belongs within thumb reach.

**Search results shuffle, since playing them makes them a real playlist.** Playback order draws from the active playlist, so shuffling results that were never materialised starts inside them and then wanders the whole library. Materialising on play fixes the cause rather than the symptom.

**Without `permissions.changePlaylists` there is no playlist to make**, so the Shuffle button is not drawn.
