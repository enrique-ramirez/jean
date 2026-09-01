import { TRACK_EXPRESSIONS } from '../playlist/fields.js'

// Columns are foobar2000 title-formatting expressions, evaluated by the player,
// and whatever goes in comes back positionally -- so adding a field needs no
// support on beefweb's side. Multi-argument functions are unusable: the list is
// split on commas before evaluation, so $if(a,b,c) arrives as three columns.
// Single-argument functions do nest. See API.md.
//
// %path% and %subsong% are here for identity, not display: playlist items have
// no id, so "is this row the track that is playing" was only answerable while
// the player happened to be inside a playlist Jean could map. This is the
// active item only -- one string per player update, not per row -- which is why
// the "never hold per-track-unique strings" rule does not apply.
const TRACK_COLUMNS = ['%artist%', '%title%', '%path%', '%subsong%']

const encode = (expressions) => encodeURIComponent(expressions.join(','))

const nowPlayingColumns = encode(TRACK_COLUMNS)

// Change-driven stream: beefweb pushes on track change, pause, volume and
// playlist edits, not on a timer. Long silences are normal, not a stall.
export const UPDATES_URL = `/api/query/updates?player=true&playlists=true&trcolumns=${nowPlayingColumns}`

// Ids come from the player rather than from the user, but they are still
// interpolated into a URL, and a path that escapes its segment would address a
// different endpoint entirely.
const id = encodeURIComponent

async function request(path, options) {
  const response = await fetch(path, options)
  if (!response.ok) throw new Error(`${options?.method ?? 'GET'} ${path} failed: ${response.status}`)
  return response
}

const post = (path, body) =>
  request(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

// Through /api/query rather than /api/player: the latter ignores trcolumns and
// hands back an empty columns array.
export async function fetchPlayer() {
  const response = await request(`/api/query?player=true&trcolumns=${nowPlayingColumns}`)
  const { player } = await response.json()
  return player
}

export async function fetchPlaylists() {
  const response = await request('/api/playlists')
  const { playlists } = await response.json()
  return playlists
}

// Returns the raw positional column arrays rather than objects: one array of
// strings per track is markedly lighter at 30k+ rows, and it is the shape
// dictionary encoding will want later.
export async function fetchPlaylistItems(playlistId, offset, count, { signal } = {}) {
  const response = await request(
    `/api/playlists/${id(playlistId)}/items/${offset}:${count}?columns=${encode(TRACK_EXPRESSIONS)}`,
    { signal },
  )
  const { playlistItems } = await response.json()
  return {
    rows: playlistItems.items.map((item) => item.columns),
    totalCount: playlistItems.totalCount,
    offset: playlistItems.offset,
  }
}

export const artworkUrl = (playlistId, index) => `/api/artwork/${id(playlistId)}/${index}`

// ---- media library (beefweb 0.11+) ----------------------------------------
//
// Absent before 0.11 and on DeaDBeeF, where every endpoint below answers 501.
// `fetchLibraryInfo` is the one that always answers, because it is how a client
// finds out which of those it is talking to.

export async function fetchLibraryInfo() {
  const response = await fetch('/api/library/info')
  // A released beefweb has no such route at all. Same answer as 501: no library
  // here, fall back to the autoplaylist.
  if (response.status === 404 || response.status === 501) {
    return { supported: false, enabled: false, itemCount: 0 }
  }
  if (!response.ok) throw new Error(`GET /api/library/info failed: ${response.status}`)
  const { library } = await response.json()
  return library
}

// Both sides of the library have to name the same order, and this is the name.
// The endpoint's default *is* file path, so passing it changes nothing on its
// own; it is here so the sort Jean applies to a playlist it has just filled is
// demonstrably the same expression as the order it read, rather than two
// defaults that happen to agree today. See `librarySource.js`.
export const LIBRARY_SORT = '%path%'

export async function fetchLibraryItems({ offset, count, signal }) {
  const range = count == null ? '' : `&range=${offset}:${count}`
  const response = await request(
    `/api/library/items?columns=${encode(TRACK_EXPRESSIONS)}&sort=${encodeURIComponent(LIBRARY_SORT)}${range}`,
    { signal },
  )
  const { libraryItems } = await response.json()
  return libraryItems
}

export const libraryArtworkUrl = (path, subsong) =>
  `/api/artwork/library?path=${encodeURIComponent(path)}` + (subsong ? `&subsong=${subsong}` : '')

// `items` rather than `query`: the player's query syntax and Jean's fold()-based
// matching do not return the same set, so adding by query would add tracks that
// are not the ones on screen.
export const addFromLibrary = (playlistId, body) =>
  post(`/api/playlists/${id(playlistId)}/items/add-from-library`, body)

export const sortPlaylistItems = (playlistId, by) =>
  post(`/api/playlists/${id(playlistId)}/items/sort`, { by })

export const playPause = () => post('/api/player/play-pause')
export const nextTrack = () => post('/api/player/next')
export const previousTrack = () => post('/api/player/previous')
export const stop = () => post('/api/player/stop')
export const playItem = (playlistId, index) => post(`/api/player/play/${id(playlistId)}/${index}`)
export const seekTo = (position) => post('/api/player', { position })
export const seekBy = (offset) => post('/api/player', { relativePosition: offset })
export const setVolume = (volume) => post('/api/player', { volume })
export const setMuted = (isMuted) => post('/api/player', { isMuted })

// The player owns the step size for these, which is why they are endpoints
// rather than a relativeVolume value picked here.
export const volumeUp = () => post('/api/player/volume/up')
export const volumeDown = () => post('/api/player/volume/down')

// playbackMode is deprecated in the spec; the options array is the current form.
export const setPlaybackOrder = (value) =>
  post('/api/player', { options: [{ id: 'playbackOrder', value }] })

// Returns the new playlist, id included, so nothing has to guess which of the
// player's playlists just appeared.
export async function createPlaylist(title) {
  const response = await post(`/api/playlists/add?title=${encodeURIComponent(title)}`)
  return response.json()
}

// The three ways a playlist itself changes, as opposed to its contents. A
// negative move index means "last", per the spec.
export const renamePlaylist = (playlistId, title) =>
  post(`/api/playlists/${id(playlistId)}`, { title })
export const removePlaylist = (playlistId) => post(`/api/playlists/remove/${id(playlistId)}`)
export const movePlaylist = (playlistId, index) =>
  post(`/api/playlists/move/${id(playlistId)}/${index}`)

// Copies by index, so a derived playlist costs no %path% lookup and uploads
// nothing but numbers, at any size. `items` is often a typed array, which
// JSON.stringify would turn into an object -- hence the copy.
export const copyPlaylistItems = (sourceId, targetId, items) =>
  post(`/api/playlists/${id(sourceId)}/${id(targetId)}/items/copy`, { items: Array.from(items) })

// Index is identity, so this only means anything against a list nobody has
// touched since the indices were worked out. See useAddTracks for the check.
export const removePlaylistItems = (playlistId, items) =>
  post(`/api/playlists/${id(playlistId)}/items/remove`, { items: Array.from(items) })

// Maps the positional columns array back onto names.
export function readTrack(player) {
  const values = player?.activeItem?.columns
  if (!values?.length) return null
  const [artist, title, path, subsong] = values
  return {
    artist: artist || 'Unknown artist',
    title: title || 'Unknown title',
    path: path || null,
    subsong: Number(subsong) || 0,
  }
}

// The player reports an absolute path (`F:\Musica\K\Korn\...`); the media
// library reports one relative to the library folders, forward-slashed
// (`K/Korn/...`). Jean is never told where those folders are, so the two are
// matched by suffix rather than by reconstructing the root -- a relative path
// is unique within the library, so a suffix match cannot collide.
//
// A matcher rather than a two-argument predicate, because the only caller asks
// the same question of every path in the library in a row.
export function libraryPathMatcher(absolute) {
  if (!absolute) return () => false
  const flat = absolute.replaceAll('\\', '/')
  return (relative) => Boolean(relative) && (flat === relative || flat.endsWith(`/${relative}`))
}
