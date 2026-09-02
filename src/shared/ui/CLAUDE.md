# Shared UI

Menus, gestures, drag and drop, notifications and animation -- the pieces every
feature draws with. General rules are in the root `CLAUDE.md`.

**Confirm only what is not already visible.** Creating a playlist needs no notification
-- the row appears, named, waiting to be renamed. Adding forty tracks to a playlist you
are not looking at does, and that is what a toast is for; it is also where the undo
lives. A message about something already on screen is noise.

**Anything ambient enough to need explaining gets explained once, where it happens.**
The play-count shading is the case in point: it is legible only if you already know what
it means, so it introduces itself the first time it is actually on screen, in a popover
anchored to its own control, and any click at all dismisses it for good. What it must not
be is a modal on first run -- that teaches things before there is anything to attach them
to. It also needs a permanent home for whoever meets it later or forgets, which is the
columns menu; a thing you can only be told once is a thing most people never learn.

Icons come from **`lucide-react`**, imported per-icon so they tree-shake.

## Menus, gestures and other shared behaviour

`shared/ui/ActionMenu.tsx` is the only menu surface in the app. Actions are declared as **data**
and the surface decides how to draw them -- a popover at the pointer on a desktop
viewport, a floating action sheet on a compact one. Adding a menu anywhere means writing
an array, not another component.

- **An action sheet, not a bottom sheet.** Detached from every edge, all four corners
  rounded, floating above the safe-area inset. The edge-to-edge kind is Spotify's, and is
  also the less interesting of the two.
- **Nested pages slide in place, on desktop too**, rather than flying out to the side. A
  flyout that closes when the pointer strays is the wrong place to put a confirmation,
  and one drill-in implementation beats two half-tested ones. **Destructive actions
  confirm on a nested page** -- same machinery, no dialog component, identical on both
  surfaces.
- **A nested page can be typed at.** `filter: '<placeholder>'` on a submenu node puts a
  field at the top of its page, pinned rather than scrolling away with the list it
  filters; Enter takes the first match. It matches through the same `fold()` the library
  search uses, so typing at a menu behaves like typing at the search field.
- **A sheet with a field in it has to follow the visual viewport.** A `position: fixed`
  element is laid out against the *layout* viewport, which neither platform shrinks for
  the keyboard -- iOS does not resize it at all and Chrome defaults to
  `interactive-widget=resizes-visual` -- so a bottom-anchored sheet puts its own field
  under the keyboard the moment you tap it. `shared/hooks/useVisualViewport.ts` sizes the scrim to
  `visualViewport`, which makes "above the keyboard" fall out of the existing
  `align-items: flex-end`, and follows `offsetTop` as well, because iOS scrolls the page
  to reveal a focused field. It writes to the element, not to state: iOS fires a stream
  of these while the keyboard animates.
- **The field takes focus on the popover and waits to be tapped on the sheet.** Most opens
  of a menu are scroll-and-tap, and those should never cost half the screen.
- **`touch-action: none` intersects down the tree.** It was on the sheet's scrim and would
  have left a long list unscrollable on touch. It was never needed either: the scrim
  portals to `<body>`, which has nothing to scroll.
- **The accent budget of a menu is the two-pixel rail on the item under the cursor.**
  Scaled, not faded, so it grows out of its own centre.
- **A tap plays; a click selects and a double-click plays.** The split is the
  pointer, not the viewport -- the same rule `useSortableList` uses to decide
  that only a mouse drags a row. On a pointer a selection is worth having,
  because the modifier keys exist to build one and every file manager separates
  choosing from opening. Touch has neither, and a tap that only highlighted left
  the phone with no way to play an individual track at all: the header Play
  button was the entire surface. Bound to `click` rather than `pointerup`,
  because the browser withholds it when the gesture turns out to be a scroll --
  which is most of what a finger does in a list -- and because `useLongPress`
  already swallows the one that follows a hold. Both handlers sit on the rows
  container and find their row through `targetsFrom`; 30,000 rows must not each
  carry a closure.
- **A list that appears under a stationary pointer gets a `mouseenter` it did
  not earn.** The mouse has not gone anywhere; the element beneath it changed.
  The finder's results render exactly where the button that opened them was, and
  again under the same cursor on every keystroke -- so hover handed the active
  result to whatever happened to land there, measured as the fifth match, and
  Enter played that instead of the first. Hover has to prove the pointer moved:
  a flag re-armed per result set covers the ordinary case, and comparing the
  event's coordinates against the last seen ones covers the first move onto a
  result, where `mouseenter` arrives before the `mousemove` that would have set
  the flag.
- **`useContextMenu` unifies the three ways of asking for one**: right-click,
  press-and-hold, and the Menu key -- which reports no coordinates, so a keyboard
  invocation has to anchor to the element rather than to `0,0`.
- **`useLongPress` owns the echoes of the gesture, not just the gesture.** The synthetic
  click and, on Android, a native `contextmenu` both arrive after a hold has already been
  answered, and both have to be swallowed. Suppression is time-boxed rather than cleared
  by whichever event turns up, because which one turns up differs by platform: iOS sends
  the click and no contextmenu, Android the reverse, and waiting for a specific one
  leaves the guard permanently on.
- Anything long-pressable needs `-webkit-touch-callout: none` or iOS draws its own
  selection callout over the menu. `useLongPress` returns the style to spread.
- **While a menu is open, no key belongs to the app behind it.** Without stopping
  propagation, the arrow keys seek the player while you are choosing an action.
  Tab is the exception: leaving by keyboard is the browser's business.
- **A panel that cannot take focus cannot take the keyboard**, and an invisible
  element cannot take focus. The popover renders transparent rather than
  `visibility: hidden` for the frame it is measured in, precisely so that
  focusing it then is not silently a no-op -- which is what left every key
  belonging to the app behind it despite the rule above.
- **An exit animation's "closing" flag must be derived during render, not set in an
  effect.** An effect leaves one commit in which the menu is neither open nor leaving:
  it unmounts, the effect brings it straight back to play the exit, and that remount
  re-runs the surface's focus effect. Anything the chosen action just focused loses it —
  which is how Rename came to close itself on the phone, one frame after opening.
- **A menu returns focus only if it still has it.** An action is allowed to send focus
  somewhere on purpose; restoring blindly on close undoes that.

`shared/hooks/useSortableList.ts` is drag-to-reorder for lists short enough to see at once. Rows
are measured on drag start, so variable heights need no special case. What is
load-bearing:

- **The drop is held, not cleared.** The reorder goes through the query cache, which is a
  microtask away at best, so clearing the transforms on `pointerup` flicks the row back
  to where it started for a frame. It keeps the landing transform until the caller's
  `keys` actually change, with a timeout in case the player refuses the move.
- **On a pointer the row itself drags, with no affordance at all.** That is what a
  sidebar of links does everywhere -- Finder favourites, Chrome bookmarks, Slack
  sections -- and a grip on every row is a permanent cost for something done twice a
  year. Grips are an *editor* idiom: they exist where a row has several parts and one of
  them has to be named as the one that drags.
- **Touch is a different question, not a smaller one.** There the vertical axis is
  already the scroller's, and the gesture that would normally settle it -- hold, then
  drag -- is spent on the menu. So a coarse pointer gets a permanent handle, because
  nothing else can claim the axis. Same fact, stated once in CSS and once in JS: the row
  starts a drag for `pointerType === 'mouse'` only.
- **A drag that starts on a link ends with a click on that link.** Reordering would also
  navigate. The gesture has to swallow its own click, exactly as the long press does --
  and the flag is cleared on the next pointer-down rather than on a timer, so a gesture
  that produced no click leaves nothing armed.
- **`setPointerCapture` moves the click, not just the pointer events.** It retargets the
  compatibility `mousedown` and `mouseup` too, and `click` is dispatched at the common
  ancestor of those two -- so capturing on a row makes every click land on the row
  instead of on the button inside it, and plain navigation silently stops working with
  no error anywhere. Capture only once the gesture is definitely a drag. A small handle
  is the exception and has to claim the pointer up front, because it can be left behind
  inside the threshold distance; a full-width row cannot.
- **Two behaviours on one element share their handler names.** A row that both
  press-and-holds and drags wants `onPointerDown/Move/Up/Cancel` twice over, and
  spreading one props object after the other drops the first silently. Compose them
  through `shared/lib/mergeHandlers.ts`.
- `Alt+Arrow` does the same from the keyboard, registered only while a row has focus.

## Dragging across containers

`shared/ui/dnd.ts` is the other drag primitive, and it is deliberately *not* built on
`useSortableList`. That one reorders a single list, where the dragged element stays
mounted and the drop position is arithmetic. Dragging tracks onto a sidebar playlist is a
different problem: the source row can be unmounted by the virtualiser mid-gesture, and
the target is elsewhere in the tree entirely. So the drop is decided by hit-testing the
document (`elementFromPoint` up to a `[data-drop-target]`), and what follows the pointer
is a ghost rather than the row.

- **No pointer capture, here of all places.** Capture retargets every later event to the
  capturing element, so a handler on a *descendant* of it never fires again -- and the
  natural capture element is the scroll container, which is an ancestor of the rows.
  Window listeners for the length of the gesture have none of that ambiguity.
- **The store carries only coarse facts** -- dragging or not, which target is armed.
  Those change rarely, so subscribing is free, and the track list does not subscribe at
  all. It must never re-render during a drag.
- **The ghost is moved imperatively**, because position is the one thing that changes
  every frame. It is two elements: a CSS animation beats an inline style, so an entrance
  touching `transform` would override the position and the ghost would fly in from the
  top-left. Outer element owns position, inner owns anything that animates.
- **Pressing inside a multi-track selection must not collapse it on pointer-down.** That
  decision waits for the release -- otherwise the selection is gone before the pointer has
  moved a pixel and a multi-track drag cannot exist. Every file manager does this.
- Hit-testing runs on a frame rather than on the move event, so a target that autoscrolls
  under a stationary pointer still arms.
- Drag is mouse-only, and the mobile path is the menu. There is nothing to drag onto on a
  phone: the sidebar is a drawer that covers the list it would be dragged from.
- **The ids are opaque here and must stay that way.** A target is a string this file
  hit-tests and hands back; what it means belongs to whoever registered it. Sidebar rows
  register playlist ids, the status bar's queue button registers
  `domain/player/queue.ts`'s `QUEUE_DROP_TARGET` -- and `useTrackDragSource` is the one
  place that tells the two apart, because it is the one place that knows what a drop
  should do.

**Context menus come from `shared/ui/ActionMenu.tsx`, as an array of actions.** Never hand-roll
a popover, an action sheet or a confirmation dialog -- the gestures, the keyboard
handling, the nested pages and both surfaces already exist there, and a second
implementation of any of them will be the one that is wrong on a phone. `shared/ui/Menu.tsx` is
a different thing and stays: a dropdown anchored under a button you can see, with no
gestures and no pages. Menu *you asked for* against menu *you summoned*.

**What the two do share is the keyboard, and they share the implementation of it**
(`shared/ui/menuKeys.ts`): focus into the panel on open, roving arrows over the items, and
every key taken from the app behind. They did not, and the difference was invisible
until it was written down -- Escape closed the dropdown *and* cleared the track
selection behind it, in one keystroke.

**A switch is not a checkbox, and Jean has both.** The line every design system draws
is *when it takes effect*: a switch acts the moment it moves, a checkbox is a selection
that something else submits. So the columns menu is checkboxes -- they choose from a set
-- and `shared/ui/Switch.tsx` is a switch, for a setting that changes what the app does
before your finger leaves it. Picking the wrong one implies a Save button that is not
there, or implies its absence where there is one. It carries `role="switch"` rather than
a styled checkbox, because the state is on/off with no indeterminate third and a reader
should say "on" rather than "checked", and **the label is inside the control** so the
whole row is the target -- a 34px switch is a poor thing to aim at with a thumb while
the words next to it do nothing. The travel is the affordance, so `prefers-reduced-motion`
drops the transition and keeps the movement; a colour swap with nothing moving is a
state change with no gesture in it.

**Notifications come from `shared/ui/toastStore.ts`, and only for things you cannot see.** Pushing
one is a bare function call from anywhere, deliberately -- it is a module-level store
rather than a context because a provider holding the list would re-render the virtualised
track list every time a toast appeared or expired.

**A touch target is not a pointer target, and a fader is where that shows.** The
mobile volume column was 26px of track -- a thumb is about 44px of contact, so it
missed often, and a miss there does nothing at all: the popover sits in the status
bar, outside the only scroll container, so there is not even a page pan to blame
it on. A control that ignores every second attempt feels broken without ever being
wrong. The hit area is widened on `(pointer: coarse)` while the visible rail stays
4px, and the thumb is drawn permanently there, because on touch there is no hover
to reveal it with and a thumb that appears once you are already dragging is one
you aimed at from memory. The keyboard-shortcuts button goes on the same query and
for the same kind of reason -- and nothing is lost where a keyboard exists, since
the sheet is bound to `?`.

**A control you drag must be unselectable.** Press on a slider without
`user-select: none` and the browser starts a text selection running out across
whatever sits beside it; dragging a selection is a native drag, so it paints a
translucent snapshot of the control and follows the pointer with that instead of
moving the thumb. It looks like the slider has come loose, and it reads as
intermittent because it depends on where the press landed and what was already
selected. `useDragFraction` returns the style with its handlers so the two
cannot be separated. It carries `touch-action: none` as well, which each consumer
used to declare in its own CSS: without it the browser keeps the gesture for
panning and cancels the pointer stream mid-drag -- *measured*, a swipe aimed at
25% lands at 74% -- and a guarantee a primitive depends on should not be one every
caller has to remember.

**Writes driven by a drag must be coalesced, not fired per event.** One pointer
gesture is ~40 pointer moves; a request each floods the player, and the responses
can land out of order so the last value to arrive wins rather than the last one
sent. `useCoalescedWrite` keeps one request in flight and sends the newest value
after it. Drag state stays local to the control -- writing it into shared player
state on every move re-renders every subscriber, including the virtualised list,
for the whole gesture.

**An animated scroll must not treat every wheel event as a decision.** Trackpad
and mouse momentum keep emitting for a second or more after the fingers have
left, so a jump asked for at the end of a flick gets cancelled by the tail of
the gesture that preceded it -- measured, a single delta of one pixel stranded
the scroll partway and left the target row not merely off centre but unmounted.
That is the whole of "jump to playing works sometimes": it depended on whether
the list happened to still be coasting. `animateScrollTo` accumulates wheel
delta and gives up at 40px, which deliberate scrolling passes in one or two
events and a decaying tail never reaches. A touch still cancels on contact,
because a finger on the glass is unambiguous where a wheel event is not.

**Animation is compositor-only by default** — `transform`, `scale`, `rotate`,
`opacity`. `border-radius` and layout properties repaint every frame; that is
acceptable for a single small element and not for anything in a list. Continuous
motion should layer animations with coprime durations rather than repeat a single
short loop, and must never move an element's position on screen.

That last rule is about the thing being *aimed at*, not about the pixels. The "Now
playing" pill's arrow nods, and it is on the icon rather than on the pill
precisely because the pill is a button: a transform on a child leaves the parent's
laid-out box exactly where it was, so what you are clicking holds still while what
you are looking at does not. It runs only while the pill is on screen -- the pill
stays mounted so it can animate out, and an animation ticking behind an invisible
element for a whole session costs something and shows nothing.

**Slow is not the same as smooth, and speed is not the whole of it either.** That
arrow first moved 2.1px over a 2.3s cycle -- about **1.8px a second** -- and read
as stuttering; raising it to 1.6px over 850ms, ~3.8px a second, was necessary and
not sufficient. It still read as *two frames*, up and down, and the cause was the
curve's shape rather than its speed: **any easing on a two-stop keyframe brings
the element to a dead stop at 0%, 50% and 100%.** *Measured*, 18% of frames moved
less than 0.02px -- visually nothing -- so the eye integrated the rest into two
resting positions with a flick between them. It is now a sine sampled into six
stops and interpolated `linear`, which has a non-zero slope in every segment: 2%
still frames, 2.4px over the same 850ms. `linear` there is load-bearing, not a
default -- an easing would turn the six stops into six little ease-in-outs and
reintroduce the stop six times over.

Two things were ruled out before the curve was, and both are worth ruling out
first next time. **Sub-pixel rasterisation**: pausing the animation at 34 phases
and hashing the rendered icon gave 31 distinct images at 1x DPR, so the browser
was drawing the in-between positions perfectly well -- there was nothing there to
draw. And **a per-frame figure judges the monitor, not the motion**: the same
animation moves half as far per frame at 120Hz, which is how the first
measurement here looked conclusive while being wrong. Per-frame numbers are only
good for comparing two curves on one display; state the speed in px/s and the
still-frame fraction, which are both display-independent.
