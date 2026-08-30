import { useHotkey } from '@tanstack/react-hotkeys'

import { readTrack } from '../api/beefweb.js'
import { Elapsed } from './Elapsed.jsx'
import { usePlayPause, usePlayer } from './usePlayer.js'

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 4.5h2.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Zm5.5 0H16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-2.5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

function Placeholder({ children }) {
  return <section className="playback playback--placeholder">{children}</section>
}

export function Playback() {
  const { data: snapshot, isPending, isError, error } = usePlayer()
  const playPause = usePlayPause()

  // Global, and registered before the early returns so the binding survives the
  // loading and error states. preventDefault (on by default) stops the focused
  // button from also firing its own click, and single-key bindings ignore text
  // inputs automatically — which will matter once there is a search field.
  useHotkey('Space', () => playPause.mutate(), { meta: { name: 'Play / pause' } })

  if (isPending) return <Placeholder>Connecting to foobar2000…</Placeholder>
  if (isError) return <Placeholder>Can’t reach foobar2000 — {error.message}</Placeholder>

  const { player } = snapshot
  const track = readTrack(player)
  const isPlaying = player.playbackState === 'playing'

  return (
    <section className="playback">
      <button
        type="button"
        className="playback__toggle"
        onClick={() => playPause.mutate()}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className="playback__body">
        <p className="playback__title" title={track?.title}>
          {track?.title ?? 'Nothing playing'}
        </p>
        <p className="playback__artist" title={track?.artist}>
          {track?.artist ?? '—'}
        </p>
        <Elapsed snapshot={snapshot} />
      </div>
    </section>
  )
}
