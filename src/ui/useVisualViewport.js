import { useLayoutEffect } from 'react'

// Pins a fixed element to the *visual* viewport rather than the layout one.
//
// This exists for one reason: the software keyboard. A `position: fixed` element
// is laid out against the layout viewport, and neither platform shrinks that
// when the keyboard comes up -- iOS Safari does not resize it at all, and Chrome
// defaults to `interactive-widget=resizes-visual`. So a bottom-anchored sheet
// with a text field in it puts the field underneath the keyboard the moment you
// tap it, which is the one place it must not be.
//
// The visual viewport does know. Sizing to it makes "above the keyboard" fall
// out of the existing `align-items: flex-end`, and following `offsetTop` as well
// as `height` covers iOS scrolling the page to reveal a focused field, which
// would otherwise slide the whole thing out from under itself.
//
// Written straight to the element rather than through state: iOS fires a stream
// of these while the keyboard animates, and a render per frame would collide
// with the sheet's own drag transform on the same style attribute.
export function useVisualViewport(ref) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const element = ref.current
    if (!viewport || !element) return undefined

    const apply = () => {
      element.style.top = `${viewport.offsetTop}px`
      element.style.height = `${viewport.height}px`
    }

    apply()
    viewport.addEventListener('resize', apply)
    viewport.addEventListener('scroll', apply)

    return () => {
      viewport.removeEventListener('resize', apply)
      viewport.removeEventListener('scroll', apply)
    }
  }, [ref])
}
