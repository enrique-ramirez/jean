# The keyboard

**Bindings live in `keymap.ts` and nowhere else.** `ShortcutSheet` draws the help overlay from that array. Register a binding in the component that draws its button. The transport's keys (Space, the arrows with and without Mod, `=`, `-`, `M`, `O`, `W`) are global and no scope takes one.

**The manager listens on `document` at bubble and fires every enabled registration matching a key.** A focus region that answers its own keys, such as the track list's arrows and Enter, handles them on the element and stops propagation. It may answer a listed binding for the element with the caret through `matchesBinding`. Enter is stopped without being prevented, since the browser's default on a focused button is the click. Space is never stopped.

**A virtualised list's active row is an index in state**, scrolled into view by the virtualiser. The virtualiser unmounts a row that scrolls out, and DOM focus goes with it.

## Layouts

The matcher compares `event.key` first and falls back to `event.code` through a QWERTY punctuation map. So punctuation is declared as the character typed (`Shift+?`, never `Shift+/`), and a shifted character is declared twice, `Shift+X` and bare `X`, through `shifted()`, with `shown` naming the one key the sheet draws. A letter matches on `event.key` alone and gets neither.

## Overlays

**An overlay owns the keyboard through `keyboardOwner.ts`.** While it does, only registrations naming it stay enabled, and a binding that both opens and closes the overlay has to be one of them.

**Escape in an overlay is caught in the capture phase, through `useEscapeCapture`**, because the playlist scope binds Escape to clearing the selection and a bubbling handler would do both in one keystroke. A capture listener does not stop its siblings on the same node, so every layer stands down on `keyboardOwner`, and an overlay that takes Escape also claims the keyboard.

## Labels

`hidden: true` is for a binding that only meets an expectation a list already sets, such as Shift with an arrow. A key drawn on its own control is read off the same declaration, and hidden on a coarse pointer. A key is never translated; its name is a phrase, and `mnemonicOf` reads the underline off the translated label.

**A hotkey that stops working in dev is usually a stale registration.** HMR re-registers while the dead module's registration can still hold the key. Reload fully before debugging.
