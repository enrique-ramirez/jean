import { fold } from '../ui/text.js'
import { FIELD, sameTagValue, value } from './fields.js'

// One folded haystack per row so a keystroke costs a single includes() call
// instead of several case conversions. That is a per-track-unique string, which
// is exactly what the loading rules say to avoid holding -- so it is only ever
// built for a list someone is actually searching.
//
// Folded, not merely lowercased: accents are normalised away here and in the
// query, so `babasonicos` finds `Babasónicos`. Doing it at build time is what
// keeps it free -- the comparison itself never changes.
//
// The album artist is merged in only when it differs from the track artist:
// on most rows it is the same string twice, and at library size that repetition
// is the difference between an index worth keeping and one worth regretting.
export function rowHaystack(row) {
  const artist = value(row, FIELD.artist)
  const albumArtist = value(row, FIELD.albumArtist)

  return fold(
    [
      value(row, FIELD.title),
      artist,
      sameTagValue(artist, albumArtist) ? null : albumArtist,
      value(row, FIELD.album),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

// Every token has to appear somewhere in the row, in any order: 'wilco yankee'
// finds a track whose title and artist each supply half the query. Substrings
// rather than whole words, so partial typing narrows as you go.
export const tokenize = (query) => fold(query.trim()).split(/\s+/).filter(Boolean)

export function haystackMatches(haystack, tokens) {
  for (let token = 0; token < tokens.length; token += 1) {
    if (!haystack.includes(tokens[token])) return false
  }
  return true
}
