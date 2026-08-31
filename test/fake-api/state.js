import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name) => JSON.parse(readFileSync(join(HERE, name), 'utf8'))

const LIBRARY = read('library.json')
const CAPTURED_PLAYER = read('player.json')

// beefweb reports index -1 rather than omitting activeItem when nothing is
// playing. API.md, and the app tests `index >= 0` for exactly this reason.
const IDLE_ITEM = {
  columns: [],
  duration: -1,
  index: -1,
  playlistId: '',
  playlistIndex: -1,
  position: -1,
}

const tracksOf = (album) => LIBRARY.albums.find((entry) => entry.slug === album)?.tracks ?? []
const allTracks = () => LIBRARY.albums.flatMap((album) => album.tracks)

// Ids are deliberately not contiguous and not in index order. That is what the
// real install looks like -- creating one playlist there produced p7, not p6 --
// and anything in the app that quietly assumes otherwise should fail here
// rather than on someone's machine.
// A library-sized playlist, synthesised from the captured tracks. The point is
// not the metadata -- it is that 30,000 rows arrive in chunks rather than in one
// response, that the virtualiser is never holding more than a screenful, and
// that scroll offsets are computed over a list far taller than anything a
// hand-written fixture produces. Bugs that only appear past a few thousand rows
// have nowhere else to show up.
export function generateTracks(count) {
  const source = allTracks()
  const tracks = new Array(count)
  for (let index = 0; index < count; index += 1) {
    const template = source[index % source.length]
    tracks[index] = {
      ...template,
      '%title%': `${template['%title%']} (${index + 1})`,
      '%tracknumber%': String((index % 99) + 1).padStart(2, '0'),
      '%path%': `${template['%path%']}#${index}`,
    }
  }
  return tracks
}

const DEFAULT_PLAYLISTS = () => [
  { id: 'p1', title: 'Default Playlist', isCurrent: false, items: tracksOf('jar-of-flies').slice(0, 4) },
  { id: 'p7', title: 'Library', isCurrent: true, items: allTracks() },
  {
    id: 'p2',
    title: 'Favorites',
    isCurrent: false,
    items: [
      ...tracksOf('deja-entendu').slice(0, 3),
      ...tracksOf('jessico').slice(0, 2),
      ...tracksOf('deathconsciousness').slice(0, 2),
    ],
  },
  { id: 'p5', title: 'Rock en Español', isCurrent: false, items: tracksOf('jessico') },
]

// An expression the player cannot resolve comes back as '?'; one that resolves
// to nothing comes back as ''. The difference is the whole capability-detection
// mechanism, so the fake has to reproduce it rather than return '' for both --
// a fixture that drops %lastfm_play_count% is an install without the playback
// statistics component, and the UI should hide the heat controls accordingly.
export const evaluate = (track, expression) => track[expression] ?? '?'

const columnsFor = (track, expressions) => expressions.map((expression) => evaluate(track, expression))

export function createState({
  playlists = DEFAULT_PLAYLISTS(),
  player,
  librarySize,
  // Expressions this player cannot resolve. Dropping them from the tracks makes
  // evaluate() answer '?', which is exactly what a real player does for a field
  // no component provides -- so `withoutFields: ['%lastfm_play_count%']` is an
  // install with no playback-statistics component, not a mock of one.
  withoutFields = [],
  // Tag values the capture does not happen to carry, keyed by track title. One
  // person's library is not every library: this one has no featured artist and
  // no compilation on it, and neither is worth a sixth album of invented
  // fixture. Stating the tag a test needs keeps everything else captured.
  retagged = {},
} = {}) {
  const patches = Object.entries(retagged)
  if (patches.length > 0) {
    const byTitle = new Map(patches)
    for (const playlist of playlists) {
      playlist.items = playlist.items.map((track) => {
        const patch = byTitle.get(track['%title%'])
        return patch ? { ...track, ...patch } : track
      })
    }
  }

  if (withoutFields.length > 0) {
    const drop = new Set(withoutFields)
    for (const playlist of playlists) {
      playlist.items = playlist.items.map((track) => {
        const kept = { ...track }
        for (const expression of drop) delete kept[expression]
        return kept
      })
    }
  }

  if (librarySize) {
    const library = playlists.find((entry) => entry.title === 'Library')
    if (library) library.items = generateTracks(librarySize)
  }

  const listeners = new Set()

  const state = {
    playlists,
    // Volume and playback order come off the real player; what is playing does
    // not, because the captured track is not in the fixture. Idle is also the
    // honest starting point for a test: nothing has happened yet.
    player: {
      ...structuredClone(CAPTURED_PLAYER),
      playbackState: 'stopped',
      activeItem: { ...IDLE_ITEM },
      ...player,
    },
    playQueue: [],
    // Milliseconds to hold a write before answering. Zero by default, because
    // the fake is otherwise faster than a pointer can move -- which hides
    // exactly the behaviour that matters about a coalesced write. See
    // POST /__control/latency.
    latency: 0,
    // Every request the app made, in order. Lets a test assert what went over
    // the wire -- that a drag sent one items/copy and not forty, that a
    // coalesced write sent the last value rather than every value.
    requests: [],
  }

  // beefweb pushes on change and never on a timer, so this deliberately has no
  // interval behind it. Position advances in the app's own interpolation; if
  // the fake ticked, tests would pass against behaviour the real player does
  // not have.
  const notify = (changed) => {
    const message = {}
    if (changed.player) message.player = true
    if (changed.playlists) message.playlists = true
    for (const listener of listeners) listener(message)
  }

  const byId = (id) => state.playlists.find((entry) => entry.id === id) ?? null

  const setActive = (playlist, index, playbackState) => {
    const track = playlist.items[index]
    if (!track) return
    state.player.activeItem = {
      columns: [],
      duration: Number(evaluate(track, '%length_seconds%')) || 0,
      index,
      playlistId: playlist.id,
      playlistIndex: state.playlists.indexOf(playlist),
      position: 0,
    }
    state.player.playbackState = playbackState
    // Playing from a playlist makes it the current one, exactly as the player
    // does. The sidebar's "Playing from" marker depends on it.
    for (const entry of state.playlists) entry.isCurrent = entry === playlist
    notify({ player: true, playlists: true })
  }

  const step = (delta) => {
    const item = state.player.activeItem
    const playlist = byId(item.playlistId)
    if (!playlist || item.index < 0) return
    const next = item.index + delta
    if (next < 0 || next >= playlist.items.length) return
    setActive(playlist, next, 'playing')
  }

  return {
    // Named rather than spread: every mutation below works in place, so these
    // references stay live, but a spread would also have copied `playlists`
    // and quietly detached it the first time something reassigned the array.
    player: state.player,
    playQueue: state.playQueue,
    requests: state.requests,
    get playlists() {
      return state.playlists
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    record(method, path, body) {
      state.requests.push({ method, path, body })
    },

    playlistById: byId,

    // The six fields PlaylistInfo actually has -- no more, so that anything
    // reaching for an autoplaylist flag finds nothing here either.
    // totalTime is 0 because the real player returns 0: measured, not guessed.
    playlistsPayload: () =>
      state.playlists.map((entry, index) => ({
        id: entry.id,
        index,
        isCurrent: entry.isCurrent,
        itemCount: entry.items.length,
        title: entry.title,
        totalTime: 0,
      })),

    playerPayload(trcolumns = []) {
      const item = state.player.activeItem
      const playlist = item.index >= 0 ? byId(item.playlistId) : null
      const track = playlist?.items[item.index]
      return {
        ...state.player,
        activeItem: { ...item, columns: track ? columnsFor(track, trcolumns) : [] },
      }
    },

    itemsPayload(playlistId, offset, count, expressions) {
      const playlist = byId(playlistId)
      if (!playlist) return null
      const slice = playlist.items.slice(offset, offset + count)
      return {
        playlistItems: {
          offset,
          totalCount: playlist.items.length,
          items: slice.map((track) => ({ columns: columnsFor(track, expressions) })),
        },
      }
    },

    artworkFor(playlistId, index) {
      const track = byId(playlistId)?.items[index]
      if (!track) return null
      const album = LIBRARY.albums.find((entry) =>
        entry.tracks.some((candidate) => candidate['%path%'] === track['%path%']),
      )
      return album?.artwork ?? null
    },

    playItem(playlistId, index) {
      const playlist = byId(playlistId)
      if (playlist) setActive(playlist, index, 'playing')
    },

    playPause() {
      const { playbackState, activeItem } = state.player
      if (playbackState === 'stopped') {
        // Stopped-then-play resumes the current playlist from the top, which is
        // what foobar does with no active item.
        const playlist = state.playlists.find((entry) => entry.isCurrent) ?? state.playlists[0]
        if (playlist?.items.length) setActive(playlist, Math.max(activeItem.index, 0), 'playing')
        return
      }
      state.player.playbackState = playbackState === 'playing' ? 'paused' : 'playing'
      notify({ player: true })
    },

    stop() {
      state.player.playbackState = 'stopped'
      state.player.activeItem = { ...IDLE_ITEM }
      notify({ player: true })
    },

    next: () => step(1),
    previous: () => step(-1),

    patchPlayer(body = {}) {
      const item = state.player.activeItem
      if (body.position != null) item.position = body.position
      if (body.relativePosition != null) {
        item.position = Math.min(Math.max(item.position + body.relativePosition, 0), item.duration)
      }
      if (body.volume != null) state.player.volume.value = body.volume
      if (body.isMuted != null) state.player.volume.isMuted = body.isMuted
      if (body.playbackState) state.player.playbackState = body.playbackState
      for (const option of body.options ?? []) {
        const target = state.player.options.find((entry) => entry.id === option.id)
        if (target) target.value = option.value
        if (option.id === 'playbackOrder') state.player.playbackMode = option.value
      }
      notify({ player: true })
    },

    nudgeVolume(delta) {
      const { volume } = state.player
      volume.value = Math.min(Math.max(volume.value + delta, volume.min), volume.max)
      notify({ player: true })
    },

    addPlaylist(title) {
      // Ids keep climbing and are never reused, as the player's do.
      const used = state.playlists.map((entry) => Number(entry.id.slice(1)))
      const id = `p${Math.max(0, ...used) + 1}`
      const playlist = { id, title: title || 'New playlist', isCurrent: false, items: [] }
      state.playlists.push(playlist)
      notify({ playlists: true })
      return { id, index: state.playlists.length - 1, isCurrent: false, itemCount: 0, title: playlist.title, totalTime: 0 }
    },

    renamePlaylist(id, title) {
      const playlist = byId(id)
      if (!playlist) return false
      playlist.title = title
      notify({ playlists: true })
      return true
    },

    removePlaylist(id) {
      const at = state.playlists.findIndex((entry) => entry.id === id)
      if (at < 0) return false
      state.playlists.splice(at, 1)
      notify({ playlists: true })
      return true
    },

    movePlaylist(id, index) {
      const from = state.playlists.findIndex((entry) => entry.id === id)
      if (from < 0) return false
      const [moved] = state.playlists.splice(from, 1)
      // A negative index means last, per the spec.
      state.playlists.splice(index < 0 ? state.playlists.length : index, 0, moved)
      notify({ playlists: true })
      return true
    },

    copyItems(sourceId, targetId, indices) {
      const source = byId(sourceId)
      const target = byId(targetId)
      if (!source || !target) return false
      // Appended without a duplicate check, because the player appends without
      // one. Undo is what makes that safe, and undo is what the tests exercise.
      target.items.push(...indices.map((index) => source.items[index]).filter(Boolean))
      notify({ playlists: true })
      return true
    },

    removeItems(playlistId, indices) {
      const playlist = byId(playlistId)
      if (!playlist) return false
      const drop = new Set(indices)
      playlist.items = playlist.items.filter((_, index) => !drop.has(index))
      notify({ playlists: true })
      return true
    },

    queueAdd(entry) {
      state.playQueue.push(entry)
      notify({ player: true })
    },

    queueClear() {
      state.playQueue.length = 0
      notify({ player: true })
    },
  }
}

export { DEFAULT_PLAYLISTS, LIBRARY, tracksOf, allTracks }
