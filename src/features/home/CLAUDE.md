# The home screen

Why Home looks the way it does. General rules are in the root `CLAUDE.md`.

**A shelf's heading opens it; its covers play it.** Two verbs on one row, and which
is which has to be legible without trying either. The heading is a link -- hash
routing, so cmd-click opens it in a tab -- carrying a chevron off the end of the
words rather than a "Show all" parked at the right of the row. That shape is Apple
Music's and Disney+'s; the right-aligned one is Spotify's, and it would also be
promising "all of them" when the route opens the same albums already on screen, as
tracks. The blurb is not part of the target: it is a sentence about why these
records qualified, and a sentence that navigates when you brush past it is a trap.
Opening writes nothing and starts nothing -- the scratch playlist keeps whatever it
was holding, which is the browsing/playing separation the whole design rests on.

**One shelf is free, the rest share a tab strip.** Recently played is a row of its
own because it is the only shelf whose answer changes between one visit and the
next; Most played, "You used to love this", "Worth a better copy", "You starred
these" and "Never opened" sit behind titles in one strip with one row of covers
under it. Six stacked rows was a long scroll on a desktop and a punishing one on a
phone.

Taken from Ultra Sound's *Explore* panel: a section heading with a strip of tabs
under it and one carousel below. The strip itself is **Jean's own** -- the
now-playing panel's Lyrics/Details/Artist tabs, to the pixel -- so the app has one
tab control rather than two that nearly match. Rejected the pill-shaped segmented
control in `shared/ui`: that is for two or three options that are *settings*, and
five shelf titles in pills is a second navigation bar. Rejected collapsing Recently
played in with the others, which would put the whole library behind a control you
have to notice first.

**The heading is "Explore", it is the link, and what it opens follows the tab.**
The plain row beside it puts the chevron on its own title; here the titles are the
switch, so the chevron rides the heading. That keeps the rule -- a shelf's heading
opens it -- with no "Show all" parked at the right of the strip, which is the shape
this project has the most to lose by copying. An earlier version made the *active
tab* the heading and the link, so pressing the tab you were already on opened it;
the chevron was the only thing saying so, and it was too clever.

**No blurbs in the strip.** A sentence of grey under a title that is already a
whole phrase -- "Remember these?", "Time for an upgrade" -- is explaining a joke.
Recently played keeps its blurb, because "Where you have been lately" is doing work
its title does not.

**The titles are written to be worth pressing, and the ids are not renamed with
them.** "Never opened" was a fact about a file and "Never listened" is a fact about
you; "You used to love this" became "Remember these?", "Worth a better copy" became
"Time for an upgrade", "You starred these" became "Your favourites" and moved to
second, because after "most played" the next thing anybody wants is the one they
marked themselves. The ids stay: they are the `#/shelf/<id>` route, and a rename
would break every link anyone has.

Which tab was last open is remembered in `jean.homeShelf`, and validated against
what actually filled rather than trusted -- a library that has stopped qualifying
for the stored shelf falls back to the first.

**Home opens with a claim, then three doors.** The header leads with the library's
total *duration* -- "85 days 11 hr of music" -- because 30,441 is a number and 85
days is a feeling, and a front door should be the second thing. "Your library"
drops to the eyebrow, alongside the years the collection spans.

Under it were five figures separated by hairlines -- tracks, albums, artists,
genres, playlists. They are now **three cards, and each one ends in something you
can press**: `54 tracks / browse / All music`, `2,360 albums / most played /
Infame`, `732 artists / most played / Babasónicos`. A count on its own is a
readout; a count that ends in a record is a door. Genres left the header for the
bar block at the foot of the page, and the playlists figure left entirely -- the
sidebar is two centimetres away and already lists them.

Reference pass. Taken from Sonara's dashboard: a hero with a row of stat cards
under it, which is the shape this screen was asked for. **Not taken: everything
inside those cards.** Each of Sonara's carries a `+23.5%` pill and a sparkline, and
Jean can draw neither honestly -- see the measurement below. What replaces them is
the move underneath Last.fm's three-card set, where the bottom half of each card is
a named record rather than a trend. Rejected: MusicFlow's KPI grid with a
growth-rate tile, which is roughly what this header already was; Melodify's
circular artist rail, because with no artist photographs it is a row of album
covers cropped into circles; Spotify's library header, and Wrapped's gradient
panels, on the standing rule.

**Measured, and it constrains every "listening" feature anyone proposes here:
there is no play history.** The player answers `%lastfm_play_count%` -- lifetime
plays -- and `%lastfm_last_played%`, which is *only the most recent* play. So:

- **No plays-per-day chart.** A track played today and again three weeks ago
  registers only as today, so every older day is systematically undercounted and
  the chart slopes upward whatever anybody actually did.
- **No "vs. last month" delta.** Same reason -- the earlier window is always
  undercounted relative to the current one.
- What a window *can* honestly report is how many distinct tracks, albums or
  artists were touched since a date. If that is ever built it must be captioned
  as tracks, never as plays.

**A genre bar opens `#/genre/<tag>`, and it used to run a search, which was
quietly broken.** The search index covers title, artist and album and **not
genre** (`domain/track/searchText.ts`), so clicking "Indie Rock" looked for tracks
with those words in their names and found almost none of them -- a control that
appeared to work and did the wrong thing. The genre route is a filter over rows
Jean already holds: no request, no playlist, and it works on a bare beefweb
install, which is what "Home must never depend on `foo_jean`" requires. Folders,
when they land, are an *extra* action on the same bar rather than the only way in.

**The bar's figure and the view behind it have to be the same set.** `refsOfGenre`
matches the tag the way `summarise` counts it -- whole, and through `tagKey` -- so
"Indie Rock, 2,667" opens 2,667 rows. Two different ideas of what a genre is would
make the number on the front door a lie, and the e2e spec asserts the count against
the grid's `aria-rowcount` for that reason.

**The genre bars are the one chart this screen can draw**, because a distribution
needs no history. Taken from GrooveGraph's Top Genres block, with two deviations
forced by real data. Its bars are vertical with the name in a pill on top, which
breaks on `Rock En Español` and `Video Game Music` -- horizontal bars give a long
tag a whole line and read the same on a phone. And they are scaled against the
**largest genre rather than against the library**: *measured* on 30,441 tracks the
top genre is 9% and the fourth is 6%, so bars drawn as a share of the whole are
four identical slivers. The bar carries the relative size, the figure beside it the
absolute one.

**The two halves of the closing band are counted against each other, not against
the data.** Ten ranked tracks and fourteen genre bars: a bar's pitch is about 28px
against 43px for a track row, so those are the numbers that make the two columns
end level. A column stopping halfway up its neighbour reads as a section that
failed to fill rather than as one that ended. The bar count is a *cap* -- a library
with four genres draws four -- and `TOP_TRACKS` and `GENRE_BARS` each point at the
other, because moving one alone reintroduces exactly the ragged edge they were set
to remove.

**The ranked track list is how Jean shows anything that is not an album.** Ten rows
in the space one row of sleeves takes, and -- the reason it is a list at all -- a
numbered row needs no photograph. Jean has no artist or track imagery beyond album
art and is not getting any; the obvious source for artist images is Deezer and it
sends no CORS header. Taken whole from GrooveGraph's Top Tracks column. Every row
opens All music and plays that track, which is the front door's own Play rule: do
not leave somebody looking at the screen they pressed play on, and do not leave
playback at a dead end.

**The two cards that name a record draw its sleeve; the one that names a
destination does not.** That difference is the point rather than an inconsistency
to reconcile: a cover means the thing named is *in your library*, and "All music"
is not. The artist's sleeve is their most played record -- `artistsOf` keeps the
busiest album as the artist's cover for exactly this, which is also why it is
generic in the album type: a `cover` typed as a bare `Album` loses the artwork url
on the way through.

**A destination is an anchor; an action is a button.** The tracks card is nothing
but a route, so it is a link and cmd-click opens it in a tab. The other two run a
*search*, and a search's query lives in memory rather than in the hash --
`#/search` carries the route and not what was typed -- so an anchor there would
promise a tab that opens on an empty field. Two consequences of that split had
already shipped as bugs: a `<button>` centres its text where an `<a>` does not, so
the albums and artists cards were centred and the tracks card was not; and
`text-overflow` acts on a block's own text and not on an anonymous text node beside
a flex sibling, so "Chrono Cross Original Soundtrack" was cut mid-word with no
ellipsis. The name lives in its own span now, and the card sets `text-align: left`.

**The band at the foot comes last, and that ordering is the argument.** What a
library *is* is interesting; what is in it is what somebody came for. Anything
actionable outranks anything merely true.

**Home's header ends in the same two buttons a playlist's does, meaning the same
two things.** Play starts at the beginning, Shuffle starts anywhere and turns the
mode on; both then land you on All Music, because that is the view of the set they
just started and pressing play should not leave you looking at the screen you
pressed it from. Neither touches the mode the other way round -- it is global
player state, the status bar owns it, and a Play that quietly switched shuffle off
would be reaching across the app to do it. There are two rather than one because a
single button would have had to be Play doing a shuffle's job, which contradicts
the header two clicks away; **Shuffle is the one worth pressing on thirty thousand
tracks, and Play is the one that has to exist for Shuffle to be honest.** They sit
across the gap on the right, which is the room a header with no mosaic has spare,
and on a phone they drop to the two edges at their own size -- stretched to half a
screen each they read as a dialog asking a question.

Filling the scratch and playing a position in it is `domain/library/usePlaySet.ts`, one
implementation for the shelves, the front door and All Music: a set filled in the
wrong order plays the wrong track and a player that refuses playlist writes has to
degrade rather than do nothing, and neither is worth getting right twice.

**A figure at nothing is not drawn, and nouns are pluralised only when the count
earns it.** The named half of a card goes the same way: an install the player keeps
no play counts for gets the count and no "most played", never a record picked
arbitrarily and captioned as a favourite.

On a phone the tracks card goes too, because the headline already says how big the
library is -- but only when there is another card to take its place, which is a
`:not(:only-child)` rather than a branch in the component. A library with no album
or artist tags has that one card and nothing else.

The rest of this rule is unchanged from when the figures were a rail: Somebody trying Jean against a folder of four songs is looking hardest
at this screen, and "1 albums" tells them it was written for another library. The
same goes for a rail of noughts on a fresh install: zero genres is not a library
without genres, it is Jean unable to tell, and either way an absence dressed as a
fact. `test/e2e/library-header.spec.ts` holds the shapes -- four songs, one artist
on repeat, six thousand tracks over three hundred artists, no year tags, no
durations, no albums, no playlists, and one artist spelled two ways. The fixture
option is `libraryShape`, and it states a shape rather than passing built tracks
because **an option's top level does not survive the trip to the Playwright worker
as an array** -- it arrives as `{0: …, 1: …}` with no `.map` on it. Nested arrays
are fine, which is why `omit: ['%year%']` inside the object works.

Two rules it inherits. **A figure the player cannot answer for is not drawn** --
no genre tag means no genres figure, never "0 genres", because zero is a claim and
this is an absence. And **the counts are the user's music, not Jean's plumbing**:
`#Jean Library` and the scratch are filtered out, or the header would disagree with
the sidebar two centimetres to its left. The five-figure rail this replaced scrolled sideways below 720px and was cut off
mid-figure at the edge of the glass; a number sliced in half by a hairline reads as
broken rather than as continuing, which is most of why the cards are two-up and
fixed instead.

**The home screen is shelves, and a shelf is a filter with a reason.** Most played,
Recently played, "You used to love this", "Worth a better copy", "You starred
these", "Never opened" -- one drawn as its own row and the rest behind the tab
strip above. Each carries a caption saying *why this record is here* -- "1,300
plays", "Not since 2016", "128 kbps" -- because that sentence is the whole
difference between a shelf and a query result.

`ShelfScroller` is the covers, the arrows and the fades, and both the free row and
the tabbed one render it: they differ in what sits above the artwork and in nothing
below it, and a second copy of the arrow measuring is a second place for it to go
wrong. Its stylesheet stays `ShelfRow.module.css` because `.shelf:hover .arrow`
reaches from the section into the scroller. **`ShelfTabs.module.css` never
re-declares a property `ShelfRow.module.css` also sets on a class they share** --
two rules of equal specificity in different modules are decided by import order,
and sorting imports has already silently broken a stylesheet in this project once.

Not a carousel. Cover Flow was removed from iTunes in 2015 because it is a beautiful
thing that cannot browse: one album at a time across two thousand is a flick-fest. A
shelf is small on purpose and the browsing lives in All music.

Three rules hold the shelves honest on somebody else's library:

- **Thresholds are percentiles of this library, never constants.** A library whose
  busiest album has three plays still has a top quartile.
- **A percentile is not a promise that the title is true.** *Measured* on a library
  played daily, the bottom quartile of recency was still *last year* -- so "played to
  death, then forgotten" was offering records from months ago. Where a shelf claims
  something about time it carries an absolute floor as well.
- **A shelf that cannot fill honestly does not render**, and a claim needs the data
  behind it. No ratings, no starred shelf. No playback statistics at all and "Never
  opened" is not "you never played these", it is *Jean cannot tell* -- so it says
  nothing. If nothing at all qualifies, Home falls back to **one row drawn at random**,
  because every install has a library and an apology is not a home screen.
