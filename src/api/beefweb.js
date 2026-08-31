import { TRACK_EXPRESSIONS } from '../playlist/fields.js'

// Columns are foobar2000 title-formatting expressions, evaluated by the player
// itself. Whatever goes in comes back positionally, so adding a field needs no
// support on beefweb's side.
//
// Multi-argument functions are unusable: the list is split on commas before the
// player evaluates it, so $if(a,b,c) arrives as three columns. Single-argument
// functions do nest -- $len($meta(unsynced lyrics)) works. See API.md.
export const TRACK_COLUMNS = ['%artist%', '%title%']

const encode = (expressions) => encodeURIComponent(expressions.join(','))

const nowPlayingColumns = encode(TRACK_COLUMNS)

// Change-driven stream: beefweb pushes on track change, pause, volume and
// playlist edits, not on a timer. Long silences are normal, not a stall.
export const UPDATES_URL = `/api/query/updates?player=true&playlists=true&trcolumns=${nowPlayingColumns}`

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

// Goes through /api/query rather than /api/player: the latter ignores
// trcolumns and hands back an empty columns array.
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

// Returns the raw positional column arrays rather than objects. One array of
// strings per track is markedly lighter than an object with a key per field at
// 30k+ rows, and it is the shape dictionary encoding will want later.
export async function fetchPlaylistItems(playlistId, offset, count, { signal } = {}) {
  const columns = encode(TRACK_EXPRESSIONS)
  const response = await request(
    `/api/playlists/${playlistId}/items/${offset}:${count}?columns=${columns}`,
    { signal },
  )
  const { playlistItems } = await response.json()
  return {
    rows: playlistItems.items.map((item) => item.columns),
    totalCount: playlistItems.totalCount,
    offset: playlistItems.offset,
  }
}

export const artworkUrl = (playlistId, index) => `/api/artwork/${playlistId}/${index}`

export const playPause = () => post('/api/player/play-pause')
export const nextTrack = () => post('/api/player/next')
export const previousTrack = () => post('/api/player/previous')
export const stop = () => post('/api/player/stop')
export const playItem = (playlistId, index) => post(`/api/player/play/${playlistId}/${index}`)
export const setPlayerState = (state) => post('/api/player', state)
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
export const addToPlayQueue = (playlistId, itemIndex) =>
  post('/api/playqueue/add', { plref: playlistId, itemIndex })

// Returns the new playlist, id included, so nothing has to guess which of the
// player's playlists just appeared.
export async function createPlaylist(title) {
  const response = await post(`/api/playlists/add?title=${encodeURIComponent(title)}`)
  return response.json()
}

// The three ways a playlist itself changes. Everything else Jean does to a
// playlist changes its *contents*; these change the playlist in the sidebar.
// A negative move index means "last", per the spec.
export const renamePlaylist = (playlistId, title) => post(`/api/playlists/${playlistId}`, { title })
export const removePlaylist = (playlistId) => post(`/api/playlists/remove/${playlistId}`)
export const movePlaylist = (playlistId, index) =>
  post(`/api/playlists/move/${playlistId}/${index}`)

// Copies by index, so a derived playlist costs no %path% lookup and no upload
// of anything but numbers. Measured: 15,000 indices in one request, 323 ms.
// `items` is often a typed array, which JSON.stringify would turn into an
// object -- hence the copy.
export const copyPlaylistItems = (sourceId, targetId, items) =>
  post(`/api/playlists/${sourceId}/${targetId}/items/copy`, { items: Array.from(items) })

// Maps the positional columns array back onto names.
export function readTrack(player) {
  const values = player?.activeItem?.columns
  if (!values?.length) return null
  const [artist, title] = values
  return { artist: artist || 'Unknown artist', title: title || 'Unknown title' }
}
