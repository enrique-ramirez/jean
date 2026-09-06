# Shared UI

Menus, gestures, drag and drop, notifications and animation — the pieces every feature draws with.

**Confirm only what is not already visible.** Creating a playlist needs no notification: the row appears, named, waiting to be renamed. Adding forty tracks to a playlist you are not looking at does, and that is also where the undo lives. A message about something already on screen is noise.

**Anything ambient enough to need explaining gets explained once, where it happens.** The play-count shading introduces itself the first time it is actually on screen, in a popover anchored to its own control, and any click dismisses it for good. Not a modal on first run — that teaches things before there is anything to attach them to. It also needs a permanent home for whoever meets it later, which is the columns menu.

Icons come from `lucide-react`, imported per-icon so they tree-shake. **The playing mark is not one of them**: `Equalizer.tsx` is three animated bars and one component, shared by the track list's playing row and the output picker's rows, because "sound is coming out of this" has to look the same wherever it is said.

## Menus

**`ActionMenu.tsx` is the only menu surface in the app**, and actions are declared as **data**: the surface decides how to draw them — a popover at the pointer on a desktop viewport, a floating action sheet on a compact one. Adding a menu means writing an array, not another component. **Never hand-roll a popover, an action sheet or a confirmation dialog.**

`Menu.tsx` is a different thing and stays: a dropdown anchored under a button you can see, with no gestures and no pages. Menu *you asked for* against menu *you summoned*.

- **An action sheet, not a bottom sheet.** Detached from every edge, all four corners rounded, floating above the safe-area inset.
- **Nested pages slide in place, on desktop too**, rather than flying out to the side. A flyout that closes when the pointer strays is the wrong place for a confirmation, and one drill-in implementation beats two half-tested ones. **Destructive actions confirm on a nested page** — same machinery, no dialog component, identical on both surfaces.
- **A nested page can be typed at.** `filter: '<placeholder>'` on a submenu node puts a field at the top of its page, pinned rather than scrolling away with the list it filters; Enter takes the first match. It matches through the same `fold()` the library search uses.
- **The field takes focus on the popover and waits to be tapped on the sheet.** Most opens of a menu are scroll-and-tap, and those should never cost half the screen.
- **A sheet with a field in it has to follow the visual viewport.** A `position: fixed` element is laid out against the *layout* viewport, which neither platform shrinks for the keyboard — iOS does not resize it and Chrome defaults to `interactive-widget=resizes-visual` — so a bottom-anchored sheet puts its own field under the keyboard the moment you tap it. `useVisualViewport.ts` sizes the scrim to `visualViewport`, which makes "above the keyboard" fall out of the existing `align-items: flex-end`, and follows `offsetTop` too, because iOS scrolls the page to reveal a focused field. It writes to the element, not to state: iOS fires a stream of these while the keyboard animates.
- **`touch-action: none` intersects down the tree.** On a sheet's scrim it leaves a long list unscrollable on touch, and it is not needed there: the scrim portals to `<body>`, which has nothing to scroll.
- **The accent budget of a menu is the two-pixel rail on the item under the cursor.** Scaled, not faded, so it grows out of its own centre.
- **While a menu is open, no key belongs to the app behind it.** Without stopping propagation the arrow keys seek the player while you are choosing an action. Tab is the exception: leaving by keyboard is the browser's business.
- **A panel that cannot take focus cannot take the keyboard, and an invisible element cannot take focus.** The popover renders transparent rather than `visibility: hidden` for the frame it is measured in, precisely so that focusing it then is not silently a no-op.
- **An exit animation's "closing" flag must be derived during render, not set in an effect.** An effect leaves one commit in which the menu is neither open nor leaving: it unmounts, the effect brings it straight back to play the exit, and that remount re-runs the surface's focus effect — so anything the chosen action just focused loses it.
- **A menu returns focus only if it still has it.** An action is allowed to send focus somewhere on purpose; restoring blindly on close undoes that.
- **`useContextMenu` unifies the three ways of asking for one**: right-click, press-and-hold, and the Menu key — which reports no coordinates, so a keyboard invocation anchors to the element rather than to `0,0`.

**`ActionMenu` and `Menu` share the keyboard implementation** (`menuKeys.ts`): focus into the panel on open, roving arrows over the items, every key taken from the app behind. Without it, Escape closed the dropdown *and* cleared the track selection behind it in one keystroke.

## Pointer versus touch

**A tap plays; a click selects and a double-click plays.** The split is the pointer, not the viewport — the same rule `useSortableList` uses to decide that only a mouse drags a row. On a pointer a selection is worth having, because the modifier keys exist to build one and every file manager separates choosing from opening. Touch has neither, and a tap that only highlighted would leave a phone with no way to play an individual track. Bound to `click` rather than `pointerup`, because the browser withholds it when the gesture turns out to be a scroll — which is most of what a finger does in a list — and because `useLongPress` already swallows the one that follows a hold. Both handlers sit on the rows container and find their row through `targetsFrom`; 30,000 rows must not each carry a closure.

**`useLongPress` owns the echoes of the gesture, not just the gesture.** The synthetic click and, on Android, a native `contextmenu` both arrive after a hold has been answered, and both have to be swallowed. **Suppression is time-boxed rather than cleared by whichever event turns up**, because which one turns up differs by platform: iOS sends the click and no contextmenu, Android the reverse, and waiting for a specific one leaves the guard permanently on. Anything long-pressable also needs `-webkit-touch-callout: none`, which the hook returns as a style to spread.

**A list that appears under a stationary pointer gets a `mouseenter` it did not earn.** The mouse has not moved; the element beneath it changed. The finder's results render exactly where the button that opened them was, and again under the same cursor on every keystroke, so hover would hand the active result to whatever landed there and Enter would play that instead of the first. **Hover has to prove the pointer moved**: a flag re-armed per result set covers the ordinary case, and comparing the event's coordinates against the last seen ones covers the first move onto a result, where `mouseenter` arrives before the `mousemove` that would have set the flag.

**A touch target is not a pointer target.** A 26px fader track is missed often by a ~44px thumb, and a miss there does nothing at all — which reads as broken without ever being wrong. Hit areas widen on `(pointer: coarse)` while the visible rail stays 4px, and the thumb is drawn permanently there, because on touch there is no hover to reveal it and a thumb that appears once you are already dragging is one you aimed at from memory.

## Reordering

`useSortableList.ts` is drag-to-reorder for lists short enough to see at once. Rows are measured on drag start, so variable heights need no special case.

- **The drop is held, not cleared.** The reorder goes through the query cache, which is a microtask away at best, so clearing the transforms on `pointerup` flicks the row back for a frame. It keeps the landing transform until the caller's `keys` change, with a timeout in case the player refuses the move.
- **On a pointer the row itself drags, with no affordance at all.** That is what a sidebar of links does everywhere, and a grip on every row is a permanent cost for something done twice a year. Grips are an *editor* idiom: they exist where a row has several parts and one has to be named as the one that drags.
- **Touch is a different question, not a smaller one.** There the vertical axis is already the scroller's and hold-then-drag is spent on the menu, so a coarse pointer gets a permanent handle. Same fact stated once in CSS and once in JS: the row starts a drag for `pointerType === 'mouse'` only.
- **A drag that starts on a link ends with a click on that link**, so the gesture swallows its own click. The flag is cleared on the next pointer-down rather than on a timer, so a gesture that produced no click leaves nothing armed.
- **`setPointerCapture` moves the click, not just the pointer events.** It retargets the compatibility `mousedown` and `mouseup`, and `click` is dispatched at the common ancestor of those two — so capturing on a row makes every click land on the row instead of on the button inside it, and navigation silently stops working with no error anywhere. **Capture only once the gesture is definitely a drag.** A small handle is the exception and must claim the pointer up front, because it can be left behind inside the threshold distance.
- **Two behaviours on one element share their handler names.** A row that both press-and-holds and drags wants `onPointerDown/Move/Up/Cancel` twice over, and spreading one props object after the other drops the first silently. Compose through `shared/lib/mergeHandlers.ts`.
- `Alt+Arrow` does the same from the keyboard, registered only while a row has focus.

## Dragging across containers

`dnd.ts` is the other drag primitive, deliberately **not** built on `useSortableList`. That one reorders a single list, where the dragged element stays mounted and the drop position is arithmetic. Dragging tracks onto a sidebar playlist is a different problem: the source row can be unmounted by the virtualiser mid-gesture, and the target is elsewhere in the tree. So the drop is decided by hit-testing the document (`elementFromPoint` up to a `[data-drop-target]`), and what follows the pointer is a ghost rather than the row.

- **No pointer capture, here of all places.** Capture retargets every later event to the capturing element, so a handler on a *descendant* never fires again — and the natural capture element is the scroll container, which is an ancestor of the rows. Window listeners for the length of the gesture have none of that ambiguity.
- **The store carries only coarse facts** — dragging or not, which target is armed. Those change rarely, so subscribing is free. **The track list does not subscribe at all and must never re-render during a drag.**
- **The ghost is moved imperatively**, because position is the one thing that changes every frame. It is two elements: a CSS animation beats an inline style, so an entrance touching `transform` would override the position and the ghost would fly in from the top-left. Outer element owns position, inner owns anything that animates.
- **Pressing inside a multi-track selection must not collapse it on pointer-down.** That decision waits for the release, or the selection is gone before the pointer has moved a pixel and a multi-track drag cannot exist.
- Hit-testing runs on a frame rather than on the move event, so a target that autoscrolls under a stationary pointer still arms.
- Drag is mouse-only; the mobile path is the menu. There is nothing to drag onto on a phone, since the sidebar is a drawer covering the list it would be dragged from.
- **A target may arm *and* refuse.** `data-drop-refuses` carries a sentence the store republishes as
  `refusal`, the ghost draws instead of the payload, and the drop silently does not happen. Filtering
  the target out with `canDrop` instead leaves the pointer over a row that reacts to nothing, and the
  reason arrives as a toast *after* the decision rather than before it. The sentence is read off the
  DOM, so this file still knows nothing about what a refusal means.
- **The ids are opaque here and must stay that way.** A target is a string this file hit-tests and hands back; what it means belongs to whoever registered it. `useTrackDragSource` is the one place that tells a playlist id from `QUEUE_DROP_TARGET`, because it is the one place that knows what a drop should do.

## Controls

**A switch is not a checkbox, and Jean has both.** The line is *when it takes effect*: a switch acts the moment it moves, a checkbox is a selection something else submits. So the columns menu is checkboxes and `Switch.tsx` is a switch. Picking the wrong one implies a Save button that is not there, or implies its absence where there is one. It carries `role="switch"` rather than a styled checkbox — the state is on/off with no indeterminate third and a reader should say "on" — and **the label is inside the control** so the whole row is the target. The travel is the affordance, so `prefers-reduced-motion` drops the transition and keeps the movement.

**`HelpHint.tsx` holds a caveat worth having and not worth reading.** The label carries the setting; the hint carries the exception. Reach for it only when the text says something the label does not. It returns a **fragment**, and the head row it sits in must `flex-wrap` so the text takes the line below the button. It is not a popover: an absolutely positioned panel inside a scrolling column is clipped by that scroller.

**Notifications come from `toastStore.ts`, and only for things you cannot see.** Pushing one is a bare function call from anywhere, deliberately — a module-level store rather than a context, because a provider holding the list would re-render the virtualised track list every time a toast appeared or expired. The test is strict: queueing shows you the queue instead, because a stack of three saying "Queued 1 track" covers the rows being queued from to report something the panel can show.

**An ask is the shape for the other half of that** — `shared/lib/ask.ts`, a one-shot request raised where the thing that can grant it is not. Queueing asks for the queue panel; the now-playing header asks a list for the playing row. Both are answered by a component the raiser cannot name, which is the thing a prop would have to do, and both stand until answered because what answers them has to arrive or load first.

**A control you drag must be unselectable.** Press on a slider without `user-select: none` and the browser starts a text selection; dragging a selection is a native drag, so it paints a translucent snapshot of the control and follows the pointer with that instead of moving the thumb. `useDragFraction` returns the style with its handlers so the two cannot be separated, and it carries `touch-action: none` as well — without it the browser keeps the gesture for panning and cancels the pointer stream mid-drag, so a swipe aimed at 25% lands at 74%. A guarantee a primitive depends on should not be one every caller has to remember.

**Writes driven by a drag must be coalesced, not fired per event.** One pointer gesture is ~40 moves; a request each floods the player, and responses can land out of order so the last value to *arrive* wins rather than the last one sent. `useCoalescedWrite` keeps one request in flight and sends the newest value after it. Drag state stays local to the control — writing it into shared player state on every move re-renders every subscriber for the whole gesture.

## Swipes and scrolling

**A flick is not a drag, and `useSwipe.ts` answers one question at the end** — which way, if any. Four callers want exactly that and nothing follows the finger for them. Touch only, for the same reason only a mouse drags a row.

**`onDrag` is how a caller takes the horizontal axis back**, and giving it changes three things at once, which is why it is one option rather than three. The axis is decided **during** the gesture instead of at the end — once at the first 8px of movement, and held, because re-deciding per move hands a wheel back and forth under a drifting thumb. `onLeft` and `onRight` stop firing for a gesture it tracked, since a caller watching the whole drag knows how far round it got and the hook does not. And the flick clock stops applying: a drag that followed the finger for two seconds was deliberate for all of it, where an untracked one that slow is a scroll that ended somewhere.

**The tracked surface must be told the gesture ended even when the browser took it away**, so `onDragEnd` fires from `touchcancel` too. Without that it sits wherever the finger left it, forever.

**A tracked surface writes its own transform and does not re-render per move.** `useDragFraction` holds the fraction in state and is right to — it drives a 26px column — but the now-playing wheel is the whole player, and sixty renders a second there would repaint the transport, the seek bar and the identity to move one `rotate()`.

**It reads touch events, not pointer events, and that is the design.** The browser cancels the pointer stream the moment it claims a gesture for scrolling — a downward flick inside a scrollable panel arrives as `pointercancel` and never a `pointerup` — so a pointer-based swipe can only see gestures on regions that do not scroll. Touch events keep firing through a scroll, which is what lets one handler cover a whole surface that also scrolls.

**A gesture that competes with scrolling is settled by scroll *position*, not by region.** Down fires only when the thing under the finger had nowhere left to scroll up to, and up only when it had nowhere left to scroll down to; halfway through a list either flick is just scrolling. Carving out the parts of a surface that happen not to scroll leaves whatever the user is actually reading as the one place the gesture does not work. **A surface with nothing to scroll is at both ends at once**, which is what lets one panel answer to both directions and a long lyric answer to neither until it is read.

**A gesture whose target leaves the document stops being delivered.** React listens at the root, and touch events after `touchstart` go to the node the finger landed on — so when that node is replaced mid-gesture the moves never reach the handler and the flick arrives as a tap where it began. A cover resolving from placeholder to image is the one that bit, which is half of why `Artwork` is now one element for every state rather than three; where a swipe surface does swap something out under the finger, `pointer-events: none` hands the touch to a box that stays put. **Do not key such an element on the thing that changes**, either: the key is a second way to detach it.

**A control that follows the finger is not part of the surface it sits on.** `useDragFraction` marks everything it makes with `data-owns-touch` and `useSwipe` records nothing when a touch begins under that mark, so a fader dragged down inside a swipeable screen changes the volume rather than dismissing it. Scroll position cannot settle this one — the drag is on a control that never scrolls, so the flick reads as deliberate every time.

**`shared/lib/scrollParent.ts` takes a boundary, and a layered surface must pass one.** The walk otherwise goes straight past an overlay and returns the scroller *underneath* it, which is off screen, belongs to something else, and reports a scroll position that quietly changes the answer.

**An animated scroll must not treat every wheel event as a decision.** Trackpad and mouse momentum keep emitting for a second or more after the fingers have left, so a jump asked for at the end of a flick gets cancelled by the tail of the gesture that preceded it — a single delta of one pixel is enough to strand the scroll and leave the target row unmounted. `animateScrollTo` accumulates wheel delta and gives up at 40px, which deliberate scrolling passes in one or two events and a decaying tail never reaches. A touch still cancels on contact, because a finger on the glass is unambiguous where a wheel event is not.

## Fields

**`Input.tsx` is the only text field in Jean**, and not a wrapper anybody may skip. The box, the
focus ring, the placeholder and three sizes live there; what differs between callers is only what
sits either side of the text, and those are slots — `leading`, `trailing`, and `underlay` for a ghost
completion that has to share the input's own metrics. Every field in the app is one: the top-bar
search, the finder, the command palette, the action-menu filter, save-as-playlist, the `foo_jean`
token and its device name, this device's name, the genre finder and the autoplaylist dialog. The one
exception is the sidebar's rename, which replaces a row in place rather than sitting in a form.

**An `<input>` asserts about twenty characters of width on everything above it, and `min-width: 0`
does not take that back.** It lowers the floor the input may shrink to, which is why the field itself
looked fine, while leaving the min-content size its ancestors are measured by untouched — so the top
bar could not be sized below 424px, the document could not either, and every phone narrower than that
scrolled sideways. `width: 0` on the input is what withdraws the claim; the flex line hands the space
straight back. The rule is general and belongs here rather than at a caller, since this is the only
field in the app.

The ring is **a tinted border and a soft spread on the field**, never a hard outline and never on the
input: the input is chromeless by construction, so the global `:focus-visible` rule drew a second
rounded rectangle inside the first and read as a field nested in a field. It had been fixed
separately in three places before it was one component. Every field is `--radius-pill`, because a
square field beside a pill button is what makes it look like a mistake.

## Artwork

**Three gates, answering different questions.** `nearViewport.ts` decides *whether to ask at all* —
a grid can mount far more covers than it shows, and the genres index is 141 tiles of which a dozen
are on screen; it answers once and never takes the answer back, because a cover scrolled past keeps
the picture it has. `artworkCache.ts` decides *whether the network is involved*. The artwork queue
decides *how many ask at once*. None of them is `loading="lazy"`, whose answer to "is this visible"
is yes for every row a jump scrolls past.

**beefweb defeats the browser's own cache and there is nothing a client can do about it.** Every
response carries `Cache-Control: max-age=3, must-revalidate` from one filter that does not
distinguish a 600 KB sleeve from a status poll (`cpp/server/cache_support_filter.cpp`). beefweb does
answer a conditional request correctly — `If-None-Match` returns a `304` with no body — so the header
is the whole of the problem, and it is the player's to change. **Cache Storage is the way out because
it ignores caching headers entirely**: what is put in stays until it is taken out.

Measured against a real 30,441-track library, through the dev proxy:

| | |
|---|---|
| Covers on one visit to the genres index | 53–67 |
| Bytes | ~15 MB, all fresh `200`s |
| Conditional requests the browser sent | **none** |
| Cover size | 14 KB to 1.19 MB, averaging **~740 KB** |
| The same visit, warm | 3 requests, and 5.6 s to draw twenty covers becomes 1.0 s |

Those figures set the budget. At 50 MB the cache held **65 covers** — about one screenful of the
genres index — so it filled and then evicted the covers still on screen, which looks exactly like not
caching at all. 500 MB is large enough that ordinary use never thrashes and small enough that a
2,360-album library still turns over.

**Not a service worker.** A worker's scope is the directory it is served from, and Jean is documented
to install at `/jean` with the stock UI at `/`, so a worker there could never see `/api/artwork/...`
— and widening its scope needs a `Service-Worker-Allowed` header beefweb has no way to send. `caches`
is available to the page directly and has no scope at all.

- **50 MB, oldest out first, never LRU.** LRU pins whatever you look at most, so the covers you see
  daily would be the last to refresh. Insertion order guarantees everything rotates, which is what
  makes a re-tagged sleeve reappear without anybody pressing Clear.
- **Only `200`s are kept.** beefweb answers `404 no artwork found` for a track with none, and caching
  that is what would make a newly added sleeve fail to turn up.
- **Blob URLs are shared and reference-counted.** `createObjectURL` mints a *new* handle per call, and
  a track list draws one album across a dozen rows — minting per component held a dozen copies of the
  same picture in memory until the tab closed. `artwork.spec.ts` catches it.
- Secure-context only, so a plain-HTTP install has no cache and must go on working: every entry point
  answers "no" rather than throwing, and the Settings panel returns `null` rather than rendering
  disabled.

**One component draws every cover in the app** — the status bar, the wheel, the now-playing screen, an album group, a row, a shelf card, a queue entry — and the reason is the loading state rather than the picture. Six callers each holding a picture is fine; six of them each *flickering differently* while it arrives is what the user sees.

**One box, and the states happen inside it.** `Artwork` renders a wrapper that outlives everything: the caller's class lands there, so the size, the rounding and the shadow are settled before anything is known about the cover, and nothing reflows when it lands. Queued, downloading and *there is no cover here* all draw the same `DiscAlbum` on the same shape — the question being asked is only "is there a sleeve yet", and a settled failure differs from the other two by dropping the sheen, not by becoming a different component.

**The image is transparent until it has decoded.** A browser paints alt text into the box the moment an `<img>` has a src and no bytes, so a screen of album groups came up reading "Rastaman Vibration cover" a row at a time. `opacity` rather than `display`, so there is something to fade.

**`.loading` fights a placeholder in two ways.** It is written for text — it rounds its own corners, which inside an already-clipped box shows the ground through four of them, and it sets `color: transparent`, which takes the icon with it. Both are undone on `.placeholder`.

## Animation

**A layer that animates out has to outlive its own close.** `usePresence` holds it mounted for the length of the exit and no longer — unmounting on the close cuts the animation, and leaving it mounted leaves whatever it was running running. The number it is given has to match the stylesheet, because it is timing that exit.

**Compositor-only by default** — `transform`, `scale`, `rotate`, `opacity`. `border-radius` and layout properties repaint every frame: acceptable for a single small element, not for anything in a list. Continuous motion should layer animations with coprime durations rather than repeat one short loop, and **must never move an element's position on screen**.

That last rule is about the thing being *aimed at*. The "Now playing" pill's arrow nods, and the animation is on the icon rather than on the pill precisely because the pill is a button: a transform on a child leaves the parent's laid-out box where it was. It runs only while the pill is on screen — an animation ticking behind an invisible element for a whole session costs something and shows nothing.

**Slow is not the same as smooth, and speed is not the whole of it.** An arrow moving 2.1px over 2.3 s — about 1.8px a second — reads as stuttering, and raising it to ~3.8px a second is necessary and not sufficient: it still reads as *two frames* if the curve is wrong. **Any easing on a two-stop keyframe brings the element to a dead stop at 0%, 50% and 100%** — 18% of frames moved less than 0.02px, so the eye integrated the rest into two resting positions with a flick between them. It is now a sine sampled into six stops interpolated `linear`, which has a non-zero slope in every segment: 2% still frames, 2.4px over 850 ms. **`linear` there is load-bearing, not a default** — an easing would turn six stops into six little ease-in-outs and reintroduce the stop six times over.

Two things to rule out first next time. **Sub-pixel rasterisation**: pausing the animation at 34 phases and hashing the rendered icon gave 31 distinct images at 1x DPR, so the browser was drawing the in-between positions perfectly well. And **a per-frame figure judges the monitor, not the motion** — the same animation moves half as far per frame at 120 Hz. Per-frame numbers only compare two curves on one display; state the speed in px/s and the still-frame fraction, which are display-independent.
