import { useCallback, useLayoutEffect, useRef } from 'react'

import { useDismissable } from '../hooks/useDismissable.js'
import styles from './Menu.module.css'

// How close a popover may come to the edge of the window before it is pushed
// back in.
const GUTTER = 8

export function Menu({ isOpen, onDismiss, children, trigger, align = 'end', className, role = 'menu' }) {
  const ref = useDismissable(isOpen, onDismiss)
  const menuRef = useRef(null)

  // A dropdown is anchored to its trigger, and a trigger near an edge puts it
  // off screen -- on a phone, a wide popover hanging off a button near the right
  // edge starts outside the window and loses its own first characters. Nothing
  // in `left: 0` / `right: 0` can know that; only the layout can.
  //
  // Written to the element rather than into state: this runs on open and on
  // every resize, and a render per resize event would repaint whatever the menu
  // is sitting over, including a virtualised list.
  const clamp = useCallback(() => {
    const element = menuRef.current
    if (!element) return

    // Read with no correction in place, or each pass measures the previous
    // pass's shift and compounds it.
    element.style.setProperty('--menu-shift', '0px')
    const rect = element.getBoundingClientRect()

    // clientWidth, not innerWidth: it excludes a classic scrollbar, which
    // innerWidth counts as space the menu is allowed to sit under.
    const pastLeft = GUTTER - rect.left
    const pastRight = rect.right - (document.documentElement.clientWidth - GUTTER)
    // Left wins when the menu is too wide for the window to hold either way:
    // reading the start of it beats reading the end.
    const shift = pastLeft > 0 ? pastLeft : pastRight > 0 ? -pastRight : 0

    element.style.setProperty('--menu-shift', `${shift}px`)
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return undefined
    clamp()
    // Rotating the phone moves the anchor without reopening the menu.
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [isOpen, clamp])

  return (
    <div className={styles.anchor} ref={ref}>
      {trigger}
      {isOpen ? (
        <div
          ref={menuRef}
          className={[styles.menu, className].filter(Boolean).join(' ')}
          data-align={align}
          role={role}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({ icon: Icon, shortcut, children, ...props }) {
  return (
    <button type="button" className={styles.item} role="menuitem" {...props}>
      {Icon ? <Icon size={15} strokeWidth={2} aria-hidden="true" /> : null}
      {children}
      {shortcut ? <span className={styles.shortcut}>{shortcut}</span> : null}
    </button>
  )
}

export function MenuSeparator() {
  return <div className={styles.separator} role="separator" />
}
