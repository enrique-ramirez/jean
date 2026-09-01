import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { Button } from '../ui/Button.jsx'
import { Finder } from './Finder.jsx'
import { search, useSearchIndex } from './useSearchIndex.js'
import styles from './useFinder.module.css'

// Find-in-this-list, for any view that renders a `TrackBrowser`.
//
// It lived inside `PlaylistView` and so existed only for playlists, which left
// the two longest lists in the app without it: All Music is the whole library,
// and 30,441 rows is not a thing anybody scrolls through looking for a record.
// Copying the wiring into the second view would have been the version that
// eventually disagreed with the first, so it moved here whole -- the state, the
// deferred scan, the button and the field are one thing and belong together.
//
// Returns the node rather than the pieces for the same reason: a caller that
// assembles its own is a caller that can assemble it wrongly, and there is
// nothing here for one to decide except what to call the list it is searching.
//
// Not to be confused with the library search in the top bar. That one filters
// the library down to matches and takes you to `#/search`; this finds *within*
// what is already on screen and leaves every row and its order alone -- which
// is why the results scroll you to a track in place rather than replacing the
// list with them.
export function useFinder({ rows, browserRef, label }) {
  const [isFinding, setIsFinding] = useState(false)
  const [query, setQuery] = useState('')

  // The field holds `query` and updates instantly; the scan runs off the
  // deferred copy. Without this a keystroke carried a 30,000-row scan, a new
  // match set for every mounted row to re-read, and a scroll, all before the
  // character it typed could paint -- which is what makes a phone keyboard
  // start dropping and reordering what you type into it.
  //
  // The library search has worked this way from the start. The finder is the
  // same problem over the same number of rows, so it gets the same answer.
  const deferredQuery = useDeferredValue(query)
  const haystacks = useSearchIndex(rows, isFinding)
  const { matches, results } = useMemo(
    () => search(haystacks, deferredQuery),
    [haystacks, deferredQuery],
  )

  const open = useCallback(() => setIsFinding(true), [])
  const close = useCallback(() => {
    setIsFinding(false)
    setQuery('')
  }, [])

  const toolbarLeading = isFinding ? (
    <Finder
      rows={rows}
      results={results}
      matches={matches}
      query={query}
      onQueryChange={setQuery}
      onPreview={(index) => browserRef.current?.preview(index)}
      onConfirm={(index) => {
        browserRef.current?.play(index)
        browserRef.current?.scrollToTrack(index, { align: 'center' })
        close()
      }}
      onClose={close}
    />
  ) : (
    <Button icon={Search} onClick={open}>
      {label}
      <kbd className={styles.hint}>/</kbd>
    </Button>
  )

  // `isFinding` is here because the list has to stop answering to the keyboard
  // while a field has it -- otherwise typing a track name seeks the player.
  return { isFinding, matches, open, close, toolbarLeading }
}
