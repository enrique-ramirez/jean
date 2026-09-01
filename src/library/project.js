// A view of the library is a list of refs into it, projected onto the arrays
// the track list already speaks. Every view goes through here -- search, all
// music, a shelf -- so they cannot drift into different shapes.
//
// Heat and patina come across from the library-wide pass rather than being
// recomputed over the subset, so a track's warmth means the same thing in a
// shelf as it does in the whole library.
export function project(library, refs) {
  if (!refs) return null

  const heat = Float32Array.from(refs, (ref) => library.heat[ref])

  return {
    rows: Array.from(refs, (ref) => library.rows[ref]),
    indices: refs,
    heat,
    patina: Float32Array.from(refs, (ref) => library.patina[ref]),
    playedCount: heat.reduce((played, warmth) => played + (warmth > 0 ? 1 : 0), 0),
  }
}

// The unfiltered view, which is every row in order. Deliberately not projected:
// the arrays are already exactly right, and copying the library to produce a
// copy of itself is the one filter that can afford to do nothing.
export const wholeLibrary = (library) => ({
  rows: library.rows,
  indices: Int32Array.from({ length: library.rows.length }, (_, index) => index),
  heat: library.heat,
  patina: library.patina,
  playedCount: library.playedCount ?? 0,
})

// Nothing at all, in the shape every view has. Shared so the empty state and a
// real one cannot disagree about what a view is.
export const EMPTY_VIEW = Object.freeze({
  rows: [],
  indices: new Int32Array(0),
  heat: new Float32Array(0),
  patina: new Float32Array(0),
  playedCount: 0,
})
