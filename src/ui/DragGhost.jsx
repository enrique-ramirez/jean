import { Music } from 'lucide-react'

import { setGhostElement, useDragState } from './dnd.js'
import styles from './DragGhost.module.css'

// What follows the pointer during a drag. Mounted only while dragging, and
// positioned by dnd.js writing to the element directly -- it never re-renders
// for movement, only when the armed target changes.
export function DragGhost() {
  const { isDragging, over, count, label } = useDragState()
  if (!isDragging) return null

  return (
    // Two elements on purpose. A CSS animation beats an inline style, so an
    // entrance that touched `transform` would override the position written
    // every frame -- the ghost would fly in from the top-left corner and only
    // start following the pointer once the animation finished. The outer box
    // owns position, the inner one owns everything that animates.
    <div ref={setGhostElement} className={styles.ghost}>
      <div className={styles.pill} data-armed={over ? 'true' : undefined}>
        <Music size={14} strokeWidth={2} aria-hidden="true" />
        <span className={styles.label}>{label}</span>
        {count > 1 ? <span className={styles.count}>{count.toLocaleString()}</span> : null}
      </div>
    </div>
  )
}
