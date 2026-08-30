// Everything fetched for every track. Kept deliberately small: each entry is a
// string per row, and per-track-unique values are the expensive ones. %path% is
// absent on purpose -- it is the single largest field and tracks are addressed
// by playlist index, so it can be fetched on demand if a detail view needs it.
const FIELDS = [
  ['trackNumber', '%tracknumber%'],
  ['title', '%title%'],
  ['artist', '%artist%'],
  ['album', '%album%'],
  ['albumArtist', '%album artist%'],
  ['duration', '%length_seconds%'],
  ['playCount', '%lastfm_play_count%'],
  ['lastPlayed', '%lastfm_last_played%'],
  ['rating', '$meta(rating)'],
  ['year', '%year%'],
  ['genre', '%genre%'],
  ['codec', '%codec%'],
  ['bitrate', '%bitrate%'],
]

export const TRACK_EXPRESSIONS = FIELDS.map(([, expression]) => expression)

export const FIELD = Object.fromEntries(FIELDS.map(([name], index) => [name, index]))

// A field the player cannot resolve comes back as '?'. A field that resolves
// but is empty comes back as '' -- or 'N/A' from the playback-statistics
// component. That difference is the whole capability-detection mechanism, so it
// lives here rather than being re-derived at each call site.
const ABSENT = new Set(['?', '', 'N/A'])

export function value(row, field) {
  const raw = row[field]
  return raw === undefined || ABSENT.has(raw) ? null : raw
}

export function number(row, field) {
  const raw = value(row, field)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

// 'YYYY-MM-DD HH:MM:SS', with a trailing space from some components. The space
// separator is not reliably parsed by every engine, hence the swap for 'T'.
export function timestamp(row, field) {
  const raw = value(row, field)
  if (!raw) return null
  const parsed = Date.parse(raw.trim().replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : null
}

// Whether a field resolved at all, sampled across rows. Used to hide columns
// that depend on a component this player does not have.
export function fieldIsAvailable(rows, field, sampleSize = 200) {
  const step = Math.max(1, Math.floor(rows.length / sampleSize))
  for (let index = 0; index < rows.length; index += step) {
    if (rows[index][field] !== '?') return true
  }
  return false
}

// Tag values drift in case and spacing between files in the same album --
// '5 Seconds Of Summer' and '5 Seconds of Summer' are one artist, not two.
// Anything comparing tags to decide what the user sees should ignore that;
// anything displaying them should still show the original.
const normalise = (value) => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

export const sameTagValue = (a, b) => normalise(a) === normalise(b)
