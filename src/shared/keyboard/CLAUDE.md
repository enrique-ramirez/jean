# The keyboard

Desktop is keyboard-first, and every binding is declared in one place.

**Bindings live in `keymap.ts` and nowhere else.** `useKeymap(scope, handlers)` registers whatever that scope declares and has a handler for, and `ShortcutSheet` renders the help overlay from the same array, so the documented shortcuts cannot drift from the real ones. Adding a binding means adding a row there and a handler. Never call `useHotkey` directly in a component.

**Register a binding where the button lives, when there is a button.** `S` (shuffle play) is registered by `PlayActions`, not by `TrackBrowser`, because that component already owns both the call and the question of whether shuffling this view is possible at all — so the key and the button cannot disagree, and the key is live on exactly the views that draw the button.

**Virtualisation and keyboard navigation collide.** The virtualiser unmounts the focused row when it scrolls out of view and DOM focus evaporates, so **the active row is an index in state** and the virtualiser is told to scroll that index into view. A roving `tabindex` alone will not survive this. Every list component must be built knowing it.

## Layouts

**Punctuation is declared as the character you type, never as the unshifted key plus Shift.** The matcher compares `event.key` first and falls back to `event.code` through a **QWERTY** punctuation map, so `Shift+/` means "the character on the physical slash key, with Shift held" — `?` on US QWERTY and something else nearly everywhere. A `?` arrives as `key: '?'` with `code: 'BracketLeft'` on Dvorak, `'Minus'` on Spanish and `'Comma'` on French; `Shift+/` matches none of them and `Shift+?` matches all three. The mirror image is `=` and `-` for volume, unreachable wherever `=` is `Shift+0`, where the *modifier* is the mismatch.

So: **a shifted character is declared twice**, `Shift+X` and bare `X`, so it works whether or not a layout shifts to reach it. `shifted()` in `keymap.ts` exists because the hotkeys type excludes Shift+punctuation. `shown` overrides what the sheet draws, since `?`, `=` and `-` are each two registrations and one key to press.

**Letters need none of this and must not get it.** For a letter the matcher returns on the `event.key` comparison and never consults `event.code`, so `T` is the key that types a t wherever the layout puts it.

## What the browser owns

**A binding a browser has claimed cannot be taken back.** `Mod+Shift+P` opens a private window in Firefox and its derivatives, so it never sees the keystroke. Every modifier combination worth having belongs to some browser and a bare letter belongs to none of them, which is why `Q`, `T`, `V`, `H`, `N`, `S` and `G` are the app's idiom rather than an accident.

**`Mod+,` is knowingly at risk.** It is the platform convention for preferences and therefore the key people try — and also a *menu item* in Chrome, Safari and Firefox on macOS, where a menu key equivalent is resolved before the page is offered the keystroke. It may work everywhere or nowhere depending on the browser. If it is eaten, a bare `,` is free.

## Overlays

**An overlay owns the keyboard** (`keyboardOwner.ts`). A dialog leaves the app behind it mounted, so `V` would still switch the layout of a list nobody can see and `Space` on a focused switch would both flip it and pause the music — a `<button role="switch">` is not an input element, so `ignoreInputs` does not cover it. `useKeymap` takes an `owner`, and while an overlay holds the keyboard only registrations naming it stay enabled. **The binding that opens the overlay MUST be one of them**, or it cannot close it again.

**Escape in an overlay MUST be caught in the capture phase**, which is what `useEscapeCapture` is. The hotkey manager binds `keydown` on the document at bubble, and `Escape` in the playlist scope clears the track selection — so a later listener would close the overlay *and* wipe the selection in one keystroke.

**Claiming the keyboard and taking Escape are one job, not two.** A capture listener does not stop its siblings on the same node, so an overlay that takes Escape without claiming the keyboard leaves every layer under it taking the same keystroke — the now-playing screen stands down on `keyboardOwner`, which is only true of an overlay that claimed it.

## Mnemonics

**A binding drawn on its own control has to be read off the same declaration.** The now-playing tabs answer to their initials and underline the letter, so the label and the key are one fact rather than two that drift; the hint is hidden on a coarse pointer, where there is no key to press.

## Documenting

**`hidden: true` is registered but not documented**, and it is not a way to hide a binding you have not thought about. It is for bindings that only meet an expectation a list already sets: `Shift`+arrow extending a selection, `Escape` dropping it, the arrows and `Enter` inside the finder. Anything a person would not guess belongs in the sheet — and the corollary is that **a binding not worth documenting is usually not worth having.**

## Debugging

**A hotkey that has stopped working in dev is probably a stale registration, not a bug.** `useKeymap` registers into a module-level manager that resolves conflicts between registrations claiming the same key. HMR remounts a component and re-registers while the previous module instance's registration may still be in the registry, so the survivor can hold a callback from a dead closure: the binding looks bound and does nothing. Full reload before debugging.
