import { haystackMatches, rowHaystack, tokenize } from '../playlist/searchText.js'

const indexes = new Map()

// Rows only ever grow -- appended a chunk at a time -- so the index extends in
// place instead of being rebuilt for every chunk that lands. Rebuilding is O(n)
// per chunk, and the library is the one list where that arithmetic bites.
//
// The key carries the item count, so an edited library indexes afresh rather
// than inheriting rows that have moved. Only one is ever held: a superseded key
// is a stale copy of the largest thing in memory.
export function libraryIndex(key, rows) {
  let haystacks = indexes.get(key)

  if (!haystacks) {
    haystacks = []
    indexes.clear()
    indexes.set(key, haystacks)
  }

  for (let index = haystacks.length; index < rows.length; index += 1) {
    haystacks[index] = rowHaystack(rows[index])
  }

  return haystacks
}

// Returns playlist indices, ascending, in library order -- not ranked. Order is
// what makes album grouping mean anything, and the library is usually sorted
// the way its owner wants to read it.
export function searchLibrary(haystacks, query) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return null

  const matched = new Int32Array(haystacks.length)
  let count = 0

  for (let index = 0; index < haystacks.length; index += 1) {
    if (!haystackMatches(haystacks[index], tokens)) continue
    matched[count] = index
    count += 1
  }

  return matched.subarray(0, count)
}

// Results are ascending, so finding the row the player is on is a bisection
// rather than a scan -- this runs on every position update.
export function positionOf(indices, index) {
  if (index == null || index < 0) return -1

  let low = 0
  let high = indices.length - 1

  while (low <= high) {
    const middle = (low + high) >> 1
    const value = indices[middle]
    if (value === index) return middle
    if (value < index) low = middle + 1
    else high = middle - 1
  }

  return -1
}
