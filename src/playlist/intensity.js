import { FIELD, number, timestamp } from './fields.js'

// How long since a track was last played before it reads as fully faded.
const PATINA_YEARS = 6
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000

// Play count and recency, precomputed into typed arrays.
//
// Heat is logarithmic because play counts are heavily skewed: on a linear scale
// almost every track sits at zero and one outlier takes the whole range. Patina
// applies only to tracks that were played at all -- a never-played track is
// flat, not faded, and dimming it would say something untrue about it.
export function deriveIntensity(rows) {
  const count = rows.length
  const heat = new Float32Array(count)
  const patina = new Float32Array(count)
  const playCounts = new Int32Array(count)

  let maxPlayCount = 0
  let playedCount = 0

  for (let index = 0; index < count; index += 1) {
    const plays = number(rows[index], FIELD.playCount) ?? 0
    playCounts[index] = plays
    if (plays > 0) {
      playedCount += 1
      if (plays > maxPlayCount) maxPlayCount = plays
    }
  }

  const ceiling = Math.log1p(maxPlayCount)
  const now = Date.now()

  for (let index = 0; index < count; index += 1) {
    const plays = playCounts[index]
    if (plays <= 0) continue

    heat[index] = ceiling > 0 ? Math.log1p(plays) / ceiling : 0

    const lastPlayed = timestamp(rows[index], FIELD.lastPlayed)
    if (lastPlayed !== null) {
      const years = (now - lastPlayed) / YEAR_MS
      patina[index] = Math.min(Math.max(years / PATINA_YEARS, 0), 1)
    }
  }

  return { heat, patina, maxPlayCount, playedCount }
}
