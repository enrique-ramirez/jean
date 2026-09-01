# The keyboard

Desktop is keyboard-first, and every binding is declared in one place.


Virtualization and keyboard navigation collide: the virtualizer unmounts the focused row
when it scrolls out of view, and DOM focus evaporates. So **the active row is an index in
state**, and the virtualizer is told to scroll that index into view. A roving `tabindex`
alone will not survive. Every list component must be built knowing this.

**A hotkey that has stopped working in dev is probably a stale registration, not a bug.**
`useKeymap` registers into a module-level manager that resolves conflicts when two
registrations claim the same key. HMR remounts a component and re-registers while the
previous module instance's registration may still be in the registry; the survivor can be
holding a callback from the dead closure, so the binding looks bound and does nothing.
Full reload before debugging.

**`=` and `-` are only reachable on layouts where they are unshifted.** The matcher
compares modifier state strictly, so on Spanish, French and German layouts — where `=` is
`Shift+0` — volume up is simply unreachable, with no error. It falls back to `event.code`
only when `event.key` does not match, and the code there is `Digit0`, not `Equal`. Known,
unfixed: the fix is to declare both spellings in the keymap, or to pick keys that are
unshifted everywhere.

**Keyboard bindings are declared in `shared/keyboard/keymap.ts` and nowhere else.**
`useKeymap(scope, handlers)` registers whatever that scope declares and has a handler
for, and `ShortcutSheet` renders the help overlay from the same array — so the
documented shortcuts cannot drift from the real ones. Adding a binding means adding a
row there and a handler; never call `useHotkey` directly in a component.
