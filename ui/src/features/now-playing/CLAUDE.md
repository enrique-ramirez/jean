# Now playing

The status bar, the screen it opens, and the panels on it: lyrics, the tags the file carries, and who the artist is. The shell and the breakpoints are in `src/app/CLAUDE.md`; the audible clock every surface here reads is in `src/domain/player/CLAUDE.md`.

## Two hosts, one set of panels

Desktop is a gatefold: a sticky leaf and a scrolling one, both on screen. A phone gets the player alone, with the panels in a layer over it.

**That split exists to free the horizontal axis. Do not give the same gesture two meanings on one screen.** On the player sideways is the next track; in the layer it is the next tab. Both hosts render the *same* panel component, so the tabs, the swipe and the offset each panel remembers cannot come to mean two things.

**On a phone the screen replaces the status bar**, the one place in the app where a route does, or there would be two Play buttons and the same cover on screen at once. That makes it the one layer inside the content row that goes `position: fixed` at a breakpoint rather than always, since "the whole viewport" is not true of anything positioned in a row that starts below the chrome. The desktop screen draws no transport at all, and it is *not rendered* rather than hidden, since the readout runs an animation-frame loop.

**Never look like a streaming client**, per the root `CLAUDE.md`: no colour pulled out of the artwork, flush left rather than centred, and no thumbnail in the slim status bar.

**The output picker is a roster and not a set of targets**, so its lower half is a plain list with no hover and no target padding. **A row that lights up under the cursor promises an action this list does not have.** A row is a control only where pressing it would do something. **No mute button anywhere in it**: a mute on foobar2000 *is* the fader at the bottom, so a button for it is a control that disappears at the one level somebody needs it at. The rows are `aria-pressed` toggles rather than a radio group, since both outputs really can be on and a radio group would announce "1 of 2" while it plays in two rooms. The playing mark is **held still rather than removed** while the player is paused.

## A layer, and why it has to be

**The screen is positioned over the content row, not rendered instead of the view.** It is a route *and* an overlay: `App` keeps resolving the route underneath and the shell keeps drawing it, which is the whole reason there is something to slide over. Mounted only while open plus the length of the exit, since the lyric panel runs a frame loop; the exit duration in JS has to match the stylesheet, as it is timing that exit. Closing returns to the route that opened it rather than calling `history.back()`, which on a direct load would leave Jean altogether.

**Escape is caught in the capture phase and stopped there**, or a bubbling handler would arrive second and clear the track selection in the list behind in the same keystroke. Capture beats everything above it too, so the screen has to hand Escape back whenever one of its own layers, its own menu, the queue panel or an overlay holding the keyboard is up. **Two of those terms are traps rather than tidiness**: the component is mounted whether or not the screen is showing, so the gate must lead with "is it open" or a closed screen eats every Escape in the app; and the capture helper ignores an event from a field, since leaving one and cancelling a rename are the same key and this listener runs first.

**`LyricsScreen` is a sibling of the now-playing screen, not a child.** As a child it sits inside that screen's touch handlers, so every flick in full screen would also skip a track underneath, and stopping propagation on three handlers holds until someone adds a fourth. **It is `position: fixed` at every width**: everything positioned in the content row starts below the top bar and beside the sidebar, so a layer there leaves the app chrome on screen and "only the lyrics are visible" is false.

**The panel's own lyric is unmounted while the full-screen one is up.** Two mounted at once is two frame loops recomputing the same active line, and the hidden one still drives *its* scroller, so the panel underneath would quietly scroll itself for the whole song.

## One scroller, and which one

**Whichever host is scrolling owns the mask, the sticky offsets and the absolutely positioned children.** In the gatefold the outer leaf scrolls and the panels size to their content; in the layer the panel *is* the scroller. Getting that backwards causes each of these:

- **A panel sized to the space left over inside a `flex: 1; min-height: 0` chain clips the rest**, the edge fade dresses the cut up as more content below, and no scrollbar can reach it.
- **An absolutely positioned child of a scroller is part of what scrolls**, so a resume pill inside the scrolling panel rides the lyric up and out of the view it exists to bring you back to. `position: static` on the panel body hands it to the layer, which does not move.
- **An overlay scrollbar draws at the right edge of *whatever* scrolls**, so a scroller inset by the layer's own gutter floats a bar a finger's width inside the screen, next to the browser's own.
- **A mask belongs to a scroller.** The phone's *player* scrolls nothing and gets no fade at all.

**Every scroller lookup inside this screen MUST be bounded by `data-now-playing`.** Unbounded, the walk goes past the layer and finds the *track list* scrolling behind it: a gesture on the header then reads that list's scroll position, decides it was not at the top, and silently refuses to dismiss. Find the scroller rather than being handed it, since the box that scrolls differs by layout. Note that `offsetParent` answers a different question, the nearest *positioned* ancestor.

## Gestures

**One meaning per surface.** On the player, horizontal is previous and next; in the panel layer, horizontal steps the tabs and **either vertical direction closes it**.

**Each vertical direction fires from the end of the scroll it would otherwise be.** Restricting it to the *regions* that do not scroll leaves the thing you are most likely to be reading as the one you cannot swipe away, which is what forces touch events over pointer events. See `shared/ui/CLAUDE.md`.

**`touch-action: pan-y` keeps the horizontal axis from becoming a browser gesture**: an edge swipe is back-navigation on Android Chrome and would beat a skip or a tab change to it.

**The skip gesture covers the whole player, not just the artwork.** Controls that follow the finger opt out with `data-owns-touch`, and it goes on the *popover* and not just the track: a finger that strays off a narrow column mid-drag is still the fader's.

**The sleeve must not take the touch.** A gesture whose target leaves the document stops being delivered at all: the finger goes on moving and the app sees a tap where the flick began. `Artwork` being one element for every state is half of it; `pointer-events: none` on the cover is the other half. **Nothing on this screen may be keyed on the track**, for the same reason: a key is a second way to detach an element mid-gesture.

### The cover wheel

Sleeves on the rim of a circle whose centre is far below the screen, so one rotation on one wrapper swings each slot along the rim *and* tilts it.

**The radius is set by what it has to hide, and the drag has to be geared because of it.** A neighbour must clear the viewport at rest, which puts one step further along the rim than a thumb travels. The gearing constant and the radius are a pair and neither can move alone: the step lives in the component since the state machine counts in it, the radius lives in the stylesheet since it is spatial.

**Three nodes serve every position, keyed by index modulo three.** Consecutive integers never collide, and a node changing which position it holds is off screen when it does, so a sleeve is never remounted mid-gesture. That is the touch-target trap again, not tidiness.

**The rim follows the ear; the identity beside it must never disagree.** A flick turns the rim at once, so for the length of the lag the sleeve would be the track arriving while the title is still the one leaving. A skip therefore holds the identity from the gesture until the sound catches up, **whether or not the sleeve is already known**. A prefilled neighbour makes the picture right early and the words no less wrong.

**Whether a turn was refused is a question about the player, never about the ear.** The player answers at once and the sound arrives a lag later, which on the plain stream path is longer than the wheel waits before putting an unanswered turn back. So the undo reads the *player's* track and the hold reads the audible one. Waiting on the ear for both rewinds a skip that had already landed.

**A turn is provisional until the player names a track**, so the slot it lands on may hold nothing yet. **Nothing there is the loading state, not the empty one**, never "Nothing playing", which is a different and untrue thing. And a skip is not guaranteed to move anything: at the end of a playlist the player takes the request, plays nothing and reports nothing, so an unanswered turn has to time out rather than sit on a sleeve that will never resolve.

**Which way to turn is told, never inferred.** The player reports that a track changed and never which direction it moved, and under any shuffle order there is nothing to work it out from, so a wheel left to guess turns forward on everything and Previous animates as Next. Skips from this screen carry their own direction; everything else is covered by a record taken in the beefweb client at the request, **the only place all of them meet**. The keyboard reaches the skip call directly and never touches the transport hook. The record is *taken* rather than read, and expires, so a skip the player never answers must not turn the next track that ends by itself into a step backwards.

**Prefill needs no branch.** A slot with a sleeve draws it and a slot without one draws as a hold, the same `Artwork` either way, handed `undefined` for *not named yet* against the `null` that means *there is no track there*. The artwork endpoint is addressed by *position*, so under Default order the neighbouring index is the real neighbouring sleeve for no request of Jean's own; under Shuffle it is unknowable and the hold does its job. **It never overwrites**: what a slot already holds is a track that really played.

**Reduced motion gets the cross-fade, not a shorter turn**, and the neighbours are not drawn at all. The gesture is untouched: what goes is the movement, never the control.

## The one request

**The lyric tag and the detail fields MUST never reach the update stream.** It re-evaluates its `trcolumns` on every push, on track change, on pause and on each write of a volume drag, and the lyric tag alone is large. They are fetched once per track instead, and the stream keeps carrying its four expressions.

It is **keyed on the file**, not on the playlist position, which moves whenever anything above it is edited. And the answer is **verified rather than trusted**: the player reports whatever is playing when the request is *served*, so a track that ended in flight would otherwise cache the next track's lyrics under this one's key.

**The lyric alone is looked at again while the track plays.** `foo_openlyrics` searches when a track starts and writes the tag when it lands, and beefweb announces nothing when a tag changes, so a lyric that arrives a few seconds late would otherwise wait for the next play. Three rules hold the cost down: the looks are a fixed short series and stop at the first hit, they run only while the panels are mounted, and they ask for the lyric column alone. Re-reading the whole set instead would overwrite an optimistic rating with the value on disk.

**Every value goes through `readValue()`.** Read raw, a field the player cannot resolve is the literal string `?`, which is perfectly truthy, so the panel draws a one-line lyric consisting of a question mark on every track without the tag.

## Lyrics

**Reading the tag needs no component**; `foo_openlyrics` is what *writes* it. Most of a real library carries no lyric at all and only a minority of what is tagged carries timestamps, so **the empty state is the common case and has to read as a state rather than as an explanation.** Name the tag and the component that writes it in Settings, not here.

**`lyricsFormat.ts` is named for the format rather than the feature, since `Lyrics.tsx` sits beside it.** On a case-insensitive filesystem TypeScript resolves `'./Lyrics'` by probing `Lyrics.ts` first.

What the parser has to survive, all seen in real files:

- **`\r\n` throughout**, and a lone `\r` from older taggers.
- **One line can carry several timestamps.** A repeated refrain is written once with two stamps on it; reading only the first drops half the second chorus.
- **`[offset:…]` is milliseconds to *subtract***, the opposite sign to the one everybody assumes. Clamp at zero, or a line sorts before the track starts and can never become current.
- **A fraction is not always hundredths.** `[00:12.5]` is five tenths and `[00:12.500]` is five hundred milliseconds, so pad rather than dividing by a guessed number of decimal places.
- **Rips from streaming services open with credit lines in other scripts**, and some "lyrics" are a bare URL. Neither is cleaned up: tag hygiene is the library owner's business.

**Counting timestamps is not enough to call a lyric synced.** A large minority of tagged tracks are rips of instrumentals whose entire lyric is two credit lines and a note saying so: several timestamps, all inside the first few seconds of a long track. Counted, that is a synced lyric; drawn, it is a karaoke view that fires a few times and then sits dead. Worse, the same boilerplate appears with different line counts elsewhere, so a count threshold classifies identical content two ways. **`SYNCED_MIN_SPAN` asks whether the *timing* is followable** instead.

**The active line is state; the position is not.** The frame loop recomputes an *index* and sets it only when it changes. Re-rendering hundreds of lines on every frame to move one highlight would be the most expensive thing in the app.

**The first placement is a jump, not a scroll**, so the active line is seeded from the current position during render rather than starting before the first line. Otherwise the panel paints at the top and smooth-scrolls through a verse nobody is reading. Placement is a `useLayoutEffect`: after paint, being instant only buys a frame showing the wrong place. That is also why the parse happens in the screen rather than in the panel, since decisions outside the panel turn on whether the lyric is synced.

**Following is given up on a manual scroll and handed back by a pill, never by a timeout**, which would take it back while somebody is still reading. **A programmatic scroll fires the same `scroll` event a finger does**, so the guard is a flag the handler checks, time-boxed since `scrollend` is not everywhere yet.

**The current line sits a third of the way down, not centred**: the line being sung is the one you have already heard, and the useful half of the view is what is coming. Lines still to come need a **per-theme** colour: legible, while losing clearly to the current line. The dark theme's muted token does both; on light it is a near-black the current line cannot beat.

**There is no spacer after the last line.** A tall block below the lyric is by definition mostly nothing, and on a short lyric it is the *only* thing you can scroll to.

## Coming back to a panel

Switching tabs unmounts the panel, so anything worth keeping has to be kept deliberately. `usePanelScroll` remembers an offset per **panel and track**: a new song's lyrics are not the old song's, scrolled down. It re-resolves the element rather than holding one, since the scroller is a different element on each layout and, on a phone, is rebuilt on every tab change. It is deliberately *not* the app's scroll memory, which owns the single permanent scroll container and remembers a route.

**And it is switched off for a synced lyric.** Restoring an offset writes `scrollTop`, which the follow reads as *the reader has taken over*, so the lyric sits still for the rest of the song with the resume pill showing. It is also the wrong thing to restore: the song has moved on, and the follow already knows where to be.

## Details

**Detected per track, never per library.** A tag field answers `?` for the file that lacks it, so which rows exist is a question about *this file*. Coverage of the optional fields varies enormously within one library, and a fixed grid of labels would be mostly empty cells on most tracks, which reads as Jean failing rather than as tags nobody wrote.

**`%comment%` is deliberately excluded**: most of what it holds on a real library is ReplayGain hex written there by an old tagger. So are the identifier fields and the MusicBrainz ids, and not one of them resolves on anything.

**`%year%` is what is shown; `%date%` earns a row only when it says more.** It is a messy user tag, so parse it leniently or not at all. Rendering a date with a zero month invents a month nobody tagged.

## Artist

**The only thing in Jean that leaves the network, and it is off until asked.** Off, the tab says what it would do and where the switch is.

MusicBrainz's `ws/2` and Wikipedia's REST summary both answer `Access-Control-Allow-Origin: *` with no key and no proxy. **Deezer does not**, which is why there are no artist images here despite it being the obvious source.

- **MusicBrainz links Wikidata, not Wikipedia.** The direct link is tried first, as older entries carry it and it saves a hop, but the Wikidata path is the one that runs.
- **The Wikidata REST path is `v1`.** The `v0` most examples show is a 404.
- **A browser cannot send the `User-Agent` MusicBrainz asks for.** It is a forbidden header name and `fetch` drops it silently. It works anyway: a real browser UA answers 200 and only the bare `Mozilla/5.0` token is refused, which is a bot filter rather than a policy. An ignored header in the code would only look like it had done something.
- **A low-confidence match is discarded.** A confident biography of the wrong band is worse than none.

## Rating

**The playing track has no row anywhere**, so this cannot go through the list's rate call, because there is nothing to patch optimistically. The per-track query is that row's stand-in and is patched directly, which keeps the fact in one store rather than adding a second overlay beside `ratingStore`, which is keyed on the row arrays the playlist store publishes and cannot see this one.

**`useNowPlayingRating` is the one home for that.** The stars, the menu and the `0`–`5` keys are three ways to the same act, and the patch, the write and the question of which scales may be written have to be one answer for all three.

**One gate, and part of it is whether the rating has arrived yet.** The one read per track is what says which scale this file is on and what the optimistic patch would be applied over, so a control offered before it lands draws five empty stars for a track that may be rated and writes a value with nowhere to put it.

**A refused write puts the value back**, and the undo travels with the write rather than being reconstructed after it. **A 504 is the exception**: the player may still be finishing the write, so the value stands and the message says it may not have been saved. The read-only rule is asked per track; see `src/domain/track/CLAUDE.md`.

**A track with no local file draws no rating control at all: absent, not inert.** `isLocalFile` gates ahead of `canWrite`, and the two must stay separate: `!canWrite` is a local file whose rating cannot be written for some other reason, and still gets the read-only stars every other refusal gets; a stream has no file for a rating to belong to. Reaching for that same fallback here is the natural-looking fix and the wrong one. `%rating%` cannot stand in for the path check either: a stream and an unrated local file answer it with the same `?`, so the path is what tells them apart. `src/domain/track/CLAUDE.md` has what `foo_jean` requires of it.

## Sizing

**The artwork always fits.** The player is the one region that should never scroll, so the stage is height-capped and a window narrower than it is tall gives a short wide box rather than an overflowing square one. And **`Artwork` is called with no `size`** there: given one it writes `width`/`height` inline, which beats the class working the box out and stretches a square cover into that oblong.

**A custom property declared on an element beats an inherited one**, which is why the star size is read through an indirection: a component setting its own default would otherwise silently win over anything a container sets. Same rule for the full-screen lyric's font size, read with a fallback rather than declared.

**`PlayToggle` is the same component at two sizes, not two buttons that look alike.** The continuous motion is the whole personality of the control, and a second copy of its keyframes is the one that would drift. **The size is a variant, not a number**, since the button also shrinks at a breakpoint and anything spatial belongs to the media query. **CSS `width`/`height` on the `svg` beats the attributes lucide writes**, which is what lets the glyph track the button without a second number in JS.

**When a styled element moves modules, delete the rule it left behind.** A rule pointing at a class that no longer exists still parses, still looks deliberate, and does nothing at all.
