# The keyboard

**Bindings live in `keymap.ts` and nowhere else.** Register a binding in the component that draws its button. The transport's keys are global and no scope takes one.

**The manager listens on `document` at bubble and fires every enabled registration matching a key.** A focus region that answers its own keys handles them on the element and stops propagation. An Enter or Space binding is `leavesControls`: never prevented, standing down on a focused control, whose default is the click, unless it is `data-keeps-keys`. Space is play and pause everywhere but a menu.

**A virtualised list's active row is an index in state.** DOM focus goes when a row scrolls out.

## Layouts

The matcher compares `event.key` first and falls back to `event.code` through a QWERTY punctuation map. Unshifted, that fires QWERTY's character too, so `isTypedAsAnother()` vetoes it, a dead key included. So punctuation is declared as the character typed (`?`, never `Shift+/`), once: the matcher takes it with Shift held or without. A letter is declared once too.

## Overlays

**An overlay owns the keyboard through `keyboardOwner.ts`.** While it does, only registrations naming it stay enabled, and a binding that both opens and closes the overlay has to be one of them. Claims are ordered: the latest still held owns the keyboard, and one released out of turn hands it to the next. Every `ActionMenu` claims while open, so Escape closes the menu, not the panel behind it. A menu is not modal: Tab can leave it open.

**An overlay takes Escape in the capture phase, through `useEscapeCapture`**, because the playlist scope binds Escape to clearing the selection and a bubbling handler would do both in one keystroke. A capture listener does not stop its siblings on the same node, so every layer stands down on `keyboardOwner`, and an overlay that takes Escape also claims the keyboard. An `ActionMenu` takes it through `useDismissable` at bubble, since capture would close the whole menu from a nested page.

## Labels

`hidden: true` is for a binding that only meets an expectation a list already sets, such as Shift with an arrow. A key drawn on its own control comes from `hintFor` and is hidden on a coarse pointer. A key is never translated; `mnemonicOf` reads the underline off the translated label.

**A hotkey that stops working in dev is usually a stale registration** from HMR. Reload fully before debugging.
