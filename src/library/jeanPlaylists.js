// The playlists Jean owns, and the one namespace that says so.
//
// beefweb has no concept of a hidden or app-owned playlist, and it cannot be
// faked: every client sees the same list. So ownership is declared in the
// title. Anything beginning `#Jean` is Jean's plumbing rather than the user's
// music, and Jean is free to hide it, refill it or delete it. Anything else is
// the user's, shown under its real name and never reinterpreted.
//
// `#` is foobar's own idiom for a generated playlist -- these sort next to its
// `#Quicksearch [...]` in the player's sidebar, which is where the user meets
// them.
const PREFIX = '#Jean'

// ---- the library -----------------------------------------------------------
//
// An autoplaylist of the whole Media Library, which is the only way to see one
// at all on a player without the media library API. The user makes it in
// foobar -- there is no remote autoplaylist creation -- so Jean cannot mark it
// as its own at the point of creation. The name is how they hand it over.
//
// Matched exactly, and that is the point. This used to resolve by stored id,
// then by remembered title, then by any playlist loosely titled 'Library' --
// so a handful of production-music cues under that name was silently adopted
// as someone's entire collection, and every "N tracks in your library" after
// it was a lie. A name nobody types by accident replaces the guess, and there
// is nothing left to sanity-check.
export const LIBRARY_TITLE = `${PREFIX} Library`

export const isLibraryPlaylist = (playlist) => playlist?.title === LIBRARY_TITLE

export const findLibraryPlaylist = (playlists) => playlists.find(isLibraryPlaylist) ?? null

// What someone probably meant, for the setup screen to offer renaming. Only a
// suggestion -- it never resolves the library, because a near miss is exactly
// the guess this design removes.
export const looksLikeLibrary = (playlist) => {
  const title = playlist?.title?.trim().toLowerCase()
  return title === 'library' || title === LIBRARY_TITLE.toLowerCase()
}

// ---- the scratch -----------------------------------------------------------
//
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
// up. Round-trips exactly, including a query with brackets in it, because both
// ends are written here. The trailing `]` is also what keeps this from ever
// matching the library playlist.
const SCRATCH_PREFIX = `${PREFIX} [`
const SCRATCH_SUFFIX = ']'

// Which kind of view filled it, not just what it was called. `Most played` is a
// perfectly good thing to type into the search field as well as the name of a
// shelf, and the two produce entirely different sets -- so a reload that finds
// the scratch has to be able to tell which one it is looking at. The kind is
// the only thing here Jean could not otherwise recover.
export const SCRATCH_KIND = { search: 'search', shelf: 'shelf', all: 'all music' }

// All Music is the one set with no label: there is only one of it, so the kind
// is the whole of its name. Everything else is named by the thing the user
// chose -- the shelf's title, the query they typed. Kept here rather than in
// the view because the sidebar, the status bar and the view itself all have to
// call it the same thing, and the scratch playlist is what they read it from.
export const ALL_MUSIC = 'All music'

// What to call the set on screen. Null when the title carries no name at all,
// which is not a set anybody chose and is nothing to announce.
export const scratchName = (held) =>
  held?.kind === SCRATCH_KIND.all ? ALL_MUSIC : (held?.label || null)

export const scratchTitle = (kind, label) =>
  `${SCRATCH_PREFIX}${label ? `${kind}: ${label}` : kind}${SCRATCH_SUFFIX}`

export const isScratchPlaylist = (playlist) =>
  Boolean(playlist) &&
  playlist.title.startsWith(SCRATCH_PREFIX) &&
  playlist.title.endsWith(SCRATCH_SUFFIX)

// Split on the *first* separator, so a query with a colon in it round-trips.
export function scratchContentsOf(playlist) {
  if (!isScratchPlaylist(playlist)) return null
  const body = playlist.title.slice(SCRATCH_PREFIX.length, -SCRATCH_SUFFIX.length)
  const at = body.indexOf(': ')
  return at === -1 ? { kind: body, label: '' } : { kind: body.slice(0, at), label: body.slice(at + 2) }
}

// Only a search can be taken back into the field. A shelf is restored by
// opening the shelf, which is a route rather than a query.
export function queryOfScratchPlaylist(playlist) {
  const held = scratchContentsOf(playlist)
  return held && held.kind === SCRATCH_KIND.search ? held.label : null
}

// ---- the namespace ---------------------------------------------------------

export const isJeanPlaylist = (playlist) => Boolean(playlist?.title?.startsWith(PREFIX))

// Everything the user can browse to. Jean's own playlists are not furniture:
// they are not in the sidebar, not in the command palette, and not somewhere a
// route can land -- the library because browsing it is a feature Jean has not
// built yet and must not back into by accident, the scratch because landing on
// it would show a set of results stripped of the search that made them.
export const withoutJeanPlaylists = (playlists) => playlists.filter((entry) => !isJeanPlaylist(entry))
