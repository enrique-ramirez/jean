import { Playback } from './player/Playback.jsx'
import { usePlayerStream } from './player/usePlayer.js'

export function App() {
  // One EventSource for the whole app, feeding the query cache.
  usePlayerStream()

  return (
    <main className="app">
      <Playback />
    </main>
  )
}
