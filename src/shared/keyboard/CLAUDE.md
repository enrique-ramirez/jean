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

**Punctuation is declared as the character you type, never as the unshifted key plus
Shift.** This was two bugs with one cause. The matcher compares `event.key` first and
falls back to `event.code` through a **QWERTY** punctuation map, so `Shift+/` does not
mean "?" — it means "the character on the physical slash key, with Shift held", which is
`?` on US QWERTY and something else nearly everywhere. *Measured* against the matcher: a
`?` arrives as `key: '?'` with `code: 'BracketLeft'` on Dvorak, `'Minus'` on Spanish and
`'Comma'` on French; `Shift+/` matched none of them and `Shift+?` matched all three,
because `?` is compared against `event.key` and every layout reports that identically.
The mirror image was `=` and `-` for volume, unreachable wherever `=` is `Shift+0`,
because there the *modifier* was the mismatch. Both are fixed the same way and it is the
rule now: **a shifted character is declared twice**, `Shift+X` and bare `X`, so it works
whether or not a layout shifts to reach it. `shifted()` in `keymap.ts` exists because the
hotkeys type excludes Shift+punctuation — sensibly, since it is a footgun everywhere
except here.

**Letters need none of this and must not get it.** For a letter the matcher returns on
the `event.key` comparison and never consults `event.code`, so `T` is the key that types
a t wherever the layout puts it. That is the right behaviour and the reason a Dvorak
user is not otherwise inconvenienced: only the one binding that encoded a physical key
was broken.

**A binding a browser has claimed cannot be taken back.** `Mod+Shift+P` opens a private
window in Firefox and its derivatives, so "Go to playlist" never saw the keystroke; it is
`G` now. Every modifier combination worth having belongs to some browser, and a bare
letter belongs to none of them — which is why `Q`, `T`, `V`, `H`, `N`, `S` and `G` are the
app's idiom rather than an accident.

**`Mod+,` is knowingly at risk.** It is the platform convention for preferences
and therefore the key people try -- and also a *menu item* in Chrome, Safari and
Firefox on macOS, where a menu key equivalent is resolved before the page is
offered the keystroke. Unlike `Mod+Shift+P` it may work everywhere or nowhere
depending on the browser. `Mod+K` is the encouraging precedent: an omnibox
shortcut rather than a menu item, and Jean takes it. If it is eaten, a bare `,`
is free.

**An overlay owns the keyboard** (`keyboardOwner.ts`). Settings as a route
unmounted the track list; as a dialog it left `V` switching the layout of a list
nobody could see and `Space` on a focused switch both flipping it and pausing the
music -- a `<button role="switch">` is not an input element, so `ignoreInputs`
does not cover it. `useKeymap` takes an `owner`, and while an overlay holds the
keyboard only registrations naming it stay enabled. **The binding that opens the
overlay MUST be one of them**, or it cannot close it again. A store rather than a
`keysEnabled` prop threaded through three views: this is not a question about a
list.

**Escape in an overlay MUST be caught in the capture phase.** The hotkey manager
binds `keydown` on the document at bubble, and `Escape` in the playlist scope
clears the track selection -- so a later listener closes the overlay *and* wipes
the selection, in one keystroke.

**Keyboard bindings are declared in `shared/keyboard/keymap.ts` and nowhere else.**
`useKeymap(scope, handlers)` registers whatever that scope declares and has a handler
for, and `ShortcutSheet` renders the help overlay from the same array — so the
documented shortcuts cannot drift from the real ones. Adding a binding means adding a
row there and a handler; never call `useHotkey` directly in a component.

**Register a binding where the button lives, when there is a button.** `S` (shuffle
play) is registered by `PlayActions`, not by `TrackBrowser`, because that component
already owns both the call and the question of whether shuffling this view is possible
at all — so the key and the button cannot disagree, and the key is live on exactly the
views that draw the button: a playlist, a shelf, All music, search results.

**`hidden: true` is registered but not documented, and it is not a way to hide a
binding you have not thought about.** It is for the ones that only meet the expectation
a list already sets: `Shift`+arrow extending a selection, `Escape` dropping it, the
arrows and `Enter` inside the finder. Those are Jean's code rather than the browser's,
so they must stay bound — but a row in the sheet teaching them spends the reader's
attention and returns nothing. Anything a person would not guess belongs in the sheet,
and the corollary is the one that trimmed this file: **a binding not worth documenting
is usually not worth having.** `J` and `K` went that way — a second spelling of the
arrow keys, listed beside them, teaching that Jean has vim bindings and nothing else.

**`shown` overrides what the sheet draws** when the registrations are not what a person
should be told. `?` is two registrations and one key to press; so are `=` and `-`.
