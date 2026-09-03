# The home screen

## The two verbs

**A shelf's heading opens it; its covers play it.** Which is which has to be legible without trying either. The heading is a link — hash routing, so cmd-click opens it in a tab — carrying a chevron off the end of the words rather than a "Show all" parked at the right of the row. The blurb is not part of the target: it is a sentence about why these records qualified, and a sentence that navigates when you brush past it is a trap. **Opening writes nothing and starts nothing** — the scratch playlist keeps whatever it was holding, which is the browsing/playing separation the whole design rests on.

## Layout

**One shelf is free, the rest share a tab strip.** Recently played is a row of its own because it is the only shelf whose answer changes between one visit and the next; the rest sit behind titles in one strip with one row of covers under it. Six stacked rows is a long scroll on a desktop and a punishing one on a phone.

The strip is **Jean's own** — the now-playing panel's tabs, to the pixel — so the app has one tab control rather than two that nearly match. Rejected: the pill-shaped segmented control in `shared/ui`, which is for two or three options that are *settings*; five shelf titles in pills is a second navigation bar.

**The heading is "Explore", it is the link, and what it opens follows the tab.** A plain shelf row puts the chevron on its own title; here the titles are the switch, so the chevron rides the heading. **No blurbs in the strip** — a sentence of grey under a title that is already a whole phrase is explaining a joke. Recently played keeps its blurb, because "Where you have been lately" does work its title does not.

**Shelf ids are the `#/shelf/<id>` route and are not renamed with their titles.** A rename would break every link anyone has.

Which tab was last open is remembered in `jean.homeShelf`, and **validated against what actually filled** rather than trusted: a library that has stopped qualifying for the stored shelf falls back to the first.

## The header

**Home opens with a claim, then three doors.** The header leads with the library's total *duration* — 30,441 is a number and 85 days is a feeling. "Your library" drops to the eyebrow, alongside the years the collection spans.

Under it are **three cards, and each ends in something you can press**: `54 tracks / browse / All music`, `2,360 albums / most played / Infame`, `732 artists / most played / Babasónicos`. A count on its own is a readout; a count that ends in a record is a door. Genres live in the bar block at the foot of the page; there is no playlists figure, because the sidebar is two centimetres away and already lists them.

Reference pass: a hero with a row of stat cards, from Sonara's dashboard. **Not taken: what is inside those cards.** Each of Sonara's carries a percentage-change pill and a sparkline, and Jean can draw neither honestly. What replaces them is Last.fm's move, where the bottom half of each card is a named record rather than a trend.

**The two cards that name a record draw its sleeve; the one that names a destination does not.** A cover means the thing named is *in your library*, and "All music" is not. The artist's sleeve is their most played record — `artistsOf` keeps the busiest album as the artist's cover for exactly this, which is why it is generic in the album type: a `cover` typed as a bare `Album` loses the artwork url on the way through.

**A destination is an anchor; an action is a button.** The tracks card is nothing but a route, so it is a link. The other two run a *search*, and a search's query lives in memory rather than in the hash, so an anchor there would promise a tab that opens on an empty field. Two consequences of that split have already shipped as bugs: a `<button>` centres its text where an `<a>` does not, and `text-overflow` acts on a block's own text and not on an anonymous text node beside a flex sibling. The name lives in its own span, and the card sets `text-align: left`.

**A figure at nothing is not drawn, and nouns are pluralised only when the count earns it.** Four songs in a folder gets *1 album*, not *1 albums*. **A figure the player cannot answer for is not drawn at all** — no genre tag means no genres figure, never "0 genres", because zero is a claim and this is an absence. The named half of a card goes the same way: an install with no play counts gets the count and no "most played", never a record picked arbitrarily and captioned as a favourite.

**The counts are the user's music, not Jean's plumbing.** `#Jean Library` and the scratch are filtered out, or the header would disagree with the sidebar two centimetres to its left.

On a phone the tracks card goes, because the headline already says how big the library is — but only when there is another card to take its place, which is a `:not(:only-child)` rather than a branch in the component.

`test/e2e/library-header.spec.ts` holds the shapes this has to survive: four songs, one artist on repeat, six thousand tracks over three hundred artists, no year tags, no durations, no albums, no playlists, and one artist spelled two ways. The fixture option is `libraryShape`, and it states a shape rather than passing built tracks because **an option's top level does not survive the trip to the Playwright worker as an array** — it arrives as `{0: …, 1: …}` with no `.map`. Nested arrays are fine.

## Play and Shuffle

**Home's header ends in the same two buttons a playlist's does, meaning the same two things.** Play starts at the beginning, Shuffle starts anywhere and turns the mode on; both then land you on All music, because that is the view of the set they started and pressing play should not leave you looking at the screen you pressed it from. **Neither touches the mode the other way round** — it is global player state and the status bar owns it. There are two rather than one because a single button would have had to be Play doing a shuffle's job.

Filling the scratch and playing a position in it is `domain/library/usePlaySet.ts`, one implementation for the shelves, the front door and All music: a set filled in the wrong order plays the wrong track, and a player that refuses playlist writes has to degrade rather than do nothing.

## What cannot be drawn

**There is no play history.** The player answers `%lastfm_play_count%` (lifetime plays) and `%lastfm_last_played%` (only the most recent play). So:

- **No plays-per-day chart.** A track played today and again three weeks ago registers only as today, so every older day is systematically undercounted and the chart slopes upward whatever anybody did.
- **No "vs. last month" delta.** Same reason.
- What a window *can* honestly report is how many distinct tracks, albums or artists were touched since a date. If that is built it must be captioned as tracks, never as plays.

This keeps being proposed here. It cannot be built without another component.

## The genre bars

**A genre bar opens `#/genre/<tag>`. It must not run a search** — the search index covers title, artist and album and **not genre** (`domain/track/searchText.ts`), so "Indie Rock" would look for tracks with those words in their names and find almost none. The genre route is a filter over rows Jean already holds: no request, no playlist, and it works on a bare beefweb install, which is what "Home must never depend on `foo_jean`" requires.

**The bar's figure and the view behind it have to be the same set.** `refsOfGenre` matches the tag the way `summarise` counts it — whole, and through `tagKey` — so "Indie Rock, 2,667" opens 2,667 rows. The e2e spec asserts the count against the grid's `aria-rowcount`.

**The genre bars are the one chart this screen can draw**, because a distribution needs no history. Taken from GrooveGraph's Top Genres block, with two deviations forced by real data. Bars are **horizontal**, because a vertical bar with the name in a pill on top breaks on `Rock En Español` and `Video Game Music`, and a long tag gets a whole line. And they are scaled against the **largest genre rather than against the library**: at 30,441 tracks the top genre is 9% and the fourth is 6%, so bars drawn as a share of the whole are four identical slivers. The bar carries the relative size, the figure beside it the absolute one.

## The closing band

**The two halves are counted against each other, not against the data.** Ten ranked tracks and fourteen genre bars: a bar's pitch is about 28px against 43px for a track row, so those are the numbers that make the two columns end level. A column stopping halfway up its neighbour reads as a section that failed to fill. The bar count is a *cap* — a library with four genres draws four — and `TOP_TRACKS` and `GENRE_BARS` each point at the other, because moving one alone reintroduces the ragged edge.

**The ranked track list is how Jean shows anything that is not an album.** Ten rows in the space one row of sleeves takes, and — the reason it is a list at all — a numbered row needs no photograph. Jean has no artist or track imagery beyond album art and is not getting any; the obvious source for artist images is Deezer and it sends no CORS header. Every row opens All music and plays that track: do not leave somebody looking at the screen they pressed play on, and do not leave playback at a dead end.

**The band comes last, and that ordering is the argument.** What a library *is* is interesting; what is in it is what somebody came for. Anything actionable outranks anything merely true.

## The shelves

**A shelf is a filter with a reason.** Each carries a caption saying *why this record is here* — "1,300 plays", "Not since 2016", "128 kbps" — because that sentence is the whole difference between a shelf and a query result.

`ShelfScroller` is the covers, the arrows and the fades, and both the free row and the tabbed one render it: they differ in what sits above the artwork and in nothing below it. Its stylesheet stays `ShelfRow.module.css` because `.shelf:hover .arrow` reaches from the section into the scroller. **`ShelfTabs.module.css` never re-declares a property `ShelfRow.module.css` also sets on a class they share** — two rules of equal specificity in different modules are decided by import order.

**Not a carousel.** Cover Flow was removed from iTunes in 2015 because it is a beautiful thing that cannot browse: one album at a time across two thousand is a flick-fest. A shelf is small on purpose and the browsing lives in All music.

Three rules hold the shelves honest on somebody else's library:

- **Thresholds are percentiles of this library, never constants.** A library whose busiest album has three plays still has a top quartile.
- **A percentile is not a promise that the title is true.** On a library played daily, the bottom quartile of recency was still *last year*, so "played to death, then forgotten" was offering records from months ago. Where a shelf claims something about time it carries an absolute floor as well.
- **A shelf that cannot fill honestly does not render.** No ratings, no starred shelf. No playback statistics at all and "Never opened" is not "you never played these", it is *Jean cannot tell* — so it says nothing. If nothing qualifies, Home falls back to **one row drawn at random**, because every install has a library and an apology is not a home screen.
