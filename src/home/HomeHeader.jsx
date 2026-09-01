import { Chip } from '../ui/Chip.jsx'
import { spellDuration } from './libraryStats.js'
import styles from './HomeHeader.module.css'

// Reference pass. Two shapes dominate this problem and both were rejected.
// Dribbble's music dashboards put every figure in its own shadowed card, which
// makes the front door of a music player look like an analytics tool -- and
// cards here would fight the shelves below, which are already a grid of boxes.
// Spotify's library header is chrome and filter chips, and its Wrapped is
// full-bleed gradient panels with enormous sans type; the first is nothing and
// the second is the one look Jean has most to lose by borrowing.
//
// Taken instead: from Awwwards' stats elements, the hairline rule between
// figures, labels pinned in one place relative to the number, tabular figures
// so the row shares a grid, and an asymmetric composition that puts weight on
// one side and lets the rest breathe. From Letterboxd's all-time page -- the
// closest analogue anywhere, a personal collection counted and characterised --
// the thing that makes it a portrait rather than a readout: it names things as
// well as counting them. That is what the genre chips are doing at the bottom.
//
// So the composition is a claim, then its evidence. The headline is the
// *duration*, because that is the figure that lands: 30,441 is a number, and
// "84 days of music" is a feeling. The counts are a rail underneath, weighed
// equally against each other and lightly against the headline.
export function HomeHeader({ stats, isLoading }) {
  const duration = spellDuration(stats.seconds)
  const span =
    stats.earliest && stats.latest && stats.earliest !== stats.latest
      ? `${stats.earliest}–${stats.latest}`
      : (stats.earliest ?? null)

  // The header states what the library *has*, so a figure at nothing is not
  // drawn -- whether that is nothing to count or nothing this install can tell
  // us apart. Zero genres means no genre tag, not a library without genres, and
  // either way "0 genres" is an absence dressed up as a fact. A brand new
  // install therefore gets a header that shrinks to the one line it can say
  // rather than a rail of noughts.
  //
  // Singular nouns, pluralised only when the count earns it. Somebody trying
  // Jean against a folder of four songs is exactly who is looking hardest at
  // this screen, and "1 albums" is the kind of thing that tells them the app
  // was written for somebody else's library.
  const figures = [
    { key: 'tracks', count: stats.trackCount, noun: 'track' },
    { key: 'albums', count: stats.albumCount, noun: 'album' },
    { key: 'artists', count: stats.artistCount, noun: 'artist' },
    { key: 'genres', count: stats.genreCount, noun: 'genre' },
    { key: 'playlists', count: stats.playlistCount, noun: 'playlist' },
  ].filter((figure) => figure.count)

  return (
    <header className={styles.header}>
      <p className={styles.eyebrow}>
        Your library
        {span ? <span className={styles.span}>{span}</span> : null}
      </p>

      {/* The library's size is known from `library/info` long before its rows
          are, so the headline says the honest thing at each stage rather than
          holding an empty slot open or animating a number up from nothing. */}
      <h1 className={styles.title}>
        {duration ? (
          <>
            {duration.lead}
            {duration.trail ? <span className={styles.trail}> {duration.trail}</span> : null}
            <span className={styles.of}> of music</span>
          </>
        ) : (
          'Your library'
        )}
      </h1>

      {figures.length > 0 ? (
        <dl className={styles.rail}>
          {figures.map((figure) => (
            <div key={figure.key} className={styles.figure}>
              <dd className={styles.count}>{figure.count.toLocaleString()}</dd>
              <dt className={styles.label}>
                {figure.noun}
                {figure.count === 1 ? '' : 's'}
              </dt>
            </div>
          ))}
          {isLoading ? <div className={styles.counting}>still counting</div> : null}
        </dl>
      ) : null}

      {/* Named things, not only counted ones -- the difference between a
          portrait and a readout. Hidden on a phone, where the shelves sit close
          enough together that another band of text above them turns the screen
          into more reading than looking; the same call the shelf blurbs make. */}
      {stats.topGenres.length > 0 ? (
        <div className={styles.chips}>
          {stats.topGenres.map((genre) => (
            <Chip key={genre.name} label={genre.name} value={`${genre.share}%`} />
          ))}
        </div>
      ) : null}
    </header>
  )
}
