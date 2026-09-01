// Pulls fixture data off a real player, so the fake serves bytes foobar2000
// actually produced rather than what someone imagined it produces.
//
//   node test/fake-api/capture.mjs --url http://home.local:8880
//
// Re-run it when a fixture needs a field the current capture does not have.
// Everything it writes is committed, so the tests themselves never touch a
// real player.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Wider than TRACK_EXPRESSIONS on purpose: a fixture is expensive to recapture
// and cheap to store, and the views still to be built -- now playing, file
// metadata, lyrics -- will want fields the track list has no use for.
const EXPRESSIONS = [
  '%tracknumber%', '%title%', '%artist%', '%album%', '%album artist%', '%length_seconds%',
  '%lastfm_play_count%', '%lastfm_last_played%', '%rating%', '%year%', '%genre%',
  '%codec%', '%bitrate%',
  '%path%', '%length%', '%discnumber%', '%filesize%', '%last_modified%', '%samplerate%',
  '%channels%', '$len($meta(unsynced lyrics))',
]

// Chosen to cover the cases the UI actually has branches for, not to be a
// representative sample of a library:
//
//   Jessico            accented artist, for fold(); hot throughout
//   Deja Entendu       the heat range -- one 0-play track among 180-play ones
//   Jar Of Flies       FLAC rather than MP3, and short
//   Lafcadio           never played at all: no heat, no patina, no last-played
//   Deathconsciousness two discs, so %tracknumber% restarts mid-album
const ALBUMS = [
  { albumArtist: 'Babasónicos', album: 'Jessico', slug: 'jessico' },
  { albumArtist: 'Brand New', album: 'Deja Entendu', slug: 'deja-entendu' },
  { albumArtist: 'Alice in Chains', album: 'Jar Of Flies', slug: 'jar-of-flies' },
  { albumArtist: 'As Tall as Lions', album: 'Lafcadio', slug: 'lafcadio' },
  { albumArtist: 'Have a Nice Life', album: 'Deathconsciousness', slug: 'deathconsciousness' },
]

const args = new Map(process.argv.slice(2).map((arg, index, all) => [arg, all[index + 1]]))
const base = args.get('--url') ?? process.env.BEEFWEB_URL ?? 'http://localhost:8880'

const get = async (path) => {
  const response = await fetch(new URL(path, base))
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`)
  return response
}

const columns = encodeURIComponent(EXPRESSIONS.join(','))

async function findLibrary() {
  const { playlists } = await (await get('/api/playlists')).json()
  // The biggest playlist is the library on any install that has one, and this
  // never needs to be right on someone else's machine -- it runs once, here.
  const library = [...playlists].sort((a, b) => b.itemCount - a.itemCount)[0]
  if (!library) throw new Error('no playlists on this player')
  return library
}

async function main() {
  const library = await findLibrary()
  const info = await (await get('/api/player')).json()
  console.log(`capturing from ${info.player.info.title} ${info.player.info.version}, playlist ${library.title} (${library.itemCount})`)

  const { playlistItems } = await (
    await get(`/api/playlists/${library.id}/items/0:${library.itemCount}?columns=${columns}`)
  ).json()

  // Objects keyed by expression, not the positional arrays the API returns.
  // The fake has to answer whatever column set the app asks for -- two columns
  // for the status bar, thirteen for the track list -- and a lookup by
  // expression is the only shape that does that. It also preserves the
  // difference the whole capability-detection mechanism rests on: an
  // expression that is absent from the object resolves to '?', exactly as an
  // unsupported field does on a real player.
  const toTrack = (item, index) => ({
    index,
    fields: Object.fromEntries(EXPRESSIONS.map((expression, at) => [expression, item.columns[at]])),
  })

  const all = playlistItems.items.map(toTrack)

  const albums = []
  for (const wanted of ALBUMS) {
    const tracks = all.filter(
      (track) =>
        track.fields['%album artist%'] === wanted.albumArtist &&
        track.fields['%album%'] === wanted.album,
    )
    if (tracks.length === 0) throw new Error(`not found: ${wanted.albumArtist} -- ${wanted.album}`)

    const artwork = await captureArtwork(library.id, tracks[0].index, wanted.slug)
    albums.push({
      albumArtist: wanted.albumArtist,
      album: wanted.album,
      slug: wanted.slug,
      artwork,
      tracks: tracks.map((track) => track.fields),
    })
    console.log(`  ${wanted.albumArtist} -- ${wanted.album}: ${tracks.length} tracks${artwork ? ', cover' : ', no cover'}`)
  }

  await writeFile(
    join(HERE, 'library.json'),
    `${JSON.stringify({ capturedFrom: `${info.player.info.title} ${info.player.info.version} / beefweb ${info.player.info.pluginVersion}`, expressions: EXPRESSIONS, albums }, null, 2)}\n`,
  )

  // The player state itself, so the fake's idle state is a real one rather
  // than a guess at which fields beefweb sends.
  const { player } = await (await get(`/api/query?player=true&trcolumns=${encodeURIComponent('%artist%,%title%')}`)).json()
  await writeFile(join(HERE, 'player.json'), `${JSON.stringify(player, null, 2)}\n`)

  console.log('wrote library.json, player.json')
}

async function captureArtwork(playlistId, index, slug) {
  const response = await fetch(new URL(`/api/artwork/${playlistId}/${index}`, base))
  if (!response.ok) return null
  const name = `${slug}.jpg`
  await mkdir(join(HERE, 'artwork'), { recursive: true })
  await writeFile(join(HERE, 'artwork', name), Buffer.from(await response.arrayBuffer()))
  return name
}

await main()
