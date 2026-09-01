import { useCallback, useMemo, useState } from 'react'

import { usePermissions } from '../player/usePlayer.js'
import { libraryKey, playlistKey } from '../playlist/playlistStore.js'
import { usePlaylistItems } from '../playlist/usePlaylistItems.js'
import { findLibraryPlaylist } from './jeanPlaylists.js'
import { librarySourceOf } from './librarySource.js'
import { useLibraryItems } from './useLibraryItems.js'
import { useLibraryInfo } from './useLibrarySource.js'

// The library, as one array in memory. Every view over it -- search, all music,
// a shelf on the home screen -- is a filter producing a list of refs into this,
// which is why it lives here rather than inside any one of them. Search used to
// own it, and that was backwards: a subset cannot be the home of the whole.
//
// Two places it can come from. The media library API when the player has one,
// the autoplaylist otherwise -- DeaDBeeF, and every beefweb up to 0.10. Both
// load through the same store and produce the same rows; what differs is how a
// row is addressed afterwards, which is what `source` carries.
export function useLibrary(playlists, { wanted = false } = {}) {
  const permissions = usePermissions()
  const { hasLibraryApi, info } = useLibraryInfo()

  // Megabytes, and most sessions never need it. Nothing is fetched until a view
  // that shows the library is open, or something asks. `request` exists because
  // the search field is the one consumer that cannot be known from the route --
  // reaching for it is the ask.
  const [requested, setRequested] = useState(false)
  const request = useCallback(() => setRequested(true), [])
  const isWanted = wanted || requested

  const canWrite = permissions.changePlaylists !== false

  // Resolved only when it could actually be used. With a library API and the
  // permission to make a scratch playlist, the autoplaylist is never read --
  // and resolving one anyway is what had the idle screen announce "30,441
  // tracks in Library" while every row on screen came from the media library.
  //
  // The exception is the reason it is not simply dropped: playing a set always
  // needs a playlist to play it *in*, and there is no "play this library item".
  // On a player that refuses playlist writes the API can browse but never play,
  // while an autoplaylist can still be played in place. So it is still looked
  // for there, and preferred.
  const playlist = useMemo(
    () => (hasLibraryApi && canWrite ? null : findLibraryPlaylist(playlists)),
    [hasLibraryApi, canWrite, playlists],
  )
  const useApi = hasLibraryApi && (canWrite || !playlist)

  const viaApi = useLibraryItems(isWanted && useApi ? info.itemCount : null)
  const viaPlaylist = usePlaylistItems(
    isWanted && !useApi ? playlist?.id : null,
    isWanted && !useApi ? playlist?.itemCount : null,
  )
  const library = useApi ? viaApi : viaPlaylist

  // Keyed per source, and carrying the count either way, so an edited library
  // indexes afresh rather than inheriting rows that have moved.
  const key = useApi
    ? libraryKey(info.itemCount)
    : playlist
      ? playlistKey(playlist.id, playlist.itemCount)
      : null

  // How to act on a row. The list machinery never sees this -- it holds integer
  // refs and nothing else -- but everything that plays, copies or draws artwork
  // goes through it.
  const source = useMemo(
    () =>
      useApi
        ? librarySourceOf({ kind: 'library', paths: library.paths, subsongs: library.subsongs })
        : librarySourceOf({ kind: 'playlist', playlistId: playlist?.id }),
    [useApi, library.paths, library.subsongs, playlist?.id],
  )

  return {
    ...library,
    key,
    source,
    playlist,
    request,
    isWanted,
    canWrite,
    // What to say before anything is loaded. `total` is the load's own
    // denominator and stays zero until a load starts, so it cannot answer "how
    // big is my library". Both sources can state that up front.
    count: useApi ? info.itemCount : (playlist?.itemCount ?? 0),
    // The setup screen is for players with no library API. With one, there is
    // nothing to point Jean at and nothing to ask the user for.
    needsSetup: !useApi && !playlist,
  }
}
