# Now playing

The status bar, and the screen it opens. General rules are in the root
`CLAUDE.md`; the shell and the breakpoints are in `src/app/CLAUDE.md`.

## Two components, one idea

The status bar is **one component with two shapes**. So is the screen, and the
two shapes are the same idea rotated ninety degrees:

- **Desktop is a gatefold.** The cover and the identity are a *sticky* left
  leaf; the tabs are the right one and scroll. What you look at holds still
  while what you read changes.
- **Compact is the same split turned vertical.** The tabs sit at the top under the
  header on both layouts; the panel below them is the flexible region, and the
  identity and the transport are fixed under it. The transport is therefore at a
  constant distance from the bottom edge whatever tab is open -- the thing you
  are aiming at never moves.

  The tabs were at the *bottom* first, on the argument that a control belongs
  where the thumb is. The swipe repealed that: left and right change tab without
  reaching for anything, so the strip became a label of where you are more than
  a control you aim at -- and putting it where the gatefold has it makes the two
  layouts read the same way.

**The desktop screen draws no transport at all.** The status bar is on every
screen and already carries a full one; a second set inside the view is the move
that makes a desktop screen read as a stretched phone app. It is *not rendered*
rather than hidden, because `Times` runs an animation-frame loop and one
ticking behind an invisible element for a whole session costs something and
shows nothing.

**What the compact status bar has left is Play and volume, in that order.**
Volume sits *left* of Play so Play stays the rightmost thing in the bar and
therefore the closest to a right thumb. Volume earns the slot because it is the
*player's* volume -- the handset's hardware keys cannot reach it. Shuffle,
skipping and the queue all moved to the screen, where they are full-sized
targets rather than 32px ones wedged around Play.

**The queue button is in the screen's *header*, not its transport**, and only on
compact. The transport is the five controls that act on the sound; the queue is
navigation. On a desktop the status bar keeps its own and this would be a second.

**The ⋯ beside it is the same menu a row gets**, and "same" means the same
array: `domain/track/trackActions.ts` builds it for both, so "Add to queue"
cannot come to mean one thing in a list and another here. `ActionMenu` draws it,
as it draws every menu in the app. The rating submenu is passed *in* rather than
built there, because the two callers hold a rating in different shapes — a row
array against a now-playing column set — and neither belongs in the other's
file.

**The identity block has two shapes on a phone, and the tab decides which.**
Under the artwork it is the caption to a picture and can afford four lines --
title, artist, album · year, stars. Under Lyrics, Details or Artist it is
competing with the content for the same screen, and four lines of it was
costing a verse: *observed*, a title as long as "Magnetizing feat. Del tha
Funkee Homosapien" wrapped to two lines and took the best part of an inch off
the biography under it.

So on those three tabs it is the smallest thing that still answers "what is
this": **title and artist, one line each, truncated.** The album and the year go
because Details lists both, two rows further down; the stars go because rating
is a deliberate act with two other routes to it -- the Playing tab and the ⋯
menu -- and not something to hold a 44px target on screen for at all times.

**No thumbnail in the slim strip, and that is the decision worth recording.**
Every mini-player worth looking at -- Apple Music's, Music Assistant's -- is
artwork plus two lines, and copying that here gets the Spotify bar exactly. The
cover is one swipe away at full size, this screen's identity is set flush left
like a sleeve back rather than as a row with a picture in it, and a 40px copy of
something already on the next tab buys nothing.

The gatefold is untouched: its identity is a sticky column with a leaf to itself
and nothing to take space from.

**"Playing from", not "from".** The bare preposition reads as a fragment of a
sentence that never arrives, especially next to a name like "All music".

**A swipe up anywhere on the strip opens the screen**, which is the gesture the
bar's shape already suggests. It is on `.row` rather than on the footer so it
starts *below* the seek bar -- that is a 4px strip owning the vertical axis for
scrubbing, and a drag beginning there is a scrub.

It calls `onRevealNowPlaying`, not the toggle the tap uses: up is a direction,
not a switch, and there is nothing for it to mean when the screen is already up.
The 60px threshold is also what keeps it off the transport -- a finger that
travels that far has left whichever 38px button it started on, so the browser
withholds the click. *Measured*: swiping up from over Play opens the screen and
does not toggle playback, and a tap on Play still toggles playback and does not
open the screen.

**The status-bar block toggles rather than opens**, and it carries no hover
fill: a panel that size lighting up behind the artwork is a lot of movement for
something you are not choosing between, and it read as the bar having grown a
card in it.

**"from &lt;set&gt;" lives here now.** It was a third line in the status bar,
which is the one place in the app with no room for it. `usePlayingFrom` is
unchanged and the sidebar still uses it.

## Not looking like a streaming client

Three decisions, all deliberate, all cheap to undo by accident:

- **No colour pulled out of the artwork.** It is in every reference -- Spotify,
  Apple, Amazon, YouTube Music, and Qobuz's 2026 redesign adopted it too. It is
  now the median, and it fights `#ffb454`. The cover is the colour on the screen.
- **Flush left, not centred.** Six of eight references centre the title under a
  centred square, which is exactly what makes them interchangeable. A sleeve
  back is set ragged-right and so is this.
- **A route, not a sheet.** It has tabs, scroll and a dismiss; a route gets a
  real Back button and survives a reload. `closeNowPlaying` remembers the route
  that opened it rather than calling `history.back()`, which on a direct load of
  `#/playing` would leave Jean altogether.

## A layer, and why it has to be

**The screen is positioned over `.body`, not rendered instead of the view.** It
is a route *and* an overlay: `App` keeps resolving the route underneath and the
shell keeps drawing it, which is the whole reason there is something to slide
over. A view that replaced the content could only appear and disappear.

**Mounted only while open, plus the length of the exit.** `SLIDE_MS` has to
match the stylesheet, because it is timing the exit animation. Not merely
hidden: the lyric panel runs an animation-frame loop, and the rule against one
ticking behind an invisible element applies to a whole screen more than to an
icon.

**`z-index: 25` is measured against what it has to beat.** The list's toolbar is
`10`/`12` and the finder is `20`, all inside `main`; at `3` every one of them
drew straight through the lyrics. Below the queue panel at `30`, which slides
over this as it slides over everything.

**Reduced motion keeps a fade rather than nothing.** The movement *is* the
statement about where dismissing sends it, so the fallback is a shorter
crossfade, not a hard cut.

## One scroller, and which one

**The screen scrolls; the panels do not.** They used to, inside a
`flex: 1; min-height: 0` chain, and that was wrong in a way that looked right:
the panel was sized to the space left over and **clipped** the rest, the edge
fade dressed the cut up as more content below, and there was no scrollbar
anywhere that could reach it. On the desktop it also meant two scrollbars, and
the follow walked past the clipped panel and scrolled the view *behind* the
layer.

So the gatefold panels are `flex: none` and size to their content, and the
**compact layout is the exception**: there the transport is pinned to the bottom
edge, so the panel has to take the space that is left and scroll inside it.
That is also why the edge fade lives on `.panelBody` under
`[data-compact="true"]` rather than in the three panel stylesheets — it belongs
to whatever actually scrolls.

**`--head-offset` is one number for two sticky things.** The header and the tabs
both pin against the header's height, and the identity column pins below it: at
`top: 0` the cover stuck to the top of the scroller and the header slid over it.

**`scrollParentOf` finds the scroller rather than being handed it.** The lyric
follow has to drive whichever box is scrolling, and that differs by layout.
`offsetParent` answers a different question — the nearest *positioned* ancestor
— which is what made following work on a phone and do nothing at all on a
desktop; the scroll offset is measured with `getBoundingClientRect` against the
scroller for the same reason.

## Gestures

**Horizontal steps through the tabs. It was going to be previous and next, and
that is the worse of the two:** the skip buttons are on screen and unambiguous,
while the tabs are the thing you would otherwise be aiming a 40px target at.

**Down dismisses from the top of whatever is under the finger**, on every tab.
Halfway through a lyric a downward flick means "scroll back up" and nothing
else; once there is no further up to go it means "close". That is the rule every
sheet doing this uses, and the first attempt -- restricting the gesture to the
*regions* that do not scroll, the header and the artwork -- left the tab you are
most likely to be reading as the one tab you could not swipe away.

**Which forced touch events rather than pointer events, and that is the whole
of `useSwipe`'s design.** The browser cancels the pointer stream the moment it
claims a gesture for scrolling: *measured*, a downward flick inside a scrollable
panel arrives as `pointercancel` and never a `pointerup`. Touch events keep
firing through a scroll, so one handler on the whole screen can see every
gesture and decide for itself.

**`touch-action: pan-y` is still there, for a different reason than before.** It
keeps the horizontal axis from becoming a browser gesture -- an edge swipe is
back-navigation on Android Chrome, and that would beat a tab change to it. The
vertical axis stays the scroller's, which is now fine.

**Every scroller lookup inside this screen is bounded by it** --
`data-now-playing` on the section, passed to `scrollParentOf`. Unbounded, the
walk goes straight past the layer and finds the *track list* scrolling behind
it: a gesture on the header would then read that list's scroll position, decide
it was not at the top, and silently refuse to dismiss. The lyric follow has the
same bound for the same reason.

**The panel slides in from the side the gesture came from**, compact only. That
is most of what makes the swipe discoverable -- content that simply replaces
itself gives no sign a flick did anything, let alone that there is more of it
in the direction you flicked. The wrapper is keyed on the tab so the entrance
replays; without the key it persists across a change and only its children
swap, which is exactly the "nothing happened" the animation exists to fix.
`transform` and `opacity` only, so the tab strip above holds still.

## The one request

**The lyric tag and the detail fields must never reach `UPDATES_URL`.** The
stream re-evaluates its `trcolumns` on every push -- track change, pause, and
each write of a volume drag -- and the lyric tag alone reaches 8.5 KB.
`useNowPlayingTrack` fetches them once per track through
`fetchActiveItemColumns`, and the stream keeps carrying its four expressions.

It is **keyed on the file** (`path`, `subsong`), not on the playlist position: an
index moves whenever anything above it is edited, from Jean or from the desktop.
And the answer is **verified rather than trusted** -- `/api/query?player=true`
reports whatever is playing when it is *served*, so a track that ended in flight
would otherwise cache the next track's lyrics under this one's key. Same
discipline as `LibrarySource.identify`.

**Every value goes through `readValue()`.** This is not optional and it was a
real bug: read raw, a field the player cannot resolve is the literal string `?`,
which is perfectly truthy -- so the lyrics panel drew a one-line lyric consisting
of a question mark on every track without the tag, which is three quarters of a
real library, and the album line drew `?` beside the year.

## Lyrics

**`$meta(unsynced lyrics)` -- with a space -- and the name lies.** Reading it
needs no component; `foo_openlyrics` is what *writes* it. *Measured* over one
30,441-track library: **7,705 tracks (25.3%) carry the tag**, and of a random 150
of those, **51 (34%) hold LRC timestamps** and 97 are plain. So followable lyrics
are about **8.6% of the library** and "no lyrics at all" is the common case at
**74.7%** -- which is why the gatefold falls through to Details rather than
opening on an empty panel, and why the empty state names `foo_openlyrics`
instead of just saying no.

An earlier note here said synced was 48% of tagged. That was a 40-track sample;
150 says 34%.

`lyricsFormat.ts` is **named for the format rather than the feature, because
`Lyrics.tsx` sits beside it** -- on a case-insensitive filesystem TypeScript
resolves `'./Lyrics'` by probing `Lyrics.ts`, macOS answers yes to `lyrics.ts`,
and the component import lands silently on the parser. The compiler caught it;
nothing else would have. Same family as naming a store after the component next
to it.

What the parser has to survive, all of it seen in real files:

- **`\r\n` throughout**, and a lone `\r` from older taggers.
- **One line can carry several timestamps.** `[00:18.50][01:02.10]Give you all
  my time` is a refrain sung twice; reading only the first drops half the second
  chorus.
- **`[offset:...]` is milliseconds to *subtract***, which is the opposite sign to
  the one everybody assumes. Clamped at zero, or a line sorts before the track
  starts and can never become current.
- **A fraction is not always hundredths.** `[00:12.5]` is five tenths and
  `[00:12.500]` is five hundred milliseconds, so pad rather than divide by a
  guessed power of ten.
- **NetEase rips open with `作词 :` / `作曲 :` credit lines**, and some "lyrics"
  are a bare URL. Neither is cleaned up: tag hygiene is the library owner's
  business, and a normalisation layer would make Jean disagree with the player
  about what the library contains.

**Counting timestamps is not enough to call a lyric synced, and this is the one
rule here that took real data to find.** A large minority of tagged tracks are
NetEase rips of instrumentals whose entire lyric is two credit lines and
`纯音乐，请欣赏` -- three timestamps, all inside the first five seconds of a
four-minute track. Counted, that is a synced lyric; drawn, it is a karaoke view
that fires three times and then sits dead for the rest of the song. Worse, the
*same* boilerplate appears with one or two lines elsewhere in the library, so a
count threshold classified identical content two different ways.

So `SYNCED_MIN_SPAN` asks whether the timing is **followable** rather than what
the words say: twenty seconds, an order of magnitude above every boilerplate file
measured and far below any real lyric. Jean does not read tags to judge them --
this is a statement about the timestamps.

**The active line is state; the position is not.** The frame loop recomputes an
*index* and sets it only when it changes, a few times a minute. Re-rendering a
few hundred lines sixty times a second to move one highlight would be the most
expensive thing in the app.

**The empty state is a state, not an explanation.** It is met three times out of
four while listening, so it says "No lyrics found" and stops. Naming the tag and
the component that writes it is the right content for Settings and far too much
for something you meet constantly — the earlier version did, and it read as an
error report about an instrumental.

## Coming back to a panel

Switching tabs unmounts the panel -- the slide animation needs it, and React
would swap the component anyway -- so anything worth keeping has to be kept
deliberately. `usePanelScroll` remembers an offset per **panel and track**: a
new song's lyrics are not the old song's, scrolled down.

It is deliberately *not* `app/useScrollMemory`. That one owns the app's single
permanent scroll container and remembers a route; here the scroller is a
different element on each layout and, on a phone, is rebuilt on every tab
change. So this re-resolves the element rather than holding one.

**And it is switched off for a synced lyric**, which took a bug to notice.
Restoring an offset writes `scrollTop`, which fires the same `scroll` event a
finger does, which the follow reads as *the reader has taken over* -- measured,
the lyric then sat still for the rest of the song with the resume pill showing.
It is also the wrong thing to restore: the song has moved on, and the place to
be is wherever it is now. The follow already knows, so it does the placing.

**The first placement is a jump, not a journey**, and the active line is seeded
from the current position during render rather than starting at `-1`. Together
those are the whole of what "switching to Lyrics is janky" was: the panel
painted at the top of the lyric, then smooth-scrolled through a verse nobody was
reading to catch up. Placement is a `useLayoutEffect` for the same reason --
after paint, being instant only buys a frame showing the wrong place.

That is also why the parse happens in `NowPlaying` rather than in `Lyrics`: two
decisions outside the panel turn on whether the lyric is synced -- which tab
opens, and whether the panel restores its own scroll.

**Following is given up on a manual scroll and handed back by a pill**, never by
a timeout -- a timeout takes it back while somebody is still reading, which is
the whole complaint about every player that does this. A programmatic scroll
fires the same `scroll` event a finger does, so the guard is a flag the handler
checks; it is time-boxed because `scrollend` is not everywhere yet, the same
shape as `useLongPress` boxing its suppression.

**Lines still to come need a per-theme colour.** They have to stay legible --
reading ahead is half of why anyone opens this -- while losing clearly to the
current line. On dark `--muted` does both; on light it is a near-black that the
current line, also near-black, could not beat, so the two read as one weight and
the highlight vanished. Light pulls them back to `--faint`.

**There is no spacer after the last line, and there was.** A tall block used to
follow the lyric so the closing lines could still be scrolled up to the focus
point -- which is by definition most of a panel of nothing, and on a lyric short
enough to fit it was the *only* thing you could scroll to. The follow's
`scrollTo` is clamped by the browser anyway, so without it the final lines
simply settle lower than the focus point, which is what a page of text does.
What replaced it is `padding-bottom` on the list: breathing room above the edge,
and no dead scroll.

### Full screen

**`LyricsScreen` reuses `Lyrics` rather than drawing its own**, so the follow,
the resume pill, seek-on-click and the synced/plain/empty states cannot come to
mean two things. The only differences are `--lyric-size` -- read with a fallback
in `Lyrics.module.css`, because a custom property *declared* on the element
would beat anything an ancestor set -- and the space around it.

**It is a sibling of the now-playing screen, not a child**, and that is the one
structural decision here. As a child it sits inside the screen's own touch
handlers, so every flick in full screen would also step the tabs underneath;
stopping propagation on three handlers to undo that is a fix that holds until
someone adds a fourth.

**And it is `position: fixed`, the only layer in Jean that is.** Everything else
-- this screen, the queue panel -- is positioned in `.body`, which starts *below*
the top bar and beside the sidebar. A layer there covers the view and leaves the
search field, the settings gear and the theme switch on screen above it, and
"only the lyrics are visible" is then false. Nothing between it and the viewport
establishes a containing block, so fixed resolves against the viewport;
`z-index: 45` puts it over the app chrome, the queue panel (30) and this screen
(25), and deliberately *under* toasts (50) and menus (70) -- a write that failed
still has to be able to say so.

**The panel's own `Lyrics` is unmounted while it is up.** Two mounted at once is
two animation-frame loops recomputing the same active line, and the hidden one
still drives *its* scroller -- so the panel underneath would quietly scroll
itself for the whole song. Same rule as the screen unmounting rather than
hiding.

**The X is top-right, and the references say top-left.** Apple Music's
full-screen player and Spotify's lyric sheet both dismiss from the top-left
corner, and here that corner already holds this screen's chevron-down, one layer
down. Two dismissals stacked in one corner is a mis-tap by construction and it
makes the deeper one feel like the shallower one. Top-right is also what a modal
covering everything gets on the web. What *was* taken from the references is
that neither floats its control over the text: the X sits in a bar of its own
rather than on a scrim, because a gradient over the one thing this screen is for
is not a fix.

**Swiping it away needed nothing built.** `useSwipe`'s `onDown` already fires
only when the thing under the finger had nowhere further up to go -- halfway
down a lyric a downward flick scrolls, at the top it closes -- and it reads touch
events, so it still sees the gesture through a scroll the browser has claimed.
That is the whole of "without sacrificing scroll". Escape closes it too, on the
*capture* phase and stopped there, because the playlist scope binds Escape to
clearing a selection and the list is still mounted two layers down.

**It is offered on the Lyrics tab and only when there is a lyric**, and it sits
in the panel's own top-right corner rather than in the screen's header. It was
in the header first, on the argument that the header is the one place outside
the panel's edge fade -- a control inside `.panelBody` is drawn at 40% opacity
for the first 30px of scroll -- and that argument was answered rather than
right: the button is a child of the **tab strip**, absolutely positioned at
`top: 100%`, so it lands over the panel without being in it.

That placement buys three things the header did not. It is next to the thing it
acts on, so nothing has to explain which tab it belongs to. The header stays at
three controls on a phone rather than four. And `.tabs` is already
`position: sticky`, which the button inherits for free -- on the gatefold it
rides the strip and stays with the lyric instead of scrolling off the top of
it, with no second sticky rule to keep in step.

Out of flow, deliberately: on compact the four tabs are `space-around` across
the full width, and a real flex child here would push ARTIST off its own
spacing. It carries a surface and a border because lyrics scroll under it -- a
bare glyph over running text reads as a mark *in* the lyric rather than a
control on top of one, which is the same reason `.resume` is a pill.

Hidden rather than disabled when the tag is empty: a dimmed control on the three
quarters of a real library with no lyric is an affordance that never once works.

The current line sits **a third of the way down, not centred**: the line being
sung is the one you have already heard, and the useful half of the view is what
is coming.

## Details

**Detected per track, never per library.** A tag field answers `?` for the file
that lacks it, so which rows exist is a question about *this file*. *Measured*
across all 30,441 tracks: `%samplerate%` and `%channels%` 100%, `%date%` 99.7%,
`%totaldiscs%` 90.4%, `%codec_profile%` 82.6%, `%publisher%` 61.2%, `%composer%`
25.0%, `%replaygain_track_gain%` 4.1%, `%bpm%` 0.9%, `%bitspersample%` **0%**.
A fixed grid with those labels would be mostly empty cells on most tracks, and
empty cells read as Jean failing rather than as tags nobody wrote.

The root `CLAUDE.md` said `%composer%`, `%bpm%` and `%replaygain_*%` "do not
answer". They answer on a minority -- the same small-sample trap the ratings note
already confesses to.

**`%comment%` is deliberately excluded**: 19.9% coverage and most of what it
holds is ReplayGain hex written there by an old tagger. So are `%isrc%`,
`%barcode%`, `%catalognumber%`, `%label%`, `%media%`, `%mood%`, `%style%`,
`%key%`, `%language%` and the MusicBrainz ids -- *measured*, every one resolves
on exactly zero tracks.

**`%year%` is what is shown; `%date%` earns a row only when it says more.** It is
an ordinary messy user tag -- year-only on 26,891 tracks, a full ISO date on
3,022, untidy on 434 (`1997, 1997-02-10`, `2011-00`) -- so it is parsed leniently
or not at all. Rendering `2011-00` as a date would invent a month nobody tagged.

## Artist

**The only thing in Jean that leaves the network, and it is off until asked.**
Everything else comes from the player, which is the rule. A biography is the one
fact a local library genuinely does not hold -- but a music player on a LAN
telling a third party what its owner is listening to is not a default anybody
chose. Off, the tab says what it would do and where the switch is; a tab that is
simply empty reads as broken and one that quietly starts making outbound
requests is worse.

*Checked*, September 2026: MusicBrainz's `ws/2` and Wikipedia's REST summary both
answer `Access-Control-Allow-Origin: *` with no key and no proxy. **Deezer does
not**, which is why it is not here despite being the obvious source for artist
images.

Three things that cost time:

- **MusicBrainz links Wikidata, not Wikipedia.** Since 2015 that is the
  preference, and *measured*, Nirvana's entry has 28 relation types and no
  `wikipedia` among them. The direct link is tried first because older entries
  carry it and it saves a hop, but the Wikidata path is the one that runs.
- **The Wikidata REST path is `v1`.** The `v0` most examples still show is a 404.
- **A browser cannot send the `User-Agent` MusicBrainz asks for** -- it is a
  forbidden header name and `fetch` drops it silently. It works anyway:
  *measured*, a real Chrome UA answers 200 and only the bare token `Mozilla/5.0`
  is refused with 403, which is their bot filter rather than their policy. An
  ignored header in the code would only look like it had done something.

A match below a MusicBrainz score of 90 is discarded. A confident biography of
the wrong band is worse than none.

## Rating

The playing track **has no row anywhere**, so this cannot go through `rate()`
like a list row does -- there is nothing to patch optimistically. The
now-playing query is that row's stand-in and `setRating` patches it directly,
which keeps the fact in one store rather than adding a second overlay beside
`ratingStore` -- that one is keyed on the row arrays `playlistStore` publishes
and cannot see this one.

**Rating is silent.** `rateTrack` used to confirm every write in a toast, on the
argument that this path has no row to patch optimistically so nothing on screen
would show it -- which was true when the keyboard shortcut was its only caller
and false the moment this screen grew its own stars. Rating from here drew the
new stars *and* threw a toast over the transport, which is the app
congratulating itself for doing exactly what was asked. A rating is a small,
reversible, one-click act with a visible result; confirming it is the failure
mode toasts exist for. **A failure still speaks, and names the track**, because
that is the one outcome the stars cannot show and `0`-`5` can be pressed with
the track nowhere on screen.

The read-only rule is unchanged and asked per track: a raw value above 5 is on
somebody else's scale, and rescaling a `100` to five stars is a 4% rating drawn
as full marks with nothing on screen to say it happened.

## The artwork always fits

The Playing tab is the one panel that should never scroll, and two things make
that true. `.stage` is capped at `max-height: 100%`, so on a window narrower
than the panel is tall the square box goes short and wide instead of
overflowing. And **`Artwork` is called with no `size`** there: it writes
`width`/`height` inline when given one, which beat the class working the box
out and stretched a square cover into that oblong, cropping the middle of the
artwork out of it. The stylesheet sizes the cover from the *height* of whatever
box it is in, so it shrinks and stays square.

**The panel has no fade at all now, and getting there took two goes at one
argument.** The top stop went first: with nothing to scroll there is nothing
above for a fade to promise, and all it did was soften the cover's own rounded
corners against the tab strip -- which reads as the image being clipped. The
bottom stop was kept on the grounds that *that* edge does meet the title below
it, and softening it is the point.

That was wrong for the same reason the first one was. When the artwork is
height-constrained -- a tall phone, which is most of them -- the bottom of the
sleeve **is** the bottom 30px of the panel, so the fade was not softening a
boundary between two things, it was dissolving the last inch of the picture.
Reported as the cover being "slightly covered up", which is exactly what it
looks like. **A mask belongs to a scroller, and this is not one.**

The other half of the fix is that every number between the top of the viewport
and the cover gives some of itself back: the compact grid gap (14 → 10), the
identity's lead (18 → 12), the star size (26 → 22) and the panel's own padding
(12 → 8). About 26px, which is what the artwork was over by. Cheaper than
shrinking the cover, and nothing else notices.

## One play button

`PlayToggle` is the same component in the status bar and on the screen, at two
sizes -- not two buttons that look alike. The continuous motion is the whole
personality of the control, and a second copy of eight coprime keyframe
animations is the one that would drift. The alternating-motion clock lives in
the component for the same reason: two of them would each keep their own time.

**The size is a variant, not a number**, because the button also shrinks at the
720px breakpoint -- and anything spatial belongs to the media query rather than
to a prop a JS breakpoint would have to feed. `--play-size` drives everything,
including the icon, so the bigger one is genuinely the same button rather than a
differently balanced one; **CSS `width`/`height` on the `svg` beats the
attributes lucide writes**, which is what lets the glyph track the button
without a second number in JS.

The move left a `.toggle { width: 38px }` behind in `StatusBar.module.css`,
under its 720px query, pointing at a class that no longer exists. It is deleted.
That is the failure mode to watch for when a styled element moves modules: the
rule still parses, still looks deliberate, and does nothing at all.

## Sizing the stars

`Stars` reads `--star-size` through `--stars-size`, and the indirection is the
point: **a custom property declared on the element beats an inherited one**, so
`.stars { --star-size: 12px }` silently won over anything a container set. Twelve
pixels is right in a table cell drawn thirty thousand times and wrong here --
this is the one screen with room, and on a phone it is a thumb doing the aiming.
The compact size is **22px, down from 26**: still a target (22px of glyph plus
the 6px gap and the button's own padding clears 44px), and the four pixels come
off the only stack of margins between the tab strip and the bottom of the
cover.
