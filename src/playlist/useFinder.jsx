import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { Button } from '../ui/Button.jsx'
import { Finder } from './Finder.jsx'
import { search, useSearchIndex } from './useSearchIndex.js'
import styles from './useFinder.module.css'

// Find-in-this-list, for any view that renders a `TrackBrowser`.
//
// Not the search in the top bar. That one filters the library down to matches
// and takes you to `#/search`; this walks you to a track inside the list already
// on screen, changing neither its rows nor their order. Both exist because they
// answer different questions, which is why the button names the list it is
// searching.
//
// Returns the node rather than the pieces: a caller that assembles its own is
// the one that will assemble it wrongly, and there is nothing here to decide
// except what to call the list.
export function useFinder({ rows, browserRef, label }) {
  const [isFinding, setIsFinding] = useState(false)
  const [query, setQuery] = useState('')

  // The field holds `query` and updates instantly; the scan runs off the
  // deferred copy. Without this a keystroke carried a scan of the whole list, a
  // new match set for every mounted row to re-read, and a scroll, all before the
  // character it typed could paint -- which is how a phone keyboard starts
  // dropping and reordering what you type into it.
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
      label={label}
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
