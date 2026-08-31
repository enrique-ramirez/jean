// Which rows an action applies to, given where the pointer went down.
//
// The rule is the file-manager one, and it is shared by the context menu and by
// dragging because they must never disagree: acting inside a selection acts on
// all of it, acting outside one acts on just that row. Rows are found through
// the DOM rather than through per-row handlers -- the list is virtualised, and
// 30,000 rows must not each carry a closure.
export function targetsFrom(event, rows, selection) {
  const element = event.target.closest?.('[data-row]')
  if (!element) return null

  const index = Number(element.dataset.row)
  if (!Number.isInteger(index) || !rows[index]) return null

  const positions =
    selection.has(index) && selection.size > 1 ? [...selection].sort((a, b) => a - b) : [index]

  return { index, positions }
}
