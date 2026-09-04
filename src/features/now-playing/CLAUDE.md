# Now playing

The status bar, and the screen it opens. The shell and the breakpoints are in `src/app/CLAUDE.md`.

## Two components, one idea

The status bar is **one component with two shapes**. So is the screen, and the two shapes are the same idea rotated ninety degrees:

- **Desktop is a gatefold.** The cover and the identity are a *sticky* left leaf; the tabs are the right one and scroll. What you look at holds still while what you read changes.
- **Compact is the same split turned vertical.** The tabs sit at the top under the header on both layouts; the panel below them is the flexible region, and the identity and transport are fixed under it — so the transport is at a constant distance from the bottom edge whatever tab is open, and the thing you are aiming at never moves.

**The desktop screen draws no transport at all.** The status bar is on every screen and already carries a full one; a second set inside the view is what makes a desktop screen read as a stretched phone app. It is *not rendered* rather than hidden, because `Times` runs an animation-frame loop.

## The status bar

**What the compact bar has is Play and volume, in that order.** Volume sits *left* of Play so Play stays the rightmost thing and therefore closest to a right thumb; volume earns the slot because it is the *player's* volume and the handset's hardware keys cannot reach it. Shuffle, skipping and the queue moved to the screen, where they are full-sized.

**No thumbnail in the slim strip.** Every mini-player worth looking at is artwork plus two lines, and copying that here gets the Spotify bar exactly. The cover is one swipe away at full size. **The block toggles rather than opens**, and carries no hover fill: a panel that size lighting up behind the artwork is a lot of movement for something you are not choosing between.

**A swipe up anywhere on the strip opens the screen.** It is on `.row` rather than on the footer so it starts *below* the seek bar — that is a 4px strip owning the vertical axis for scrubbing, and a drag beginning there is a scrub. It calls `onRevealNowPlaying`, not the toggle the tap uses: **up is a direction, not a switch**, and there is nothing for it to mean when the screen is already up. The 60px threshold is also what keeps it off the transport — a finger travelling that far has left whichever 38px button it started on, so the browser withholds the click.

**"Playing from", not "from".** The bare preposition reads as a fragment of a sentence that never arrives, especially next to a name like "All music". `usePlayingFrom` is unchanged and the sidebar still uses it.

**On the screen's header that line is a button, and the whole line is the target** — on a phone the label is half of what there is to aim at. It is drawn as a button only when `App` hands it a route, which is the same resolution the sidebar's temporary row uses, so a set with nowhere to open stays a sentence rather than a control that does nothing. Opening the route *is* the dismissal, and no chevron or underline is added: the name is already the loudest thing on the line.

**Where the sound comes out sits between the readout and the fader** on desktop, and left of the fader on a phone: *where* has to be answered before *how loud there* means anything. It is read far more often than pressed — the collapsed icon says where the sound is without being opened, and a count rides on it when somebody else is listening. **The fader beside it retargets rather than doubling.** While the sound is on this device the player's volume sits *before* the capture, so pointing the control at it leaves a slider that moves and changes nothing audible. One control, one target at a time, and its label says which. On iOS there is no target at all, so it is not drawn and the picker says the hardware keys own it. Reasoning and probe in `src/domain/player/CLAUDE.md`.

**The picker is two outputs and then a roster, and the two halves are drawn as different kinds of thing.** The reference is AirPlay 2 in Apple Music — checkmarked rows that go multi-select, each growing its own fader once more than one is on. Rejected: Spotify Connect's flat list of devices you push audio to, because Jean cannot push to any of them; and the macOS Sound menu's pure single-select, which has nowhere to put the others. So the top is toggles you press and the bottom is a plain list with no hover and no target padding — **a row that lights up under the cursor promises an action this list does not have.**

**Toggles rather than a radio group, because both outputs really can be on.** Pressing one still hands the sound over; that is what the buttons do. But `role="radio"` would announce "1 of 2" while it plays in two rooms, so the state underneath is two `aria-pressed` booleans. **The tick means the sound comes out there** and stays literally true on a device listening to nothing, which is what lets the same row read "Muted while Android phone is listening" on a laptop that is not.

**Unmute is named for its target.** The status bar's own mute button answers to "Unmute" too whenever the player is silent — and pressing *that* one is the same act by accident — so the picker's carries `aria-label="Unmute <player>"`. Two controls one word apart in the same footer is a mis-tap and an ambiguous accessible name by construction.

**The player's fader lives in the player's row and only while this device is listening.** Elsewhere the status bar's own still points at the player, and a second one beside it would be the same control twice. **The status bar fader never mode-switches for this**: it stays on this device, and the row's fader is what the extra output brought with it.

**The picker is on the compact screen's transport, left of the fader as it is in the bar, and nowhere else.** On a phone `#/playing` replaces the status bar, so without a copy there the one control that says where the sound is going is unreachable for as long as the screen is up. The desktop screen draws no transport at all — the bar under it carries the picker and the fader both, and a second copy would be the same control twice.

## The identity block

**It has two shapes on a phone, and the tab decides which.** Under the artwork it is the caption to a picture and can afford four lines — title, artist, album · year, stars. Under Lyrics, Details or Artist it competes with the content for the same screen, so it drops to **title and artist, one line each, truncated**: the album and year go because Details lists both, and the stars go because rating is a deliberate act with two other routes to it. The gatefold is untouched — its identity is a sticky column with a leaf to itself.

## Not looking like a streaming client

**No colour pulled out of the artwork** — it is in every reference, which makes it the median, and it fights `#ffb454`. The cover is the colour on the screen. **Flush left, not centred**: six of eight references centre the title under a centred square, which is what makes them interchangeable, and a sleeve back is set ragged-right. **A route, not a sheet**, because it has tabs, scroll and a dismiss — but `closeNowPlaying` remembers the route that opened it rather than calling `history.back()`, which on a direct load of `#/playing` would leave Jean altogether.

## A layer, and why it has to be

**The screen is positioned over `.body`, not rendered instead of the view.** It is a route *and* an overlay: `App` keeps resolving the route underneath and the shell keeps drawing it, which is the whole reason there is something to slide over.

**Mounted only while open, plus the length of the exit.** `SLIDE_MS` has to match the stylesheet, because it is timing that exit. Not merely hidden: the lyric panel runs an animation-frame loop. **`z-index: 25` is measured against what it has to beat** — the list's toolbar is `10`/`12` and the finder is `20`, all inside `main`, and the queue panel above it is `30`. **Reduced motion keeps a fade rather than nothing**: the movement *is* the statement about where dismissing sends it.

## One scroller, and which one

**The screen scrolls; the panels do not.** A panel sized to the space left over inside a `flex: 1; min-height: 0` chain **clips** the rest, the edge fade dresses the cut up as more content below, and no scrollbar can reach it. So the gatefold panels are `flex: none` and size to their content, and the **compact layout is the exception**: there the transport is pinned to the bottom edge, so the panel takes what is left and scrolls inside it. That is why the edge fade lives on `.panelBody` under `[data-compact="true"]` rather than in the three panel stylesheets — **a mask belongs to whatever actually scrolls.**

**`--head-offset` is one number for two sticky things.** The header and the tabs both pin against the header's height, and the identity column pins below it; at `top: 0` the cover sticks to the top of the scroller and the header slides over it.

**`scrollParentOf` finds the scroller rather than being handed it**, because the box that scrolls differs by layout. `offsetParent` answers a different question — the nearest *positioned* ancestor — which is what makes following work on a phone and do nothing on a desktop. Measure the scroll offset with `getBoundingClientRect` against the scroller for the same reason. **Every scroller lookup inside this screen is bounded by `data-now-playing`**, passed to `scrollParentOf`. Unbounded, the walk goes past the layer and finds the *track list* scrolling behind it: a gesture on the header would read that list's scroll position, decide it was not at the top, and silently refuse to dismiss.

## Gestures

**Horizontal steps through the tabs**, not previous and next: the skip buttons are on screen and unambiguous, while the tabs are the thing you would otherwise aim a 40px target at. **Down dismisses from the top of whatever is under the finger**, on every tab. Halfway through a lyric a downward flick means "scroll back up"; once there is no further up to go it means "close". Restricting the gesture to the *regions* that do not scroll leaves the tab you are most likely to be reading as the one you cannot swipe away. That is what forces touch events over pointer events — see `useSwipe` in `shared/ui/CLAUDE.md`.

**A control that follows the finger keeps its gesture, and says so with `data-owns-touch`.** The transport sits inside the swipe surface, so without that mark a drag down the fader dismisses the screen and a scrub across the seek bar steps a tab. `useDragFraction` writes the attribute on every fader and scrubber it makes, the two popovers carry it themselves, and `useSwipe` records nothing when the touch begins under one. Marking the *popover* and not only the track is deliberate: a finger that strays off a 26px column mid-drag is still the fader's.

**`touch-action: pan-y` keeps the horizontal axis from becoming a browser gesture**: an edge swipe is back-navigation on Android Chrome, and that would beat a tab change to it. The vertical axis stays the scroller's. **The panel slides in from the side the gesture came from**, compact only. Content that simply replaces itself gives no sign a flick did anything. The wrapper is keyed on the tab so the entrance replays; without the key it persists across a change and only its children swap — which is exactly the "nothing happened" the animation exists to fix. `transform` and `opacity` only, so the tab strip holds still.

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

## Full screen

**`LyricsScreen` reuses `Lyrics` rather than drawing its own**, so the follow, the resume pill, seek-on-click and the synced/plain/empty states cannot come to mean two things. The only differences are `--lyric-size` — read with a fallback in `Lyrics.module.css`, because a custom property *declared* on the element beats anything an ancestor sets — and the space around it.

**It is a sibling of the now-playing screen, not a child.** As a child it sits inside that screen's touch handlers, so every flick in full screen would also step the tabs underneath; stopping propagation on three handlers holds until someone adds a fourth. **It is `position: fixed` at every width**, where the now-playing screen is only fixed on a phone and the queue panel never is. Everything positioned in `.body` starts *below* the top bar and beside the sidebar, so a layer there leaves the search field, the gear and the theme switch on screen and "only the lyrics are visible" is false. Nothing between it and the viewport establishes a containing block. `z-index: 45` puts it over the app chrome, the queue panel (30) and the screen (25), and deliberately **under** toasts (50) and menus (70) — a write that failed still has to be able to say so.

**The panel's own `Lyrics` is unmounted while it is up.** Two mounted at once is two animation-frame loops recomputing the same active line, and the hidden one still drives *its* scroller, so the panel underneath would quietly scroll itself for the whole song.

**The X is top-right, where the references say top-left**: that corner already holds this screen's chevron-down one layer down, and two dismissals stacked in one corner is a mis-tap by construction. It sits in a bar of its own rather than floating over the text.

**Escape closes it on the capture phase and stops there**, because the playlist scope binds Escape to clearing a selection and the list is still mounted two layers down. Swiping it away needed nothing built: `useSwipe`'s `onDown` already fires only when the thing under the finger had nowhere further up to go.

**The entry point is on the Lyrics tab and only when there is a lyric.** It is a child of the **tab strip**, absolutely positioned at `top: 100%`, so it lands over the panel without being in it — which keeps it next to the thing it acts on, keeps the header at three controls on a phone, and inherits `.tabs`'s `position: sticky` for free so it rides the strip on the gatefold. Out of flow deliberately: on compact the four tabs are `space-around` across the full width and a real flex child would push ARTIST off its spacing. It carries a surface and a border because lyrics scroll under it — a bare glyph over running text reads as a mark *in* the lyric. **Hidden rather than disabled when the tag is empty**: a dimmed control on three quarters of a library is an affordance that never once works.

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

**The artwork always fits.** The Playing tab is the one panel that should never scroll. `.stage` is capped at `max-height: 100%`, so on a window narrower than the panel is tall the square box goes short and wide instead of overflowing. And **`Artwork` is called with no `size`** there: given one it writes `width`/`height` inline, which beats the class working the box out and stretches a square cover into that oblong.

**The Playing panel has no fade at all.** With nothing to scroll there is nothing above for a top fade to promise, and when the artwork is height-constrained — a tall phone, which is most of them — the bottom of the sleeve **is** the bottom 30px of the panel, so a bottom fade dissolves the last inch of the picture. **A mask belongs to a scroller, and this is not one.**

**`Stars` reads `--star-size` through `--stars-size`, and the indirection is the point**: a custom property declared on the element beats an inherited one, so `.stars { --star-size: 12px }` silently wins over anything a container sets. Twelve pixels is right in a table cell drawn thirty thousand times and wrong here; the compact size is 22px, still a target since the glyph plus the 6px gap and the button's padding clears 44px.

**`PlayToggle` is the same component in the status bar and on the screen, at two sizes** — not two buttons that look alike. The continuous motion is the whole personality of the control, and a second copy of eight coprime keyframe animations is the one that would drift; the alternating-motion clock lives in the component for the same reason. **The size is a variant, not a number**, because the button also shrinks at the 720px breakpoint and anything spatial belongs to the media query. `--play-size` drives everything including the icon, and **CSS `width`/`height` on the `svg` beats the attributes lucide writes**, which is what lets the glyph track the button without a second number in JS.

**When a styled element moves modules, delete the rule it left behind.** A rule pointing at a class that no longer exists still parses, still looks deliberate, and does nothing at all.
