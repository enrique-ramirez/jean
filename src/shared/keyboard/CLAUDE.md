# The keyboard

The keymap, the manager it registers into, and who owns the keyboard when a layer is up. Desktop is keyboard-first.

**Bindings live in `keymap.ts` and nowhere else.** `useKeymap` registers whatever a scope declares and has a handler for, and `ShortcutSheet` renders the help overlay from the same array, so the documented shortcuts cannot drift from the real ones. Never call the hotkeys library directly from a component.

**Register a binding where the button lives, when there is a button.** The component that owns the call also owns the question of whether the action is possible at all, so the key and the button cannot disagree and the key is live on exactly the views that draw it.

**A focus region answers its own keys on the element, and the shortcut sheet does not list them.** The manager fires *every* enabled registration matching a key — conflicts are reported, not resolved — and the track list holds the arrows and Enter for its own cursor. **So the region stops the event**: the manager listens on `document` at bubble, below React's root, and `stopPropagation` from inside settles it.

**Enter is stopped without being prevented.** A focused row is a button and the browser's default action on Enter is the click that opens it; preventing it makes a keyboard-navigable sidebar a dead end. Space is deliberately *not* stopped — it is the transport everywhere in Jean, and a row is reachable with Enter.

**Virtualisation and keyboard navigation collide.** The virtualiser unmounts the focused row when it scrolls out of view and DOM focus evaporates, so **the active row MUST be an index in state** and the virtualiser told to scroll that index into view. A roving `tabindex` alone will not survive it. Every list component has to be built knowing that.

## Layouts

**Punctuation is declared as the character you type, never as the unshifted key plus Shift.** The matcher compares `event.key` first and falls back to `event.code` through a **QWERTY** punctuation map, so `Shift+/` means "the character on the physical slash key, with Shift held" — `?` on US QWERTY and something else nearly everywhere. A `?` arrives on three different `code` values across Dvorak, Spanish and French; `Shift+/` matches none of them and `Shift+?` matches all three. The mirror image is `=` and `-` for volume, unreachable wherever `=` is itself `Shift+0`, where the *modifier* is the mismatch.

So **a shifted character is declared twice**, `Shift+X` and bare `X`, so it works whether or not a layout shifts to reach it. `shifted()` exists because the hotkeys library's type excludes Shift plus punctuation, and `shown` overrides what the sheet draws, since two registrations are one key to press.

**Letters need none of this and MUST NOT get it.** For a letter the matcher returns on the `event.key` comparison and never consults `event.code`, so `T` is the key that types a t wherever the layout puts it.

## What the browser owns

**A binding a browser has claimed cannot be taken back.** `Mod+Shift+P` opens a private window in Firefox and its derivatives, so the page never sees the keystroke. Every modifier combination worth having belongs to some browser and a bare letter belongs to none of them, so bare letters are the app's idiom.

**`Mod+,` is knowingly at risk.** It is the platform convention for preferences and therefore the key people try — and also a *menu item* in Chrome, Safari and Firefox on macOS, where a menu key equivalent is resolved before the page is offered the keystroke. If it is eaten, a bare `,` is free.

## Overlays

**An overlay owns the keyboard** (`keyboardOwner.ts`). A dialog leaves the app behind it mounted, so a bare letter would still act on a list nobody can see and Space on a focused switch would both flip it and pause the music — a `<button role="switch">` is not an input element, so the manager's input guard does not cover it. While an overlay holds the keyboard only registrations naming it stay enabled, and **the binding that opens the overlay MUST be one of them**, or it cannot close it again.

**Escape in an overlay MUST be caught in the capture phase**, which is what `useEscapeCapture` is for. The manager binds `keydown` on the document at bubble and the playlist scope binds Escape to clearing the track selection, so a later listener would close the overlay *and* wipe the selection in one keystroke.

**Claiming the keyboard and taking Escape are one job, not two.** A capture listener does not stop its siblings on the same node, so an overlay that takes Escape without claiming the keyboard leaves every layer under it taking the same keystroke. Layers stand down on `keyboardOwner`, which is only true of an overlay that claimed it.

## Documenting

**`hidden: true` is registered but not documented, and it is not a way to hide a binding you have not thought about.** It is for bindings that only meet an expectation a list already sets — Shift plus arrow extending a selection, Escape dropping it. Anything a person would not guess belongs in the sheet, and the corollary is that **a binding not worth documenting is usually not worth having.**

**A binding drawn on its own control has to be read off the same declaration**, so the label and the key are one fact rather than two that drift. Hide the hint on a coarse pointer, where there is no key to press.

**A binding's name and group are phrases, and the key it presses is not.** Translating a shortcut would give one keyboard two meanings, so keys stay put and the initial they spell stops being an initial in most languages. `mnemonicOf` therefore reads the underline off the label it is handed — hand it the *translated* one and a language whose word does not begin with the key underlines nothing, rather than advertising a key that does something else.

## Debugging

**A hotkey that has stopped working in dev is probably a stale registration, not a bug.** Two enabled registrations on one key both fire, with a console warning. HMR remounts a component and re-registers while the previous module instance's registration may still be in the registry, so the survivor can hold a callback from a dead closure: the binding looks bound and does nothing. Full reload before debugging.
