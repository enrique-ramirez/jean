// A view of the library is a list of refs into it, projected onto the arrays the
// track list already speaks. Every view goes through here -- search, all music,
// a shelf -- so they cannot drift into different shapes.
//
// Heat and patina come across from the library-wide pass rather than being
// recomputed over the subset, so a track's warmth means the same thing in a
// shelf as it does in the whole library.
export function project(library, refs) {
  if (!refs) return null

  const rows = new Array(refs.length)
  const heat = new Float32Array(refs.length)
  const patina = new Float32Array(refs.length)
  let playedCount = 0

  for (let position = 0; position < refs.length; position += 1) {
    const ref = refs[position]
    rows[position] = library.rows[ref]
    heat[position] = library.heat[ref]
    patina[position] = library.patina[ref]
    if (library.heat[ref] > 0) playedCount += 1
  }

  return { rows, indices: refs, heat, patina, playedCount }
}

// The unfiltered view, which is every row in order. Deliberately not projected:
// the arrays are already exactly right, and copying 30,000 rows to produce a
// copy of itself is the one filter that can afford to do nothing.
export function wholeLibrary(library) {
  const indices = new Int32Array(library.rows.length)
  for (let index = 0; index < indices.length; index += 1) indices[index] = index

  return {
    rows: library.rows,
    indices,
    heat: library.heat,
    patina: library.patina,
    playedCount: library.playedCount ?? 0,
  }
}
