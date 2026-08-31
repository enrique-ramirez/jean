// Measures the media library API against the playlist read Jean uses today.
//
// Two questions, both from the PR's own warning that there is no caching and
// "every call enumerates the library and computes a relative path per item":
//
//   1. Does chunking still pay? Our "chunk small, then go wide" strategy was
//      measured against playlist reads, where paging is cheap. If every chunk
//      re-enumerates, N chunks could be N enumerations.
//   2. What does the payload weigh with `path` on every item? `%path%` was
//      deliberately excluded from what Jean fetches; the library returns it
//      whether we want it or not.
//
// Answers recorded in CLAUDE.md, "The library API". Re-run it when the player
// changes -- the PR is unmerged and the endpoint is being polished, so these
// numbers have a shelf life.
//
//   PLAYER=home.local:8880 node test/measure-library.mjs
//
// It needs a real player with a real library; the fake cannot answer questions
// about a server-side cost it does not have.

import { TRACK_EXPRESSIONS } from '../src/playlist/fields.js'
const HOST = process.env.PLAYER ?? 'home.local:8880'
const COLUMNS = encodeURIComponent(TRACK_EXPRESSIONS.join(','))
const REPEATS = 3

const ms = (n) => `${Math.round(n)} ms`
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`

// Median rather than mean: one slow sample from a background enumeration should
// not become the number we design against.
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function fetchOnce(path, { gzip = true } = {}) {
  const started = performance.now()
  const response = await fetch(`http://${HOST}${path}`, {
    headers: gzip ? { 'Accept-Encoding': 'gzip' } : { 'Accept-Encoding': 'identity' },
  })
  if (!response.ok) throw new Error(`${path} -> ${response.status}`)
  const body = await response.arrayBuffer()
  // Content-Length is what crossed the wire; arrayBuffer() has already been
  // decompressed, so measuring it would report the same number either way.
  const wire = Number(response.headers.get('content-length')) || body.byteLength
  return { elapsed: performance.now() - started, bytes: body.byteLength, wire }
}

async function sample(label, path, opts) {
  const runs = []
  let bytes = 0
  for (let i = 0; i < REPEATS; i += 1) {
    const r = await fetchOnce(path, opts)
    runs.push(r.elapsed)
    bytes = r.bytes
  }
  console.log(`  ${label.padEnd(46)} ${ms(median(runs)).padStart(9)}   ${mb(bytes).padStart(9)}`)
  return { elapsed: median(runs), bytes }
}

// Wire weight, which is what actually crosses the network, versus what the
// parser has to chew through.
async function weigh(label, path) {
  const gz = await fetchOnce(path, { gzip: true })
  console.log(
    `  ${label.padEnd(30)} wire ${mb(gz.wire).padStart(8)}   decoded ${mb(gz.bytes).padStart(8)}` +
      `   ratio ${(gz.bytes / gz.wire).toFixed(1)}x`,
  )
  return { gzipped: gz.wire, raw: gz.bytes }
}

const chunked = async (total, size, concurrency) => {
  const ranges = []
  for (let offset = 0; offset < total; offset += size) ranges.push(`${offset}:${size}`)

  const started = performance.now()
  let bytes = 0
  for (let at = 0; at < ranges.length; at += concurrency) {
    const batch = ranges.slice(at, at + concurrency)
    const results = await Promise.all(
      batch.map((range) => fetchOnce(`/api/library/items?columns=${COLUMNS}&range=${range}`)),
    )
    for (const r of results) bytes += r.bytes
  }
  return { elapsed: performance.now() - started, requests: ranges.length, bytes }
}

console.log(`player: ${HOST}\ncolumns: ${TRACK_EXPRESSIONS.length}\n`)

const { library } = await (await fetch(`http://${HOST}/api/library/info`)).json()
const { playlists } = await (await fetch(`http://${HOST}/api/playlists`)).json()
const libraryPlaylist = playlists.find((p) => p.title === 'Library')
const total = library.itemCount
console.log(`library itemCount = ${total}, Library playlist = ${libraryPlaylist.itemCount}\n`)

console.log('detection cost')
await sample('GET /library/info', '/api/library/info')

console.log('\nwhole thing, one request')
const playlistPath = `/api/playlists/${libraryPlaylist.id}/items/0:${total}?columns=${COLUMNS}`
const libraryPath = `/api/library/items?columns=${COLUMNS}&range=0:${total}`
const viaPlaylist = await sample('playlist read (what Jean does today)', playlistPath)
const viaLibrary = await sample('library read', libraryPath)
const noRange = await sample('library read, no range at all', `/api/library/items?columns=${COLUMNS}`)

console.log('\npayload weight')
const wPlaylist = await weigh('playlist', playlistPath)
const wLibrary = await weigh('library (+path, +subsong)', libraryPath)

console.log('\nchunking the library')
for (const [size, concurrency] of [
  [2000, 1],
  [2000, 4],
  [5000, 4],
  [10000, 4],
]) {
  const r = await chunked(total, size, concurrency)
  const label = `${r.requests} x ${size}, ${concurrency} at a time`
  console.log(`  ${label.padEnd(46)} ${ms(r.elapsed).padStart(9)}   ${mb(r.bytes).padStart(9)}`)
}

console.log('\nwhat does a request cost before it returns anything?')
const sweep = []
for (const n of [1, 500, 2000, 5000, 10000, 20000, 30441]) {
  const r = await sample(`range 0:${n}`, `/api/library/items?columns=${COLUMNS}&range=0:${n}`)
  sweep.push([n, r.elapsed])
}
// Least squares over the sweep: the intercept is what a call costs before it
// has returned a single row, which is the enumeration the PR warns about.
const n = sweep.length
const sx = sweep.reduce((a, [x]) => a + x, 0)
const sy = sweep.reduce((a, [, y]) => a + y, 0)
const sxy = sweep.reduce((a, [x, y]) => a + x * y, 0)
const sxx = sweep.reduce((a, [x]) => a + x * x, 0)
const perItem = (n * sxy - sx * sy) / (n * sxx - sx * sx)
const fixed = (sy - perItem * sx) / n
console.log(`  fitted: ${ms(fixed)} fixed per call + ${(perItem * 1000).toFixed(1)} us per item`)

console.log('\nfirst paint, then the rest')
const started = performance.now()
const head = await fetchOnce(`/api/library/items?columns=${COLUMNS}&range=0:500`)
const painted = performance.now() - started
await fetchOnce(`/api/library/items?columns=${COLUMNS}&range=500:${total - 500}`)
console.log(`  500 then the remainder: paint ${ms(painted)}, complete ${ms(performance.now() - started)}`)
const first = { elapsed: head.elapsed }

console.log('\n--- summary ---')
console.log(`  one library request      ${ms(viaLibrary.elapsed)}`)
console.log(`  one playlist request     ${ms(viaPlaylist.elapsed)}`)
console.log(`  library vs playlist      ${(viaLibrary.elapsed / viaPlaylist.elapsed).toFixed(2)}x slower`)
console.log(`  payload, gzipped         ${kb(wLibrary.gzipped)} vs ${kb(wPlaylist.gzipped)} = ${(wLibrary.gzipped / wPlaylist.gzipped).toFixed(2)}x`)
console.log(`  payload, raw             ${mb(wLibrary.raw)} vs ${mb(wPlaylist.raw)} = ${(wLibrary.raw / wPlaylist.raw).toFixed(2)}x`)
console.log(`  first 500 rows           ${ms(first.elapsed)}`)
console.log(`  no-range == full range   ${noRange.bytes === viaLibrary.bytes ? 'yes' : 'no'}`)
