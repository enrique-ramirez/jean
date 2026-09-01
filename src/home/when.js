const DAY = 24 * 60 * 60 * 1000

// "Last played 2026" said the same thing on every card in the row, which is a
// caption that has stopped being information. A year is the wrong unit for
// something you did this week.
//
// Intl does the work, so this is right in whatever locale the browser is set to
// and needs no wordlist of our own. `numeric: 'auto'` is what turns "1 day ago"
// into "yesterday" and "1 week ago" into "last week".
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const monthAndYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1)

export function describeWhen(at) {
  if (!at) return null

  const days = Math.floor((Date.now() - at) / DAY)
  if (days <= 0) return 'Today'
  if (days < 7) return capitalise(relative.format(-days, 'day'))
  if (days < 35) return capitalise(relative.format(-Math.round(days / 7), 'week'))
  // Past a month the exact count stops being useful and the month name starts
  // being more memorable -- "April 2019" places a record in your life in a way
  // that "68 months ago" does not.
  if (days < 365) return capitalise(relative.format(-Math.round(days / 30), 'month'))
  return monthAndYear.format(at)
}

// Just the year, for captions where the point is how long ago it was rather
// than exactly when.
export const yearOf = (at) => (at ? new Date(at).getFullYear() : null)
