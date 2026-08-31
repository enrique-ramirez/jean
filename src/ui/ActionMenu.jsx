import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'

import { useDismissable } from '../hooks/useDismissable.js'
import { useIsCompactViewport } from '../hooks/useMediaQuery.js'
import { fold } from './text.js'
import { useVisualViewport } from './useVisualViewport.js'
import styles from './ActionMenu.module.css'

// One menu, two shapes -- a popover at the pointer on desktop, a floating tray
// on touch. Not two components: the actions are declared once, as data, and the
// surface decides how to draw them. Every menu in the app should come from here
// so the gestures, the keyboard and the submenu behaviour stay identical.
//
// A node is one of:
//   { id, label, icon, shortcut, danger, disabled, onSelect, keepOpen }
//   { id, label, icon, danger, items: [...], filter }   -- opens a nested page
//   { type: 'separator' }
//   { type: 'message', text }
//
// Nested pages slide in place rather than flying out to the side, on desktop
// too. A flyout that closes when the pointer strays is a poor place to put a
// confirmation, and one drill-in implementation beats two half-tested ones.

const EDGE_MARGIN = 8
const SHEET_EXIT_MS = 220
// Far enough that it cannot be reached by the wobble of a hold, close enough
// that it feels like a flick rather than a haul.
const SHEET_DISMISS_PX = 92

// Every token has to appear somewhere in the label, in any order, as substrings
// -- the same rule, and the same fold(), the library search uses, so typing at a
// menu behaves like typing at the search field rather than like a different
// product that happens to be in the same window.
const matchesQuery = (label, tokens) => {
  const haystack = fold(label)
  return tokens.every((token) => haystack.includes(token))
}

export function ActionMenu({ isOpen, anchor, header, actions, onDismiss }) {
  const isCompact = useIsCompactViewport()

  // The trigger forgets which row was right-clicked the moment the menu closes,
  // so the last open state is kept here -- otherwise the sheet slides out empty.
  const shown = useRef({ anchor, header, actions })
  if (isOpen) shown.current = { anchor, header, actions }

  // Derived during render, deliberately. Set from an effect instead, and there
  // is one commit in which the menu is neither open nor leaving: it unmounts,
  // the effect brings it straight back for the exit, and that remount re-runs
  // the surface's focus effect -- stealing focus from whatever the action just
  // put it on. That is what made Rename close itself on the phone.
  //
  // Only the sheet plays an exit. A popover that lingers after the click feels
  // broken; every native context menu vanishes on the spot.
  const [isLeaving, setIsLeaving] = useState(false)
  const [wasOpen, setWasOpen] = useState(isOpen)

  if (wasOpen !== isOpen) {
    setWasOpen(isOpen)
    setIsLeaving(!isOpen && isCompact)
  }

  useEffect(() => {
    if (!isLeaving) return undefined
    const timer = setTimeout(() => setIsLeaving(false), SHEET_EXIT_MS)
    return () => clearTimeout(timer)
  }, [isLeaving])

  if (!isOpen && !isLeaving) return null

  const view = shown.current

  return createPortal(
    isCompact ? (
      <ActionSheet
        header={view.header}
        actions={view.actions}
        isLeaving={isLeaving}
        onDismiss={onDismiss}
      />
    ) : (
      // Keyed on the anchor so a right-click on a different row remeasures
      // rather than reusing the placement of the row before it.
      <ActionPopover
        key={`${view.anchor.x},${view.anchor.y}`}
        anchor={view.anchor}
        header={view.header}
        actions={view.actions}
        onDismiss={onDismiss}
      />
    ),
    document.body,
  )
}

// Walks the trail of opened ids into the pages it names, re-resolving against
// the current actions every render so a page whose parent went away collapses
// rather than showing a stale copy of it.
function usePages(actions) {
  const [trail, setTrail] = useState([])

  const pages = useMemo(() => {
    const resolved = [{ id: 'root', items: actions }]
    let current = actions

    for (const id of trail) {
      const node = current?.find((item) => item.id === id)
      if (!node?.items) break
      resolved.push(node)
      current = node.items
    }

    return resolved
  }, [actions, trail])

  const push = useCallback((id) => setTrail((current) => [...current, id]), [])
  const pop = useCallback(() => setTrail((current) => current.slice(0, -1)), [])

  return { pages, depth: pages.length - 1, push, pop }
}

// `focusFilter` is on for the popover and off for the sheet. A field that takes
// focus the instant a menu opens is right where a keyboard is already there and
// wrong where opening one costs half the screen: on touch the field waits to be
// tapped, so scrolling and tapping an entry -- what most opens of this menu are
// -- never summon a keyboard at all.
function usePanel({ actions, onDismiss, canFilter = false, focusFilter = false }) {
  const { pages, depth, push, pop } = usePages(actions)
  const pageRefs = useRef([])
  const [height, setHeight] = useState(null)
  const [query, setQuery] = useState('')

  // The surface follows the page it is showing. Observed rather than measured
  // once: a nested page's content can settle after it mounts.
  useLayoutEffect(() => {
    const element = pageRefs.current[depth]
    if (!element) return undefined

    const measure = () => setHeight(element.offsetHeight)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [depth, pages])

  const back = useCallback(() => {
    setQuery('')
    return depth > 0 ? pop() : onDismiss()
  }, [depth, pop, onDismiss])

  const select = useCallback(
    (node) => {
      if (node.items) {
        setQuery('')
        push(node.id)
        return
      }
      node.onSelect?.()
      if (!node.keepOpen) onDismiss()
    },
    [push, onDismiss],
  )

  const active = pages[depth]
  const isFiltered = canFilter && Boolean(active?.filter)

  // A page whose whole point is to be typed at should put the caret there.
  useEffect(() => {
    if (!isFiltered || !focusFilter) return
    pageRefs.current[depth]?.querySelector('input')?.focus({ preventScroll: true })
  }, [isFiltered, focusFilter, depth])

  const onKeyDown = (event) => {
    // Nothing typed at an open menu belongs to the app behind it: without this
    // the arrow keys seek the player while you are picking an action, and the
    // space bar toggles playback while you are typing a playlist name.
    event.stopPropagation()
    if (event.key === 'Tab') return

    const element = pageRefs.current[depth]
    const items = element ? [...element.querySelectorAll('[role="menuitem"]:not(:disabled)')] : []
    const at = items.indexOf(document.activeElement)
    const focus = (index) => items[(index + items.length) % items.length]?.focus()
    const inField = event.target instanceof HTMLInputElement

    switch (event.key) {
      case 'ArrowDown':
        focus(at + 1)
        break
      case 'ArrowUp':
        focus(at < 0 ? -1 : at - 1)
        break
      case 'Escape':
        back()
        break
      case 'Enter':
        // Type three letters and commit, without reaching for the arrows.
        if (!inField) return
        items[0]?.click()
        break
      default:
        // Everything else belongs to the field while the field has focus --
        // Home, End and the horizontal arrows are caret keys there, not menu
        // keys, and every printable character is just typing.
        if (inField) return
        if (event.key === 'Home') focus(0)
        else if (event.key === 'End') focus(-1)
        else if (event.key === 'ArrowLeft') back()
        else if (event.key === 'ArrowRight' && items[at]?.dataset.submenu) items[at].click()
        // Enter and Space on a focused item are left alone on purpose: it is a
        // real button, and preventing the default is what stops it being
        // pressed. The stopPropagation above already shields the app from them.
        else return
    }

    event.preventDefault()
  }

  // Only the page on screen is filtered. The others are inert and sliding, and
  // narrowing them would make the panel resize behind the animation.
  const visibleItems = (page, isActive) => {
    const tokens = fold(query.trim()).split(/\s+/).filter(Boolean)
    if (!isActive || !isFiltered || tokens.length === 0) return page.items

    // Separators and prose describe a list that is no longer the list.
    const matched = page.items.filter((node) => !node.type && matchesQuery(node.label, tokens))
    return matched.length > 0 ? matched : [{ type: 'message', text: 'Nothing matches that.' }]
  }

  const body = (
    <div className={styles.viewport} style={height === null ? undefined : { height }}>
      <div className={styles.track} style={{ transform: `translateX(${depth * -100}%)` }}>
        {pages.map((page, index) => (
          <div
            key={page.id}
            className={styles.page}
            ref={(element) => {
              pageRefs.current[index] = element
            }}
            role="menu"
            aria-label={page.label}
            inert={index === depth ? undefined : true}
          >
            {index === depth && isFiltered ? (
              <div className={styles.filter}>
                <Search size={14} strokeWidth={2} aria-hidden="true" />
                <input
                  className={styles.filterInput}
                  value={query}
                  placeholder={page.filter}
                  aria-label={page.filter}
                  spellCheck="false"
                  autoComplete="off"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            ) : null}

            {visibleItems(page, index === depth).map((node, position) => (
              <Node key={node.id ?? `${node.type}-${position}`} node={node} onSelect={select} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )

  return { body, onKeyDown, page: active, depth, back }
}

function Node({ node, onSelect }) {
  if (node.type === 'separator') return <div className={styles.separator} role="separator" />
  if (node.type === 'message') return <p className={styles.message}>{node.text}</p>

  const Icon = node.icon
  const hasSubmenu = Boolean(node.items)

  return (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      data-danger={node.danger ? 'true' : undefined}
      data-submenu={hasSubmenu ? 'true' : undefined}
      disabled={node.disabled}
      aria-haspopup={hasSubmenu ? 'menu' : undefined}
      onClick={() => onSelect(node)}
    >
      <span className={styles.rail} aria-hidden="true" />
      {Icon ? <Icon className={styles.icon} size={18} strokeWidth={1.9} aria-hidden="true" /> : null}
      <span className={styles.label}>{node.label}</span>
      {node.shortcut ? <kbd className={styles.shortcut}>{node.shortcut}</kbd> : null}
      {hasSubmenu ? (
        <ChevronRight className={styles.chevron} size={15} strokeWidth={2} aria-hidden="true" />
      ) : null}
    </button>
  )
}

function Header({ header, page, depth, onBack }) {
  if (depth > 0) {
    return (
      <button type="button" className={styles.back} onClick={onBack}>
        <ChevronLeft size={15} strokeWidth={2.2} aria-hidden="true" />
        <span className={styles.backLabel}>{page.label}</span>
      </button>
    )
  }

  if (!header) return null

  const Icon = header.icon

  return (
    <div className={styles.header}>
      {Icon ? (
        <span className={styles.headerIcon} aria-hidden="true">
          <Icon size={17} strokeWidth={1.9} />
        </span>
      ) : null}
      <span className={styles.headerText}>
        <span className={styles.headerTitle}>{header.title}</span>
        {header.subtitle ? <span className={styles.headerMeta}>{header.subtitle}</span> : null}
      </span>
    </div>
  )
}

// Focus moves into the panel on open and back where it came from on close --
// but only if the panel still holds it. An action is allowed to send focus
// somewhere deliberately (Rename opens a field in the row behind the menu) and
// must not have it taken back when the menu finally goes.
//
// Layout effects, so the cleanup still runs while the panel is in the DOM and
// can be asked whether it has focus.
function useFocusCapture(ref) {
  useLayoutEffect(() => {
    const panel = ref.current
    const previous = document.activeElement
    panel.focus({ preventScroll: true })

    return () => {
      if (panel.contains(document.activeElement)) previous?.focus?.({ preventScroll: true })
    }
  }, [ref])
}

function ActionPopover({ anchor, header, actions, onDismiss }) {
  const { body, onKeyDown, page, depth, back } = usePanel({
    actions,
    onDismiss,
    canFilter: true,
    focusFilter: true,
  })
  // Clicking away closes the menu outright rather than stepping back a page:
  // the pointer went somewhere else entirely, which is not a request to go up.
  const ref = useDismissable(true, onDismiss)
  const [placement, setPlacement] = useState(null)

  // Measured once, on open. Recomputing as a nested page changes the height
  // would slide the menu out from under the pointer; the overflow that causes
  // is absorbed by maxHeight instead.
  useLayoutEffect(() => {
    const { width, height } = ref.current.getBoundingClientRect()
    const room = { x: window.innerWidth, y: window.innerHeight }

    const flipX = anchor.x + width > room.x - EDGE_MARGIN
    const flipY = anchor.y + height > room.y - EDGE_MARGIN
    const left = flipX ? Math.max(EDGE_MARGIN, anchor.x - width) : anchor.x
    const top = flipY ? Math.max(EDGE_MARGIN, anchor.y - height) : anchor.y

    setPlacement({
      left,
      top,
      maxHeight: room.y - top - EDGE_MARGIN,
      // The panel scales out of the corner nearest the click, so it reads as
      // having come from there rather than merely appearing beside it.
      origin: `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`,
    })
  }, [anchor, ref])

  useFocusCapture(ref)

  return (
    <div
      ref={ref}
      className={styles.popover}
      data-placed={placement ? 'true' : undefined}
      style={
        placement
          ? {
              left: placement.left,
              top: placement.top,
              maxHeight: placement.maxHeight,
              transformOrigin: placement.origin,
            }
          : undefined
      }
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <Header header={header} page={page} depth={depth} onBack={back} />
      {body}
    </div>
  )
}

function ActionSheet({ header, actions, isLeaving, onDismiss }) {
  const { body, onKeyDown, page, depth, back } = usePanel({ actions, onDismiss, canFilter: true })
  const ref = useRef(null)
  const scrimRef = useRef(null)
  const [dragY, setDragY] = useState(0)
  const from = useRef(null)

  useFocusCapture(ref)
  // The scrim is the sheet's containing block, so tracking the visual viewport
  // here is what lifts the sheet clear of the keyboard.
  useVisualViewport(scrimRef)

  // Pull down to put it away. Only downward travel counts, so the gesture never
  // fights the sheet's own content.
  const grabber = {
    onPointerDown: (event) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      from.current = event.clientY
    },
    onPointerMove: (event) => {
      if (from.current === null) return
      setDragY(Math.max(0, event.clientY - from.current))
    },
    onPointerUp: (event) => {
      if (from.current === null) return
      const travelled = event.clientY - from.current
      from.current = null
      setDragY(0)
      if (travelled > SHEET_DISMISS_PX) onDismiss()
    },
    onPointerCancel: () => {
      from.current = null
      setDragY(0)
    },
  }

  return (
    <div
      ref={scrimRef}
      className={styles.scrim}
      data-state={isLeaving ? 'closed' : 'open'}
      onPointerDown={onDismiss}
    >
      <div
        ref={ref}
        className={styles.sheet}
        data-state={isLeaving ? 'closed' : 'open'}
        data-dragging={dragY > 0 ? 'true' : undefined}
        style={dragY > 0 ? { transform: `translate3d(0, ${dragY}px, 0)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={header?.title ?? 'Actions'}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={styles.grabber} {...grabber}>
          <span className={styles.handle} aria-hidden="true" />
        </div>
        <Header header={header} page={page} depth={depth} onBack={back} />
        {body}
      </div>
    </div>
  )
}
