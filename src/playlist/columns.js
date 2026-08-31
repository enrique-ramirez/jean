import { FIELD } from './fields.js'

// Columns the user can toggle. Title and artist are not here: they share one
// cell and are always shown, because a row without them is not a row.
//
// Everything is fetched regardless of what is displayed, so toggling a column
// is instant and never refetches. The fetched set is small enough that this is
// cheaper than the round trip would be.
export const OPTIONAL_COLUMNS = [
  { id: 'duration', label: 'Time', width: '4rem', compactWidth: '3.25rem', align: 'right', kind: 'duration', field: FIELD.duration },
  { id: 'rating', label: 'Rating', width: '5.5rem', compactWidth: '4.25rem', kind: 'rating', field: FIELD.rating },
  { id: 'playCount', label: 'Plays', width: '3.75rem', compactWidth: '2.75rem', align: 'right', kind: 'playCount', field: FIELD.playCount },
  { id: 'album', label: 'Album', width: 'minmax(0, 1.4fr)', kind: 'text', field: FIELD.album },
  { id: 'lastPlayed', label: 'Last played', width: '6.5rem', kind: 'date', field: FIELD.lastPlayed },
  { id: 'year', label: 'Year', width: '3.25rem', align: 'right', kind: 'text', field: FIELD.year },
  { id: 'genre', label: 'Genre', width: 'minmax(0, 1fr)', kind: 'text', field: FIELD.genre },
  { id: 'codec', label: 'Codec', width: '4rem', kind: 'text', field: FIELD.codec },
  { id: 'bitrate', label: 'Rate', width: '4rem', align: 'right', kind: 'bitrate', field: FIELD.bitrate },
]

export const DEFAULT_COLUMN_IDS = ['duration', 'rating', 'playCount']

// On a phone the title is the row. Every fixed column steals width from it, and
// once the fixed widths plus padding exceed the viewport the flexible names
// cell collapses to nothing -- so the compact layout caps how many can appear
// and which, rather than trusting the grid to sort it out.
const COMPACT_PRIORITY = ['duration', 'playCount', 'rating']
const COMPACT_MAX_COLUMNS = 2

const LEADING = {
  // Two sizes for one column. The number is left-aligned, so its slack falls on
  // the right -- and whether that slack is visible depends on what comes next.
  // With artwork it disappears behind the cover. Without it, in an album group
  // or a list with artwork switched off, it sits straight against the title and
  // reads as a hole, so the column tightens to about what the digits need.
  //
  // Neither is sized for the longest index there could be. Anything longer runs
  // into the gap that follows rather than pushing every row across for it.
  number: { width: '2rem', compactWidth: '1.5rem' },
  numberBare: { width: '1.5rem', compactWidth: '1.25rem' },
  artwork: { width: '34px', compactWidth: '32px' },
  names: { width: 'minmax(0, 2fr)', compactWidth: 'minmax(6rem, 1fr)' },
}

const widthOf = (column, isCompactViewport) =>
  (isCompactViewport && column.compactWidth) || column.width

function selectOptional({ enabledIds, isCompactViewport, isAvailable }) {
  const enabled = OPTIONAL_COLUMNS.filter(
    (column) => enabledIds.includes(column.id) && isAvailable(column.field),
  )

  if (!isCompactViewport) return enabled

  return COMPACT_PRIORITY.map((id) => enabled.find((column) => column.id === id))
    .filter(Boolean)
    .slice(0, COMPACT_MAX_COLUMNS)
}

export function resolveColumns({ enabledIds, showArtwork, isCompactViewport, isAvailable }) {
  const optional = selectOptional({ enabledIds, isCompactViewport, isAvailable })

  const build = (withArtwork) =>
    [
      widthOf(withArtwork ? LEADING.number : LEADING.numberBare, isCompactViewport),
      withArtwork ? widthOf(LEADING.artwork, isCompactViewport) : null,
      widthOf(LEADING.names, isCompactViewport),
      ...optional.map((column) => widthOf(column, isCompactViewport)),
    ]
      .filter(Boolean)
      .join(' ')

  // Album rows sit beside a cover and carry no artwork cell of their own, so
  // they need a template with that track removed -- reusing the compact one
  // leaves an empty column and shifts every cell after it.
  return { optional, template: build(showArtwork), albumTemplate: build(false) }
}
