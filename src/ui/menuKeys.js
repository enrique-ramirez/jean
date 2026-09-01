import { useLayoutEffect } from 'react'

// The keyboard a menu owns while it is open, shared by both menu surfaces --
// `ActionMenu`'s popover and sheet, and the plain dropdown in `Menu` -- so the
// two cannot answer the same key differently. They already had: the sheet took
// the keys from the app and the dropdown did not, so Escape closed one and
// cleared the track selection behind the other.

// Enabled items in the order they are drawn. Both roles, because a checkbox in
// a menu is still a row you arrow onto.
const ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)'

const itemsIn = (container) => [...(container?.querySelectorAll(ITEMS) ?? [])]

// Wrapping, and -1 is the last one.
const ROVE = {
  ArrowDown: (at) => at + 1,
  ArrowUp: (at) => (at < 0 ? -1 : at - 1),
  Home: () => 0,
  End: () => -1,
}

// Focus moves into the panel on open and back where it came from on close --
// but only if the panel still holds it. An action is allowed to send focus
// somewhere deliberately (Rename opens a field in the row behind the menu) and
// must not have it taken back when the menu finally goes.
//
// `isReady` is not a nicety: a popover is invisible for the frame it is
// measured in, and focusing something invisible puts focus nowhere -- which
// left the arrow keys navigating nothing and every key still belonging to the
// app behind the menu.
//
// Layout effects, so the cleanup still runs while the panel is in the DOM and
// can be asked whether it has focus.
export function useFocusCapture(ref, isReady = true) {
  useLayoutEffect(() => {
    if (!isReady) return undefined

    const panel = ref.current
    const previous = document.activeElement
    // Unless the panel has already placed it: a page that autofocuses its own
    // field has said where focus belongs, and taking it back would undo that.
    if (!panel.contains(previous)) panel.focus({ preventScroll: true })

    return () => {
      if (panel.contains(document.activeElement)) previous?.focus?.({ preventScroll: true })
    }
  }, [ref, isReady])
}

// **Nothing typed at an open menu belongs to the app behind it.** Without the
// stopPropagation the arrow keys seek the player while you are choosing an
// action, the space bar toggles playback while you are typing a playlist name,
// and Escape clears the track selection rather than closing what is on top of
// it. Tab is the exception: leaving by keyboard is the browser's business.
//
// `beyond` is where a surface adds keys of its own -- `ActionMenu`'s nested
// pages answer the horizontal arrows, a dropdown has none. It takes the key by
// returning true.
export function handleMenuKeys(event, { container, onEscape, beyond }) {
  event.stopPropagation()
  if (event.key === 'Tab') return

  if (event.key === 'Escape') {
    onEscape()
    event.preventDefault()
    return
  }

  const items = itemsIn(container)
  const at = items.indexOf(document.activeElement)
  const focus = (index) => items[(index + items.length) % items.length]?.focus()

  if (beyond?.({ event, items, at })) {
    event.preventDefault()
    return
  }

  // Everything else belongs to the field while a field has focus: Home, End and
  // the horizontal arrows are caret keys there, and every printable character
  // is just typing.
  if (event.target instanceof HTMLInputElement) return

  const rove = ROVE[event.key]
  if (!rove) return

  // Enter and Space on a focused item are deliberately not here: it is a real
  // button, and preventing the default is what would stop it being pressed.
  focus(rove(at))
  event.preventDefault()
}
