# Shared UI

Menus, gestures, drag and drop, fields, artwork, toasts and animation: the pieces every feature draws with. Knows nothing about Jean.

Styling rules, the token layer and the app-level `z-index` scale are in [CONTRIBUTING.md](../../../CONTRIBUTING.md) and [ARCHITECTURE.md](../../../ARCHITECTURE.md). What follows is browser behaviour and the rules it forces.

## Menus

**`ActionMenu.tsx` is the only menu surface in the app**, and actions are declared as **data**: the surface decides how to draw them, a popover on a desktop viewport and an action sheet on a compact one. Adding a menu means writing an array, not another component. **Never hand-roll a popover, an action sheet or a confirmation dialog.** `Menu.tsx` is a different thing and stays: a dropdown anchored under a button you can see, with no gestures and no pages.

It is an **action sheet**, not a bottom sheet: detached from every edge, all four corners rounded, floating above the safe-area inset. Nested pages slide in place at every width, and destructive actions confirm on one.

- **A sheet with a field in it has to follow the visual viewport.** A `position: fixed` element is laid out against the *layout* viewport, which neither platform shrinks for the keyboard, since iOS does not resize it and Chrome defaults to `interactive-widget=resizes-visual`, so a bottom-anchored sheet puts its own field under the keyboard the moment you tap it. `useVisualViewport.ts` sizes the scrim to `visualViewport` and follows `offsetTop` too, since iOS scrolls the page to reveal a focused field. It writes to the element rather than to state: iOS fires a stream of these while the keyboard animates.
- **`touch-action: none` intersects down the tree.** On a sheet's scrim it leaves a long list unscrollable on touch, and it is not needed there, because the scrim portals to `<body>`, which has nothing to scroll.
- **While a menu is open, no key belongs to the app behind it.** Without stopping propagation the arrow keys seek the player while you are choosing an action. Tab is the exception: leaving by keyboard is the browser's business. `menuKeys.ts` is that implementation, shared by both surfaces.
- **A panel that cannot take focus cannot take the keyboard, and an invisible element cannot take focus.** The popover renders transparent rather than `visibility: hidden` for the frame it is measured in, precisely so that focusing it then is not silently a no-op.
- **An exit animation's "closing" flag MUST be derived during render, not set in an effect.** An effect leaves one commit in which the menu is neither open nor leaving: it unmounts, the effect brings it straight back to play the exit, and that remount re-runs the surface's focus effect, so anything the chosen action just focused loses it. `usePresence` is the same rule.
- **A menu returns focus only if it still has it.** An action is allowed to send focus somewhere on purpose; restoring blindly on close undoes that.
- **`useContextMenu` unifies the three ways of asking for one**: right-click, press-and-hold, and the Menu key, which reports no coordinates, so a keyboard invocation has to anchor to the element rather than to `0,0`.

## Pointer versus touch

**A tap plays; a click selects and a double-click plays. The split is the pointer, not the viewport.** Bound to `click` rather than `pointerup`: the browser withholds it when the gesture turns out to be a scroll, which is most of what a finger does in a list. Both handlers sit on the rows container and find their row from the event target. A long list must not carry a closure per row.

**`useLongPress` owns the echoes of the gesture, not just the gesture.** The synthetic click and, on Android, a native `contextmenu` both arrive after a hold has been answered, and both have to be swallowed. **Suppression is time-boxed rather than cleared by whichever event turns up**, since which one turns up differs by platform: iOS sends the click and no contextmenu, Android the reverse, and waiting for a specific one leaves the guard permanently on. Anything long-pressable also needs `-webkit-touch-callout: none`, which the hook returns as a style to spread.

**A list that appears under a stationary pointer gets a `mouseenter` it did not earn.** The mouse has not moved; the element beneath it changed. Hover would then hand the active row to whatever landed there and Enter would act on that instead of the first. **Hover has to prove the pointer moved**: a flag re-armed per result set covers the ordinary case, and comparing the event's coordinates against the last seen ones covers the first move onto a result, where `mouseenter` arrives before the `mousemove` that would have set the flag. `useEarnedHover` is that guard and the one place it is written; every list whose rows can appear under a resting pointer MUST gate its `onMouseEnter` on it.

**A touch target is not a pointer target.** A miss on a thin fader track does nothing at all, which reads as broken without ever being wrong. Hit areas widen on `(pointer: coarse)` while the visible rail does not, and the thumb is drawn permanently there, because on touch there is no hover to reveal it.

## Dragging

Two primitives, deliberately separate. `useSortableList.ts` reorders a single list short enough to see at once, where the dragged element stays mounted and the drop position is arithmetic. `dnd.ts` drags across containers, where the source row can be unmounted by the virtualiser mid-gesture and the target is elsewhere in the tree, so the drop is decided by hit-testing the document up to a `[data-drop-target]`, and what follows the pointer is a ghost rather than the row. They share their geometry, **including the autoscroll ramp**, through `shared/lib/dragGeometry.ts`; two ramps is two feels.

**Only a mouse drags**, in both. On touch the vertical axis is already the scroller's and hold-then-drag is spent on the menu, so a coarse pointer gets an explicit handle or nothing; on a pointer the row itself drags with no affordance. State the same fact once in CSS and once in JS.

- **`setPointerCapture` moves the click, not just the pointer events.** It retargets the compatibility `mousedown` and `mouseup`, and `click` is dispatched at the common ancestor of those two, so capturing on a row makes every click land on the row instead of on the button inside it, and navigation silently stops working with no error anywhere. **Capture only once the gesture is definitely a drag.** A small handle is the exception and must claim the pointer up front, since it can be left behind inside the threshold distance.
- **No pointer capture at all across containers.** Capture retargets every later event to the capturing element, so a handler on a *descendant* never fires again, and the natural capture element is the scroll container, an ancestor of the rows. Window listeners for the length of the gesture have none of that ambiguity.
- **The drop is held, not cleared.** The reorder goes through the query cache, which is a microtask away at best, so clearing the transforms on `pointerup` flicks the row back for a frame. Hold the landing transform until the caller's keys change, with a timeout in case the player refuses the move.
- **A drag that starts on a link ends with a click on that link**, so the gesture swallows its own click. Clear the flag on the next pointer-down rather than on a timer, so a gesture that produced no click leaves nothing armed.
- **Two behaviours on one element share their handler names.** A row that both press-and-holds and drags wants `onPointerDown/Move/Up/Cancel` twice over, and spreading one props object after the other drops the first silently. Compose through `shared/lib/mergeHandlers.ts`.
- **The cross-container store carries only coarse facts**, meaning dragging or not and which target is armed, so subscribing is free. **The track list does not subscribe at all and MUST never re-render during a drag.**
- **The ghost is moved imperatively**, since position is the one thing that changes every frame, and it is two elements: a CSS animation beats an inline style, so an entrance touching `transform` would override the position and the ghost would fly in from the top-left. Outer element owns position, inner owns anything that animates.
- **Pressing inside a multi-track selection must not collapse it on pointer-down.** That decision waits for the release, or the selection is gone before the pointer has moved a pixel and a multi-track drag cannot exist.
- **Hit-testing runs on a frame rather than on the move event**, so a target that autoscrolls under a stationary pointer still arms.
- **A target may arm *and* refuse.** `data-drop-refuses` carries a sentence the store republishes, the ghost draws it instead of the payload, and the drop silently does not happen. Filtering the target out instead leaves the pointer over a row that reacts to nothing, and the reason arrives *after* the decision rather than before it. The sentence is read off the DOM, so `dnd.ts` still knows nothing about what a refusal means.
- **The target ids are opaque here and MUST stay that way.** A target is a string this file hit-tests and hands back; what it means belongs to whoever registered it.

## Controls

**Tabs are not a segmented control, and Jean has both.** `Segmented` switches how one thing is drawn -- compact rows or album groups, the same list either way. `Tabs` moves between different things, and looks it: underlined, not a pill. Reaching for the wrong one is how a design language stops being one.

**A switch is not a checkbox, and Jean has both.** The line is *when it takes effect*: a switch acts the moment it moves, a checkbox is a selection something else submits. `Switch.tsx` carries `role="switch"` rather than a styled checkbox, and **the label is inside the control** so the whole row is the target. `prefers-reduced-motion` drops the transition and keeps the movement: the travel is the affordance.

**`HelpHint.tsx` holds a caveat worth having and not worth reading.** The label carries the setting; the hint carries the exception. Reach for it only when the text says something the label does not. It returns a **fragment**, and the head row it sits in must `flex-wrap`. It is deliberately not a popover: an absolutely positioned panel inside a scrolling column is clipped by that scroller.

**Notifications come from `toastStore.ts`, and only for things you cannot see.** Confirm only what is not already visible. Creating a playlist needs no notification, since the row appears, named, waiting to be renamed. It is a module-level store rather than a context: a provider holding the list would re-render the virtualised track list every time a toast appeared or expired.

**An ask is the shape for the other half of that**: `shared/lib/ask.ts`, a one-shot request raised where the thing that can grant it is not. An ask stands until answered, since what answers it has to arrive or load first.

**A control you drag must be unselectable.** Press on a slider without `user-select: none` and the browser starts a text selection; dragging a selection is a native drag, so it paints a translucent snapshot of the control and follows the pointer with that instead of moving the thumb. `useDragFraction` returns the style with its handlers so the two cannot be separated, and it carries `touch-action: none` as well, because without it the browser keeps the gesture for panning and cancels the pointer stream mid-drag.

**Writes driven by a drag MUST be coalesced, not fired per event.** One gesture is dozens of moves; a request each floods the player, and responses can land out of order so the last value to *arrive* wins rather than the last one sent. `useCoalescedWrite` keeps one request in flight and sends the newest value after it. Drag state stays local to the control. Writing it into shared player state on every move re-renders every subscriber for the whole gesture.

## Swipes and scrolling

**A flick is not a drag, and `useSwipe.ts` answers one question at the end**: which way, if any. Touch only, for the same reason only a mouse drags a row.

**`onDrag` is how a caller takes the horizontal axis back**, and it changes three things at once, which is why it is one option rather than three. The axis is decided **during** the gesture rather than at the end: once, at a small threshold, and held, or a drifting thumb hands a wheel back and forth. The directional callbacks stop firing for a gesture it tracked. And the flick clock stops applying: a drag that followed the finger for seconds was deliberate for all of it, where an untracked one that slow is a scroll that ended somewhere.

**The tracked surface must be told the gesture ended even when the browser took it away**, so `onDragEnd` fires from `touchcancel` too. Without that it sits wherever the finger left it, forever. **A tracked surface writes its own transform and does not re-render per move**; holding the fraction in state is right for a small control and wrong for anything that would repaint a screen to move one `rotate()`.

**It reads touch events, not pointer events, and that is the design.** The browser cancels the pointer stream the moment it claims a gesture for scrolling. A downward flick inside a scrollable panel arrives as `pointercancel` and never a `pointerup`, so a pointer-based swipe can only see gestures on regions that do not scroll. Touch events keep firing through a scroll, which is what lets one handler cover a whole surface that also scrolls.

**A gesture that competes with scrolling is settled by scroll *position*, not by region.** Down fires only when the thing under the finger had nowhere left to scroll up to, and up only when it had nowhere left to scroll down to. Carving out the parts of a surface that happen not to scroll leaves whatever the user is reading as the one place the gesture does not work. **A surface with nothing to scroll is at both ends at once**, which is what lets one panel answer to both directions.

**A gesture whose target leaves the document stops being delivered.** React listens at the root, and touch events after `touchstart` go to the node the finger landed on, so when that node is replaced mid-gesture the moves never reach the handler and the flick arrives as a tap where it began. That is why `Artwork` is one element for every state; where a surface does swap something out under the finger, `pointer-events: none` hands the touch to a box that stays put. **Do not key such an element on the thing that changes**, either: a key is a second way to detach it.

**A control that follows the finger is not part of the surface it sits on.** `useDragFraction` marks everything it makes with `data-owns-touch` and `useSwipe` records nothing when a touch begins under that mark. Scroll position cannot settle this one: the drag is on a control that never scrolls, so the flick reads as deliberate every time.

**`shared/lib/scrollParent.ts` takes a boundary, and a layered surface MUST pass one.** The walk otherwise goes straight past an overlay and returns the scroller *underneath* it, which is off screen, belongs to something else, and reports a scroll position that quietly changes the answer.

**An animated scroll must not treat every wheel event as a decision.** Trackpad and mouse momentum keep emitting for a second or more after the fingers have left, so a jump asked for at the end of a flick gets cancelled by the tail of the gesture that preceded it. One delta of a single pixel is enough to strand the scroll and leave the target row unmounted. `animateScroll.ts` accumulates wheel delta and gives up only past a threshold deliberate scrolling passes in one or two events and a decaying tail never reaches. A touch still cancels on contact.

## Fields

**`Input.tsx` is the only text field in Jean**, and not a wrapper anybody may skip. The box, the focus ring, the placeholder and the sizes live there; what differs between callers is only what sits either side of the text, and those are slots.

**An `<input>` asserts a default width on everything above it, and `min-width: 0` does not take that back.** It lowers the floor the input may shrink to, which is why the field itself looks fine, while leaving the min-content size its ancestors are measured by untouched, so a top bar could not be sized below the input's own default, the document could not either, and every narrower phone scrolled sideways. `width: 0` on the input is what withdraws the claim; the flex line hands the space straight back.

The focus ring is **on the field, never on the input**: the input is chromeless by construction, so the global `:focus-visible` rule draws a second rounded rectangle inside the first and reads as a field nested in a field.

## Artwork

**Three gates, answering different questions.** `nearViewport.ts` decides *whether to ask at all*: a grid can mount far more covers than it shows; it answers once and never takes the answer back, since a cover scrolled past keeps the picture it has. `artworkCache.ts` decides *whether the network is involved*. `artworkQueue.ts` decides *how many ask at once*. None of them is `loading="lazy"`, whose answer to "is this visible" is yes for every row a jump scrolls past.

**A cover is identified by the picture it is, never by the address it came from.** beefweb addresses artwork by *position in a playlist*, and Jean rewrites its own scratch playlist on every search and every artist played, so the address alone is not a safe cache key. `Artwork` takes an `identity` prop for this and carries what `null` means there; `coverIdentity()` in `domain/track/fields.ts` is the one place that says what a cover is.

**The playing surfaces identify a cover by track, not by album.** The update stream's `trcolumns` is `%artist%`, `%title%`, `%path%` and `%subsong%`, never `%album%`, so `StatusBar`, `NowPlaying` and the cover wheel all build their identity through `coverKey(artist, title, "track")`.

**beefweb defeats the browser's own cache and there is nothing a client can do about it.** Every response carries a short `max-age` with `must-revalidate` from one filter that does not distinguish a sleeve from a status poll. beefweb does answer a conditional request correctly, so the header is the whole of the problem and it is the player's to change. **Cache Storage is the way out because it ignores caching headers entirely**: what is put in stays until it is taken out, and none of it revalidates -- a cover kept under a key that only named an address would never correct itself.

**Not a service worker.** A worker's scope is the directory it is served from, and Jean is documented to install under a subpath with the stock UI at the root, so a worker there could never see the artwork routes, and widening its scope needs a `Service-Worker-Allowed` header beefweb has no way to send. `caches` is available to the page directly and has no scope at all.

- **A fixed byte budget, oldest out first, never LRU.** LRU pins whatever you look at most, so the covers you see daily would be the last to refresh. Insertion order guarantees everything rotates, which is what makes a re-tagged sleeve reappear without anybody pressing Clear. The budget has to be large enough that a screenful of covers cannot evict itself, which looks exactly like not caching at all.
- **Only `200`s are kept.** beefweb answers 404 for a track with no artwork, and caching that is what would make a newly added sleeve fail to turn up.
- **Blob URLs are shared and reference-counted.** `createObjectURL` mints a *new* handle per call, and a track list draws one album across many rows, so minting per component holds a copy of the same picture per row until the tab closes. `artwork.spec.ts` catches it.
- **Secure-context only**, so a plain-HTTP install has no cache and must go on working: every entry point answers "no" rather than throwing.

**The queue's load-bearing part is the settle gate, not the capacity.** A row has to still be mounted a moment after it appeared before it is even queued: against a player that answers instantly a bare queue drains as quickly as the rows churn and lets every request through, *more* than the native behaviour. Only a few run at a time, so the API always has connections left over, and both outcomes are remembered. On a mostly-uncovered library the 404s are most of the traffic on any scroll back over ground already covered.

**One component draws every cover in the app.** `Artwork` renders a wrapper that outlives everything, so the size, the rounding and the shadow are settled before anything is known about the cover and nothing reflows when it lands. Queued, downloading and *there is no cover here* draw the same glyph on the same shape.

**The image is transparent until it has decoded.** A browser paints alt text into the box the moment an `<img>` has a src and no bytes, so a screen of album groups comes up reading cover filenames a row at a time. Use `opacity` rather than `display`, so there is something to fade.

**A skeleton class written for text fights a placeholder in two ways.** It rounds its own corners, which inside an already-clipped box shows the ground through four of them, and it sets `color: transparent`, which takes the icon with it. Both have to be undone.

## Animation

**A layer that animates out has to outlive its own close.** `usePresence` keeps it mounted for the length of the exit and no longer. Unmounting on the close cuts the animation, and leaving it mounted leaves whatever it was running running. The number it is given has to match the stylesheet, since it is timing that exit.

**Compositor-only by default.** `border-radius` and layout properties repaint every frame: acceptable for a single small element, not for anything in a list.

**Continuous motion must never move an element's position on screen**, since the thing being aimed at is usually a button. Animate a child instead: a transform on a child leaves the parent's laid-out box where it was. And run it only while it is on screen. An animation ticking behind an invisible element for a whole session costs something and shows nothing.

**Any easing on a two-stop keyframe brings the element to a dead stop at 0%, 50% and 100%**, so a slow drift reads as two resting positions with a flick between them rather than as motion. The fix is more stops: a curve sampled into several, interpolated `linear`, which has a non-zero slope in every segment. **`linear` there is load-bearing, not a default**: an easing would turn six stops into six little ease-in-outs and reintroduce the stop six times over. Layer several animations with coprime durations rather than repeating one short loop.

Two things to rule out before blaming the renderer. **Sub-pixel rasterisation is not it**: pause an animation at many phases and hash the rendered element, and the browser is drawing the in-between positions perfectly well. And **a per-frame figure judges the monitor, not the motion.** The same animation moves half as far per frame at twice the refresh rate. Compare curves in px/s and in the fraction of still frames, which are display-independent.
