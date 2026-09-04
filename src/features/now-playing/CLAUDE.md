# Now playing

The status bar, and the screen it opens. The shell and the breakpoints are in `src/app/CLAUDE.md`.

## Two components, one idea

The status bar is **one component with two shapes**. So is the screen, and the two shapes are not the same layout rotated — they are one surface on a desktop and two on a phone:

- **Desktop is a gatefold.** The cover and the identity are a *sticky* left leaf; `TrackPanels` is the right one and scrolls. What you look at holds still while what you read changes.
- **A phone gets the player, and a layer over it.** The screen is artwork, identity and transport, and nothing else; Lyrics, Details and Artist are `TrackPanels` again inside `TrackInfo`, which the Lyrics button opens over the top. **That split exists to free the horizontal axis**: on one surface sideways means the next track, on the other it means the next tab, and neither has to be aimed at a region. Both are the same component in two hosts — the tabs, the swipe between them and the offset each panel remembers cannot come to mean two things.

**Why the panels left the player.** With tabs on the screen, a horizontal flick had to mean *change tab* everywhere, and the artwork is the one thing on a phone that everybody swipes to skip. Nielsen Norman's rule is the one that decided it — do not give the same gesture two meanings on one screen — and the reference pass agreed: Apple Music swipes the artwork to skip and puts lyrics behind a button, and YouTube Music's 2026 redesign *removed* the tab strip under its player and moved lyrics into a row of buttons. Rejected: tabs at the bottom, which keeps both meanings on one screen and puts the artwork out of a thumb's reach; and three separate buttons with no tabs at all, which costs a return trip through the player to get from Lyrics to Artist and weights Details and Artist — the two least-used panels — with permanent chrome on the most-looked-at screen.

**The desktop screen draws no transport at all.** The status bar is on every screen and already carries a full one; a second set inside the view is what makes a desktop screen read as a stretched phone app. It is *not rendered* rather than hidden, because `Times` runs an animation-frame loop.

## The status bar

**What the compact bar has is Play and volume, in that order.** Volume sits *left* of Play so Play stays the rightmost thing and therefore closest to a right thumb; volume earns the slot because it is the *player's* volume and the handset's hardware keys cannot reach it. Shuffle, skipping and the queue moved to the screen, where they are full-sized.

**No thumbnail in the slim strip.** Every mini-player worth looking at is artwork plus two lines, and copying that here gets the Spotify bar exactly. The cover is one swipe away at full size. **The block toggles rather than opens**, and carries no hover fill: a panel that size lighting up behind the artwork is a lot of movement for something you are not choosing between.

**A swipe up anywhere on the strip opens the screen.** It is on `.row` rather than on the footer so it starts *below* the seek bar — that is a 4px strip owning the vertical axis for scrubbing, and a drag beginning there is a scrub. It calls `onRevealNowPlaying`, not the toggle the tap uses: **up is a direction, not a switch**, and there is nothing for it to mean when the screen is already up. The 60px threshold is also what keeps it off the transport — a finger travelling that far has left whichever 38px button it started on, so the browser withholds the click.

**"Playing from", not "from".** The bare preposition reads as a fragment of a sentence that never arrives, especially next to a name like "All music". `usePlayingFrom` is unchanged and the sidebar still uses it.

**On the screen's header that line is a button, and the whole line is the target** — on a phone the label is half of what there is to aim at. It is drawn as a button only when `App` hands it a route, which is the same resolution the sidebar's temporary row uses, so a set with nowhere to open stays a sentence rather than a control that does nothing. Opening the route *is* the dismissal. **The name takes `--accent-text` and the label does not**: the alternative state is `--muted` body copy with no shape of its own, which is the token's own test, and a line where nothing changes colour does not read as a link at all. Underline on hover, as the artist source link does; the sentence version keeps `--muted`, because a set with nowhere to go must not look pressable.

**Where the sound comes out sits between the readout and the fader** on desktop, and left of the fader on a phone: *where* has to be answered before *how loud there* means anything. It is read far more often than pressed — the collapsed icon says where the sound is without being opened, and a count rides on it when somebody else is listening. **The fader beside it retargets rather than doubling.** While the sound is on this device the player's volume sits *before* the capture, so pointing the control at it leaves a slider that moves and changes nothing audible. One control, one target at a time, and its label says which. On iOS there is no target at all, so it is not drawn and the picker says the hardware keys own it. Reasoning and probe in `src/domain/player/CLAUDE.md`.

**The picker is two outputs and then a roster, and the two halves are drawn as different kinds of thing.** The reference is AirPlay 2 in Apple Music — checkmarked rows that go multi-select, each growing its own fader once more than one is on. Rejected: Spotify Connect's flat list of devices you push audio to, because Jean cannot push to any of them; and the macOS Sound menu's pure single-select, which has nowhere to put the others. So the top is toggles you press and the bottom is a plain list with no hover and no target padding — **a row that lights up under the cursor promises an action this list does not have.**

**Toggles rather than a radio group, because both outputs really can be on.** Pressing one still hands the sound over; that is what the buttons do. But `role="radio"` would announce "1 of 2" while it plays in two rooms, so the state underneath is two `aria-pressed` booleans. **The tick means the sound comes out there** and stays literally true on a device listening to nothing, which is what lets the same row read "Muted while Android phone is listening" on a laptop that is not.

**Unmute is named for its target.** The status bar's own mute button answers to "Unmute" too whenever the player is silent — and pressing *that* one is the same act by accident — so the picker's carries `aria-label="Unmute <player>"`. Two controls one word apart in the same footer is a mis-tap and an ambiguous accessible name by construction.

**The player's fader lives in the player's row and only while this device is listening.** Elsewhere the status bar's own still points at the player, and a second one beside it would be the same control twice. **The status bar fader never mode-switches for this**: it stays on this device, and the row's fader is what the extra output brought with it.

**Each tab answers to its own initial** — `L`, `D`, `A`, declared in `keymap.ts` under `SCOPE.nowPlaying` and registered by `TrackPanels`, so they are live wherever the strip is and dead when it is not. **The strip underlines the letter**, which makes the label and the binding one fact: rename a tab and the letter has to move with it. The hint is hidden on a coarse pointer, the same question the shortcuts button asks.

**The picker is on the compact screen's transport, left of the fader as it is in the bar, and nowhere else.** On a phone `#/playing` replaces the status bar, so without a copy there the one control that says where the sound is going is unreachable for as long as the screen is up. The desktop screen draws no transport at all — the bar under it carries the picker and the fader both, and a second copy would be the same control twice.

## The identity block

**On the player it is the caption to a picture and keeps all four lines** — title, artist, album · year, stars. There is nothing competing with it there any more, which is what the split bought back.

**The layer's header is the slim version, and it is a header rather than an identity**: title and artist, one line each, truncated, next to the chevron that closes it. The album goes because Details lists it two tabs away, and the stars go because rating is a deliberate act with the screen underneath and the ⋯ menu both offering it. No thumbnail: artwork plus two lines is the Spotify bar exactly, and the picture is one dismissal away at full size. The gatefold is untouched — its identity is a sticky column with a leaf to itself.

**The stars share their row with the Lyrics button**: rate it at the left, read about it at the right. It costs no height — the row was already there — and the right end of it is where a right thumb already is, which is the whole reason that end was chosen over a button under the artwork.

**The button says Lyrics and always opens on Lyrics**, tag or no tag. A control that renames itself per track has to be read every time, and the empty state is where finding a lyric will go. Falling through to Details when there is no tag is the *gatefold's* rule, where the strip is the only way in and an empty panel would be the whole first impression.

## Not looking like a streaming client

**No colour pulled out of the artwork** — it is in every reference, which makes it the median, and it fights `#ffb454`. The cover is the colour on the screen. **Flush left, not centred**: six of eight references centre the title under a centred square, which is what makes them interchangeable, and a sleeve back is set ragged-right. **A route, not a sheet**, because it has tabs, scroll and a dismiss — but `closeNowPlaying` remembers the route that opened it rather than calling `history.back()`, which on a direct load of `#/playing` would leave Jean altogether.

## A layer, and why it has to be

**The screen is positioned over `.body`, not rendered instead of the view.** It is a route *and* an overlay: `App` keeps resolving the route underneath and the shell keeps drawing it, which is the whole reason there is something to slide over.

**Escape closes it, and stands down for whatever is in front.** It is caught in the capture phase and stopped there, like every other layer here — a bubbling handler would arrive second and clear the track selection in the list behind in the same keystroke. Capture beats everything above it too, though, so the screen hands Escape back whenever one of its own layers, its own menu or an overlay holding the keyboard is up. **Two of those terms are traps rather than tidiness**: the component is mounted whether or not the screen is showing, so the gate leads with `isOpen` or a closed screen eats every Escape in the app; and `useEscapeCapture` ignores an event from a field, because leaving one and cancelling a rename are the same key and this listener runs before both.

**Mounted only while open, plus the length of the exit.** `SLIDE_MS` has to match the stylesheet, because it is timing that exit. Not merely hidden: the lyric panel runs an animation-frame loop. **`z-index: 25` is measured against what it has to beat** — the list's toolbar is `10`/`12` and the finder is `20`, all inside `main`, and the queue panel above it is `30`. **Reduced motion keeps a fade rather than nothing**: the movement *is* the statement about where dismissing sends it.

## One scroller, and which one

**The gatefold scrolls; its panels do not.** A panel sized to the space left over inside a `flex: 1; min-height: 0` chain **clips** the rest, the edge fade dresses the cut up as more content below, and no scrollbar can reach it. So the gatefold's panels are `flex: none` and size to their content. **`TrackPanels`' `screen` variant is the exception, and the variant is exactly that question**: there the header above is pinned, so the panel takes what is left and scrolls inside it. That is why the edge fade lives on `.panelBody[data-variant="screen"]` rather than in the three panel stylesheets — **a mask belongs to whatever actually scrolls.** The phone's *player* scrolls nothing at all: everything that would is one press away.

**The pill hangs off the layer, not off the panel.** `.resume` is the one absolutely positioned thing inside a panel, and in the layer the panel is the *scroller* — an absolutely positioned child of a scroller is part of what scrolls, so the pill rode the lyric up and out of the view it exists to bring you back to. `position: static` on the panel body hands it to the layer, which does not move. The gatefold is left alone: there the panel is not the scroller, and nothing about it changed.

**The layer gives up its horizontal padding so the panel can reach the edges.** An overlay scrollbar draws at the right edge of *whatever scrolls*, so a scroller inset by the layer's own gutter floats a bar a finger's width inside the screen, next to the browser's own — which is what a double scrollbar turns out to be. The 20px moves onto the header and onto the panel's own box, so the content is inset and the bar is not.

**`--head-offset` is one number for two sticky things**, and only on the gatefold. The header and the tabs both pin against the header's height, and the identity column pins below it; at `top: 0` the cover sticks to the top of the scroller and the header slides over it. In the layer the strip sits above the scroller rather than inside it, so it pins at `top: 0` and inherits nothing.

**`scrollParentOf` finds the scroller rather than being handed it**, because the box that scrolls differs by layout. `offsetParent` answers a different question — the nearest *positioned* ancestor — which is what makes following work on a phone and do nothing on a desktop. Measure the scroll offset with `getBoundingClientRect` against the scroller for the same reason. **Every scroller lookup inside this screen is bounded by `data-now-playing`**, passed to `scrollParentOf`. Unbounded, the walk goes past the layer and finds the *track list* scrolling behind it: a gesture on the header would read that list's scroll position, decide it was not at the top, and silently refuse to dismiss.

## Gestures

**One meaning per surface, which is the whole point of the split.** On the phone's player, horizontal is previous and next and vertical is up-for-the-panels, down-to-dismiss; inside `TrackInfo`, horizontal steps the tabs and **either vertical direction closes it** — a flick away in the direction your thumb happens to be going, rather than one correct way out to remember. The gatefold keeps only the dismissal, and its tab swipe rides `TrackPanels` itself.

**Sideways turns a wheel, and the wheel is the whole of what a skip looks like.** `CoverWheel.tsx` puts the sleeves on the rim of a circle whose centre is far below the screen: each slot is the stage box pivoted about that centre, so rotating one swings it along the rim *and* tilts it by the same angle, which is what a thing bolted to a wheel does. One `rotate()` on one wrapper moves all three. Rejected: **Cover Flow**, which is the obvious reference and therefore the wrong one — it is depth, reflections and perspective, it was a *browsing* control Apple retired in iTunes 11, and every recreation of it reads as nostalgia. This is flat, in the plane, closer to a wheel picker.

**The radius is set by what it has to hide, and the drag has to be geared because of it.** A neighbour must clear the viewport at rest, which at 22° needs about three and a half sleeve widths of radius — and that puts one step at roughly 1.3 sleeve widths of arc, further than a thumb travels. So the rim cannot roll under the finger at 1:1 and `REACH` gears it instead: 45% of the stage completes a step. The two numbers are a pair and neither can be moved alone — `STEP` is in the component because the state machine counts in it, the radius is in the stylesheet because it is spatial.

**Three nodes serve every position, keyed by index mod 3.** Consecutive integers never collide mod 3, and a node changing which position it holds is off screen when it does — so the sleeves are recycled and never mounted mid-gesture. That is not tidiness: a touch whose target leaves the document stops being delivered, which is the same trap `pointer-events: none` on the sleeve exists for.

**The rim follows the ear, and the identity beside it must never disagree with it.** `audibleTrackKey` is what it turns on, not the player's track — while a stream is attached those are a second or more apart. A flick turns the rim at once, so for the length of that lag the sleeve on screen is the track arriving and the title is still the one leaving: a sleeve and a title belonging to two different songs. So a skip holds the identity from the gesture until the sound catches up, **whether or not the sleeve is already known** — a prefilled neighbour makes the picture right early and the words no less wrong.

**Whether a turn was refused is a question about the player, never about the ear.** The player answers a skip at once; the sound arrives a lag later, which on the plain stream path is seconds — longer than the wheel waits before putting an unanswered turn back. So the undo reads `playerTrackKey`, which is never delayed, and the hold reads the audible one. Waiting on the ear for both rewinds a skip that had already landed.

**A turn is provisional until the player names a track.** The flick turns the rim at once — that is the whole point, and waiting for the network is what made the old version feel dead — so the slot it lands on may hold nothing yet. **Nothing is the loading state, not the empty one**: a sleeve-shaped hold and two bars where the title and artist go, never "Nothing playing", which is a different and untrue thing. And because a skip is not guaranteed to move anything — at the end of a playlist the player takes `next`, plays nothing and reports nothing — an unanswered turn is put back after four seconds rather than left on a sleeve that will never resolve.

**Which way to turn is told, never inferred.** The player reports that a track changed and never which direction it moved, and under any shuffle order there is nothing to work it out from — so a wheel left to guess turns forward on everything, and Previous animates as Next. Skips from this screen carry their own direction because they turn the rim before they ask. Everything else — the status bar, `Mod+←`, the media session — is covered by `takeSkipAsked()` in `shared/api/beefweb.ts`, recorded at the request because **that is the only place all of them meet**: the keyboard reaches `previousTrack()` straight from `App.tsx` and never touches `useTransport`. The record is *taken* rather than read, and stale after four seconds: a skip the player never answers must not turn the next track that ends by itself into a step backwards.

**Prefill needs no branch, which is the reason it is worth having.** A slot with a sleeve draws it and a slot without one draws as a hold, so filling the neighbours in advance is an optimisation rather than a second path. The artwork endpoint is addressed by *position*, so under Default order `index ± 1` is the real neighbouring sleeve for a lookup and no request of Jean's own. Under Shuffle or Random it is unknowable and the hold does its job. It never overwrites: what a slot already holds is a track that really played, which beats a guess at one.

**Reduced motion gets the cross-fade, not a shorter turn.** The rotation *is* the statement; with it refused there is nothing left but one sleeve replacing another, so the neighbours are not drawn at all and the current one fades. The gesture is untouched — what goes is the movement, never the control.

**The skip gesture covers the whole player, not just the artwork.** There is nothing else on that screen with a horizontal axis — the seek bar and the faders opt out through `data-owns-touch` — and a rule with no exceptions is one nobody has to aim at. The transport buttons stay on screen as the visible cue the gesture needs; the flick is a shortcut for a control you can see, never the only way.

**The sleeve must not take the touch.** `Artwork` swaps its own element as a cover resolves — placeholder, then image — and a gesture whose target leaves the document stops being delivered to React's root at all: the finger goes on moving and the app sees a tap where the flick began. `pointer-events: none` on the compact cover hands the touch to the box around it, which never remounts. **Nothing on this screen is keyed on the track for the same reason.** See `shared/ui/CLAUDE.md`.

**Each vertical direction fires from the end of the scroll it would otherwise be.** Halfway through a lyric a downward flick means "scroll back up" and an upward one means "read on"; once there is nothing further that way, the same flick means "close". Restricting the gesture to the *regions* that do not scroll leaves the thing you are most likely to be reading as the one you cannot swipe away. That is what forces touch events over pointer events — see `useSwipe` in `shared/ui/CLAUDE.md`.

**A control that follows the finger keeps its gesture, and says so with `data-owns-touch`.** The transport sits inside the swipe surface, so without that mark a drag down the fader dismisses the screen and a scrub across the seek bar skips the track. `useDragFraction` writes the attribute on every fader and scrubber it makes, the two popovers carry it themselves, and `useSwipe` records nothing when the touch begins under one. Marking the *popover* and not only the track is deliberate: a finger that strays off a 26px column mid-drag is still the fader's.

**The layer leaves the way it was sent.** A flick names a direction, so the exit throws it that way — up for an upward flick, down for a downward one — and the chevron, which names none, gets the way it came in. It has to outlive its own close for that: `usePresence` keeps it mounted for the length of the exit, exactly as the screen under it does.

**`touch-action: pan-y` keeps the horizontal axis from becoming a browser gesture**: an edge swipe is back-navigation on Android Chrome, and that would beat a skip or a tab change to it. The vertical axis stays the scroller's. **The panel slides in from the side the gesture came from**, in the layer only, **and only on a step** — `direction` starts at `0`, because the first panel arrives with the layer sliding up from the bottom edge and a sideways entrance across that reads as the content coming in crooked. Content that simply replaces itself gives no sign a flick did anything. The wrapper is keyed on the tab so the entrance replays; without the key it persists across a change and only its children swap — which is exactly the "nothing happened" the animation exists to fix. `transform` and `opacity` only, so the tab strip holds still.

## The one request

**The lyric tag and the detail fields must never reach `UPDATES_URL`.** The stream re-evaluates its `trcolumns` on every push — track change, pause, each write of a volume drag — and the lyric tag alone reaches 8.5 KB. `useNowPlayingTrack` fetches them once per track through `fetchActiveItemColumns`, and the stream keeps carrying its four expressions.

It is **keyed on the file** (`path`, `subsong`), not on the playlist position, which moves whenever anything above it is edited. And the answer is **verified rather than trusted** — `/api/query?player=true` reports whatever is playing when it is *served*, so a track that ended in flight would otherwise cache the next track's lyrics under this one's key. **Every value goes through `readValue()`.** Read raw, a field the player cannot resolve is the literal string `?`, which is perfectly truthy — so the lyrics panel draws a one-line lyric consisting of a question mark on every track without the tag, and the album line draws `?` beside the year.

## Lyrics

**`$meta(unsynced lyrics)` — with a space — and the name lies.** Reading it needs no component; `foo_openlyrics` is what *writes* it. Over one 30,441-track library, 7,705 tracks (25.3%) carry the tag and of a random 150 of those 51 (34%) hold LRC timestamps — so followable lyrics are about **8.6% of a library** and "no lyrics at all" is the common case at **74.7%**. That is why the gatefold falls through to Details rather than opening on an empty panel.

**`lyricsFormat.ts` is named for the format rather than the feature, because `Lyrics.tsx` sits beside it.** On a case-insensitive filesystem TypeScript resolves `'./Lyrics'` by probing `Lyrics.ts`, so `lyrics.ts` would silently answer for the component import.

What the parser has to survive, all seen in real files:

- **`\r\n` throughout**, and a lone `\r` from older taggers.
- **One line can carry several timestamps.** `[00:18.50][01:02.10]…` is a refrain sung twice; reading only the first drops half the second chorus.
- **`[offset:...]` is milliseconds to *subtract***, which is the opposite sign to the one everybody assumes. Clamp at zero, or a line sorts before the track starts and can never become current.
- **A fraction is not always hundredths.** `[00:12.5]` is five tenths and `[00:12.500]` is five hundred milliseconds, so pad rather than divide by a guessed power of ten.
- **NetEase rips open with `作词 :` / `作曲 :` credit lines**, and some "lyrics" are a bare URL. Neither is cleaned up: tag hygiene is the library owner's business.

**Counting timestamps is not enough to call a lyric synced.** A large minority of tagged tracks are NetEase rips of instrumentals whose entire lyric is two credit lines and `纯音乐，请欣赏` — three timestamps, all inside the first five seconds of a four-minute track. Counted, that is a synced lyric; drawn, it is a karaoke view that fires three times and then sits dead. Worse, the *same* boilerplate appears with one or two lines elsewhere, so a count threshold classifies identical content two ways. So **`SYNCED_MIN_SPAN` asks whether the timing is followable** — twenty seconds, an order of magnitude above every boilerplate file measured and far below any real lyric.

**The active line is state; the position is not.** The frame loop recomputes an *index* and sets it only when it changes, a few times a minute. Re-rendering a few hundred lines sixty times a second to move one highlight would be the most expensive thing in the app. **The empty state is a state, not an explanation.** Met three times out of four while listening, so it says "No lyrics found" and stops; naming the tag and the component that writes it belongs in Settings.

**The first placement is a jump, not a journey**, and the active line is seeded from the current position during render rather than starting at `-1`. Otherwise the panel paints at the top of the lyric and then smooth-scrolls through a verse nobody is reading. Placement is a `useLayoutEffect`: after paint, being instant only buys a frame showing the wrong place. That is also why the parse happens in `NowPlaying` rather than in `Lyrics` — two decisions outside the panel turn on whether the lyric is synced.

**Following is given up on a manual scroll and handed back by a pill**, never by a timeout: a timeout takes it back while somebody is still reading. A programmatic scroll fires the same `scroll` event a finger does, so the guard is a flag the handler checks, time-boxed because `scrollend` is not everywhere yet.

**The current line sits a third of the way down, not centred**: the line being sung is the one you have already heard, and the useful half of the view is what is coming. **Lines still to come need a per-theme colour** — legible, because reading ahead is half of why anyone opens this, while losing clearly to the current line. On dark `--muted` does both; on light it is a near-black the current line cannot beat, so light pulls them back to `--faint`.

**There is no spacer after the last line.** A tall block below the lyric is by definition mostly nothing, and on a lyric short enough to fit it is the *only* thing you can scroll to. The follow's `scrollTo` is clamped by the browser anyway, so `padding-bottom` on the list gives breathing room without the dead scroll.

## Coming back to a panel

Switching tabs unmounts the panel, so anything worth keeping has to be kept deliberately. `usePanelScroll` remembers an offset per **panel and track**: a new song's lyrics are not the old song's, scrolled down. It re-resolves the element rather than holding one, because the scroller is a different element on each layout and, on a phone, is rebuilt on every tab change. It is deliberately *not* `app/useScrollMemory`, which owns the app's single permanent scroll container and remembers a route.

**And it is switched off for a synced lyric.** Restoring an offset writes `scrollTop`, which fires the same `scroll` event a finger does, which the follow reads as *the reader has taken over* — the lyric then sits still for the rest of the song with the resume pill showing. It is also the wrong thing to restore: the song has moved on, and the follow already knows where to be.

## Full screen, on the gatefold

**`LyricsScreen` is the desktop's, and a phone never reaches it** — the Lyrics tab there is already the whole viewport, so the expander is drawn only where `TrackPanels` is handed an `onExpand`. That is one entry point, one layer and no second full-screen lyric to keep in step.

**`LyricsScreen` reuses `Lyrics` rather than drawing its own**, so the follow, the resume pill, seek-on-click and the synced/plain/empty states cannot come to mean two things. The only differences are `--lyric-size` — read with a fallback in `Lyrics.module.css`, because a custom property *declared* on the element beats anything an ancestor sets — and the space around it.

**It is a sibling of the now-playing screen, not a child**, as `TrackInfo` is on a phone. As a child it sits inside that screen's touch handlers, so every flick in full screen would also skip a track underneath; stopping propagation on three handlers holds until someone adds a fourth. **It is `position: fixed` at every width**, where the now-playing screen is only fixed on a phone and the queue panel never is. Everything positioned in `.body` starts *below* the top bar and beside the sidebar, so a layer there leaves the search field, the gear and the theme switch on screen and "only the lyrics are visible" is false. Nothing between it and the viewport establishes a containing block. `z-index: 45` puts it over the app chrome, the queue panel (30) and the screen (25), and deliberately **under** toasts (50) and menus (70) — a write that failed still has to be able to say so.

**The panel's own `Lyrics` is unmounted while it is up.** Two mounted at once is two animation-frame loops recomputing the same active line, and the hidden one still drives *its* scroller, so the panel underneath would quietly scroll itself for the whole song.

**The X is top-right, where the references say top-left**: that corner already holds this screen's chevron-down one layer down, and two dismissals stacked in one corner is a mis-tap by construction. It sits in a bar of its own rather than floating over the text.

**Escape closes it on the capture phase and stops there**, because the playlist scope binds Escape to clearing a selection and the list is still mounted two layers down. `useEscapeCapture` is that rule for both layers. Swiping either away needed nothing built: `useSwipe`'s `onDown` already fires only when the thing under the finger had nowhere further up to go.

**The entry point is on the Lyrics tab and only when there is a lyric.** It is a child of the **tab strip**, absolutely positioned at `top: 100%`, so it lands over the panel without being in it — which keeps it next to the thing it acts on and inherits `.tabs`'s `position: sticky` for free, so it rides the strip as the leaf scrolls. Out of flow deliberately: the strip is `space-around` in the layer variant and a real flex child would push ARTIST off its spacing. It carries a surface and a border because lyrics scroll under it — a bare glyph over running text reads as a mark *in* the lyric. **Hidden rather than disabled when the tag is empty**: a dimmed control on three quarters of a library is an affordance that never once works.

## Details

**Detected per track, never per library.** A tag field answers `?` for the file that lacks it, so which rows exist is a question about *this file*. Across 30,441 tracks: `%samplerate%` and `%channels%` 100%, `%date%` 99.7%, `%totaldiscs%` 90.4%, `%codec_profile%` 82.6%, `%publisher%` 61.2%, `%composer%` 25.0%, `%replaygain_track_gain%` 4.1%, `%bpm%` 0.9%, `%bitspersample%` **0%**. A fixed grid with those labels would be mostly empty cells on most tracks, and empty cells read as Jean failing rather than as tags nobody wrote.

**`%comment%` is deliberately excluded**: 19.9% coverage, and most of what it holds is ReplayGain hex written there by an old tagger. So are `%isrc%`, `%barcode%`, `%catalognumber%`, `%label%`, `%media%`, `%mood%`, `%style%`, `%key%`, `%language%` and the MusicBrainz ids — every one resolves on exactly zero tracks.

**`%year%` is what is shown; `%date%` earns a row only when it says more.** It is a messy user tag — year-only on 26,891 tracks, full ISO on 3,022, untidy on 434 — so parse it leniently or not at all. Rendering `2011-00` as a date invents a month nobody tagged.

## Artist

**The only thing in Jean that leaves the network, and it is off until asked.** A biography is the one fact a local library genuinely does not hold, but a music player on a LAN telling a third party what its owner is listening to is not a default anybody chose. Off, the tab says what it would do and where the switch is; a tab that is simply empty reads as broken, and one that quietly starts making outbound requests is worse.

MusicBrainz's `ws/2` and Wikipedia's REST summary both answer `Access-Control-Allow-Origin: *` with no key and no proxy. **Deezer does not**, which is why it is not here despite being the obvious source for artist images.

Three things that cost time:

- **MusicBrainz links Wikidata, not Wikipedia.** The direct link is tried first because older entries carry it and it saves a hop, but the Wikidata path is the one that runs.
- **The Wikidata REST path is `v1`.** The `v0` most examples show is a 404.
- **A browser cannot send the `User-Agent` MusicBrainz asks for** — it is a forbidden header name and `fetch` drops it silently. It works anyway: a real Chrome UA answers 200 and only the bare token `Mozilla/5.0` is refused with 403, which is a bot filter rather than a policy. An ignored header in the code would only look like it had done something.

**A match below a MusicBrainz score of 90 is discarded**: a confident biography of the wrong band is worse than none.

## Rating

**The playing track has no row anywhere**, so this cannot go through `rate()` like a list row does — there is nothing to patch optimistically. The now-playing query is that row's stand-in and `setRating` patches it directly, which keeps the fact in one store rather than adding a second overlay beside `ratingStore` (which is keyed on the row arrays `playlistStore` publishes and cannot see this one).

**Rating is silent on success and speaks on failure**, and the failure names the track. The read-only rule is asked per track: a raw value above 5 is on somebody else's scale, and rescaling a `100` to five stars is a 4% rating drawn as full marks. See `src/domain/track/CLAUDE.md`.

## Sizing

**The artwork always fits.** The player is the one region that should never scroll. `.stage` is capped at `max-height: 100%`, so on a window narrower than it is tall the square box goes short and wide instead of overflowing. And **`Artwork` is called with no `size`** there: given one it writes `width`/`height` inline, which beats the class working the box out and stretches a square cover into that oblong.

**The player has no fade at all.** With nothing to scroll there is nothing above for a top fade to promise, and when the artwork is height-constrained — a tall phone, which is most of them — the bottom of the sleeve **is** the bottom of the space given to it, so a fade there would dissolve the last inch of the picture. **A mask belongs to a scroller, and this is not one.**

**`Stars` reads `--star-size` through `--stars-size`, and the indirection is the point**: a custom property declared on the element beats an inherited one, so `.stars { --star-size: 12px }` silently wins over anything a container sets. Twelve pixels is right in a table cell drawn thirty thousand times and wrong here; the compact size is 22px, still a target since the glyph plus the 6px gap and the button's padding clears 44px.

**`PlayToggle` is the same component in the status bar and on the screen, at two sizes** — not two buttons that look alike. The continuous motion is the whole personality of the control, and a second copy of eight coprime keyframe animations is the one that would drift; the alternating-motion clock lives in the component for the same reason. **The size is a variant, not a number**, because the button also shrinks at the 720px breakpoint and anything spatial belongs to the media query. `--play-size` drives everything including the icon, and **CSS `width`/`height` on the `svg` beats the attributes lucide writes**, which is what lets the glyph track the button without a second number in JS.

**When a styled element moves modules, delete the rule it left behind.** A rule pointing at a class that no longer exists still parses, still looks deliberate, and does nothing at all.
