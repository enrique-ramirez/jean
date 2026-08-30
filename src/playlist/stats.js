import { FIELD, number, value } from './fields.js'

const TOP_GENRES = 4

// A portrait of the playlist, computed from the rows already in memory. No
// extra requests: everything here is a single pass over what the list is
// already holding.
export function summarise(rows, playedCount) {
  let seconds = 0
  let earliest = null
  let latest = null
  const genres = new Map()

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]

    seconds += number(row, FIELD.duration) ?? 0

    const year = number(row, FIELD.year)
    if (year !== null && year > 1000) {
      if (earliest === null || year < earliest) earliest = year
      if (latest === null || year > latest) latest = year
    }

    const genre = value(row, FIELD.genre)
    if (genre) genres.set(genre, (genres.get(genre) ?? 0) + 1)
  }

  const topGenres = [...genres.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_GENRES)
    .map(([name, count]) => ({ name, share: Math.round((count / rows.length) * 100) }))

  return {
    trackCount: rows.length,
    seconds,
    earliest,
    latest,
    topGenres,
    playedShare: rows.length > 0 ? playedCount / rows.length : 0,
  }
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ${hours} hr`
  if (hours > 0) return `${hours} hr ${minutes} min`
  return `${minutes} min`
}
