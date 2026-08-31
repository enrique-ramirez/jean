// Search results, made real so the player can play them.
//
// beefweb plays from playlists and knows nothing else. Playing a result in
// place -- by its index in the library playlist -- means the player carries on
// from there: the next track is the library's next track, and with shuffle on
// it is a random one out of everything. Neither is what a list of matches on
// screen promises. So when someone plays from a set of results, the results
// become an actual playlist and playback happens inside it. Then every playback
// order means what it says: Default stops at the end of the results, Repeat
// loops them, Shuffle shuffles them.
//
// One playlist, reused, rather than one per search. Reusing it avoids id churn,
// avoids ever deleting something that is currently playing, and means the
// player's copy of it is the single shared answer to "what is Jean playing" --
// which is what makes it legible from another device.
//
// The title carries the query so the thing is self-describing wherever it turns
// up: in foobar's own sidebar, next to its `#Quicksearch [...]` playlists, and
// in any other client. Round-trips exactly, including a query with brackets in
// it, because both ends are written here.
const PREFIX = '#Jean ['
const SUFFIX = ']'

export const scratchTitle = (query) => `${PREFIX}${query}${SUFFIX}`

export const isScratchPlaylist = (playlist) =>
  Boolean(playlist) && playlist.title.startsWith(PREFIX) && playlist.title.endsWith(SUFFIX)

export const queryOfScratchPlaylist = (playlist) =>
  isScratchPlaylist(playlist) ? playlist.title.slice(PREFIX.length, -SUFFIX.length) : null

export const withoutScratchPlaylists = (playlists) =>
  playlists.filter((entry) => !isScratchPlaylist(entry))
