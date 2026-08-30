// Columns are foobar2000 title-formatting expressions, evaluated by the player
// itself. Whatever you put here comes back in `activeItem.columns`, in order — so
// adding %album%, %codec% or $upper(%artist%) is a one-line change, no API support
// needed on beefweb's side.
//
// Multi-argument functions are not usable: this list is split on commas before the
// player evaluates it, so $if(a,b,c) arrives as three separate columns. See API.md.
export const TRACK_COLUMNS = ['%artist%', '%title%']

const columns = encodeURIComponent(TRACK_COLUMNS.join(','))

// Change-driven stream: beefweb pushes on track change, pause, volume — not on
// a timer. Expect long silences while a track plays. That is not a stall.
export const UPDATES_URL = `/api/query/updates?player=true&trcolumns=${columns}`

/**
 * Cold-start / reconnect snapshot.
 *
 * Note this goes through /api/query rather than /api/player: the latter ignores
 * `trcolumns` and hands back an empty columns array.
 */
export async function fetchPlayer() {
  const response = await fetch(`/api/query?player=true&trcolumns=${columns}`)
  if (!response.ok) throw new Error(`GET /api/query failed: ${response.status}`)
  const { player } = await response.json()
  return player
}

/** Toggles play/pause, and resumes from a stopped state. */
export async function playPause() {
  const response = await fetch('/api/player/play-pause', { method: 'POST' })
  if (!response.ok) throw new Error(`POST /api/player/play-pause failed: ${response.status}`)
}

/** Maps the positional columns array back onto names. */
export function readTrack(player) {
  const values = player?.activeItem?.columns
  if (!values?.length) return null
  const [artist, title] = values
  return { artist: artist || 'Unknown artist', title: title || 'Unknown title' }
}
