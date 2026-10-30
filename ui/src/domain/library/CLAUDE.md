# The library

## The scratch playlist

- `foo_jean` answers the library, and no playlist stands in for it. On the player, playing a set fills the component's scratch playlist (`ui/src/shared/api/README.md`, *Playback*, says why), found by the role `foo_jean` marks (`jeanPlaylists.ts`) and never by its `#Jean` title; in a session nothing reads or writes it. A user's playlist titled `#Jean…` is shown like any other.
- The scratch holds the last set played, not what is on screen. Filling it, asking whether it is a given set and reading the player's index in it share one key, bound once in `useViewPlayback`.
- `Default Playlist` holds nothing of Jean's: selecting an album in foobar2000's library view replaces its contents.
- Browsing and playing write nothing to a user's playlist; only an explicit edit does.
- Row order is the snapshot's own. Re-sorting by a tag splits an album whose artist is spelt two ways.
- `isAutoPlaylist` from `foo_jean` only ever removes an affordance.

## Genres

- `genreQuery.ts` composes the one player query and owns its quoting; the component's preview, the only check, runs on foobar2000's main thread and goes through react-query, since a bare effect fires twice under StrictMode.
- A genre autoplaylist carries no `#Jean` prefix and no managed key, since a key makes it the component's to manage and a second one a `409`.
