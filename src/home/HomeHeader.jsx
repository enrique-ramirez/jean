import { Shuffle } from 'lucide-react'

import { Button } from '../ui/Button.jsx'
import { Chip } from '../ui/Chip.jsx'
import { PlayIcon } from '../ui/icons.jsx'
import { pluralise } from '../ui/text.js'
import { spellDuration } from '../playlist/stats.js'
import styles from './HomeHeader.module.css'

// A claim, then its evidence: the headline is the *duration*, because a track
// count is a number and "85 days of music" is a feeling, with the counts as a
// hairline rail underneath rather than five shadowed cards -- cards would make a
// music player's front door an analytics dashboard and fight the shelves below,
// which are already a grid of boxes. Letterboxd's all-time page is the reference
// for what makes it a portrait rather than a readout: it names things as well as
// counting them, which is what the genre chips are for.
export function HomeHeader({
  stats,
  isLoading,
  onPlayEverything,
  onShuffleEverything,
  canPlay,
  canShuffle,
}) {
  const duration = spellDuration(stats.seconds)
  const span =
    stats.earliest && stats.latest && stats.earliest !== stats.latest
      ? `${stats.earliest}–${stats.latest}`
      : (stats.earliest ?? null)

  // A figure at nothing is not drawn. Zero genres means no genre tag rather than
  // a library without genres, and either way it is an absence dressed as a
  // fact -- so a brand new install gets a header that shrinks to the one line
  // it can honestly say instead of a rail of noughts.
  const figures = [
    ['track', stats.trackCount],
    ['album', stats.albumCount],
    ['artist', stats.artistCount],
    ['genre', stats.genreCount],
    ['playlist', stats.playlistCount],
  ].filter(([, count]) => count)

  return (
    <header className={styles.header}>
      <div className={styles.said}>
        <p className={styles.eyebrow}>
          Your library
          {span ? <span className={styles.span}>{span}</span> : null}
        </p>

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
            {figures.map(([noun, count]) => (
              <div key={noun} className={styles.figure}>
                <dd className={styles.count}>{count.toLocaleString()}</dd>
                <dt className={styles.label}>{pluralise(count, noun)}</dt>
              </div>
            ))}
            {isLoading ? <div className={styles.counting}>still counting</div> : null}
          </dl>
        ) : null}

        {/* Hidden on a phone, where another band of text above shelves that
            already sit close together turns the screen into more reading than
            looking -- the same call the shelf blurbs make. */}
        {stats.topGenres.length > 0 ? (
          <div className={styles.chips}>
            {stats.topGenres.map((genre) => (
              <Chip key={genre.name} label={genre.name} value={`${genre.share}%`} />
            ))}
          </div>
        ) : null}
      </div>

      {/* The same two a playlist header has, meaning the same two things. A
          single button would have had to be Play doing a shuffle's job, which
          contradicts the header two clicks away: Shuffle is the one worth
          pressing on thirty thousand tracks, and Play is the one that has to
          exist for Shuffle to be honest. */}
      {canPlay || canShuffle ? (
        <div className={styles.actions}>
          {canPlay ? (
            <Button variant="primary" icon={PlayIcon} onClick={onPlayEverything}>
              Play
            </Button>
          ) : null}
          {canShuffle ? (
            <Button icon={Shuffle} onClick={onShuffleEverything}>
              Shuffle
            </Button>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
