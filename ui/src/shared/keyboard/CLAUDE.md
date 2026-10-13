# The keyboard

**Bindings live in `keymap.ts` and nowhere else.** Register a binding in the component that draws its button. The transport's keys are global and no scope takes one.

**TanStack Hotkeys' manager listens on `document` at bubble and fires every enabled registration matching a key.** A focus region that answers its own keys handles them on the element and stops propagation. An Enter or Space binding is `leavesControls`: never prevented, standing down on a focused control, whose default is the click, unless it is `data-keeps-keys`.

**A virtualised list's active row is an index in state.** DOM focus goes when a row scrolls out.

## Layouts

Punctuation is declared as the character typed (`?`, never `Shift+/`), and a letter once. `keymap.test.ts` holds both, and the comment on `isTypedAsAnother()` says what TanStack Hotkeys' matcher does on another layout.

## Overlays

**An overlay owns the keyboard through `keyboardOwner.ts`.** While it does, only registrations naming it stay enabled, and a binding that both opens and closes the overlay has to be one of them.

**An overlay takes Escape in the capture phase, through `useEscapeCapture`**, because the playlist scope binds Escape to clearing the selection and a bubbling handler would do both in one keystroke. A capture listener does not stop its siblings on the same node, so the layers that claim nothing (the queue panel, the sidebar drawer, track info, the now-playing screen) stand down while `keyboardOwner` names an owner. A layer that claims the keyboard does not read it. An `ActionMenu` takes it through `useDismissable` at bubble, since capture would close the whole menu from a nested page.

## Labels

`hidden: true` is for a binding that only meets an expectation a list already sets, such as Shift with an arrow. A key drawn on its own control comes from `hintFor`. A key is never translated.

**A hotkey that stops working in dev is usually a stale registration** from HMR. Reload fully before debugging.
