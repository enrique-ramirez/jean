# The home screen

The front door: what the library *is*, then shelves built out of the play counts, then the genres and the top tracks. Everything on it has to survive somebody else's library.

## The two verbs

**A shelf's heading opens it; its covers play it.** The heading is a link, hash routing, so it opens in a tab on a modified click, and the blurb beside it is deliberately not part of the target.

**Opening writes nothing and starts nothing.** The scratch playlist keeps whatever it was holding, which is the browsing-and-playing separation the whole design rests on. See `src/domain/library/CLAUDE.md`.

**Play and Shuffle mean here exactly what they mean in a playlist header**, and both then land you on the view of the set they started. Neither touches the shuffle mode the other way round; it is global player state.

**Shelf ids are the route and are not renamed with their titles.** A rename would break every link anyone has. Which shelf was last open is remembered, and **validated against what actually filled** rather than trusted: a library that has stopped qualifying for the stored shelf falls back to the first.

## Honesty rules

These are what stop the screen lying about a library it has never seen.

- **Thresholds are percentiles of this library, never constants.** A library whose busiest album has three plays still has a top quartile.
- **A percentile is not a promise that the title is true.** On a library played daily, the bottom quartile of recency is still recent, so "played to death, then forgotten" offers records from last month. **Where a shelf claims something about time it MUST carry an absolute floor as well.**
- **A shelf that cannot fill honestly does not render.** No ratings, no starred shelf. No playback statistics at all and "Never opened" is not "you never played these", it is *Jean cannot tell*, so it says nothing. If nothing qualifies, Home falls back to one row drawn at random: every install has a library, and an apology is not a home screen.
- **A figure at nothing is not drawn, and nouns are pluralised only when the count earns it.** **A figure the player cannot answer for is not drawn at all.** No genre tag means no genres figure, never "0 genres", since zero is a claim and this is an absence. The same goes for the named half of a card: an install with no play counts gets the count and no "most played", never a record picked arbitrarily and captioned as a favourite.
- **The counts are the user's music, not Jean's plumbing.** Jean's own playlists are filtered out, or the header disagrees with the sidebar beside it.
- **A shelf carries a caption saying *why this record is here***: the play count, the year, the bitrate.

`test/e2e/library-header.spec.ts` holds the shapes this has to survive, through the `libraryShape` fixture option documented in [test/README.md](../../../test/README.md).

## The genre bars

**A genre bar opens a genre route. It MUST NOT run a search.** `src/features/genres/CLAUDE.md` has why a genre can never be a search; run one from here and a genre name looks for tracks with those words in their titles and finds almost none.

**The bar's figure and the view behind it have to be the same set**, so the matcher and the counter are the same one. The e2e spec asserts the count against the grid's row count.

Two things about the form are forced by real data. Bars are **horizontal**: a vertical bar with the name in a pill on top breaks on any tag longer than a word. And they are scaled against the **largest genre rather than against the library**, since on a real collection the top genres are all a single-digit share of the whole and bars drawn as a share of it are identical slivers. The bar carries the relative size, the figure beside it the absolute one.

## Layout

**One shelf is free, the rest share a tab strip.** The strip is **the now-playing screen's tab control**, so the app has one rather than two that nearly match; the pill-shaped segmented control in `shared/ui` is for two or three options that are *settings*.

**The two halves of the closing band are counted against each other, not against the data.** The ranked track list and the genre bars have different row pitches, so the two counts are what make the columns end level. Each constant points at the other, since moving one alone reintroduces the ragged edge. The bar count is a *cap*: a library with four genres draws four.

**The ranked track list is how Jean shows anything that is not an album.** A numbered row needs no photograph, and Jean has no artist or track imagery beyond album art. Every row plays that track from the all-music view, so playback is never left at a dead end and nobody is left looking at the screen they pressed play on.

**A destination is an anchor; an action is a button.** A card that is nothing but a route is a link. A card that runs a *search* cannot be, since a search's query lives in memory rather than in the hash and an anchor there would promise a tab that opens on an empty field. Two consequences of that split are easy to hit: a `<button>` centres its text where an `<a>` does not, and `text-overflow` acts on a block's own text and not on an anonymous text node beside a flex sibling.

**The shelf scroller's stylesheet is shared with the free row's section**, since a hover rule reaches from the section into the scroller. **The tabbed variant's stylesheet MUST NOT re-declare a property the shared one also sets on a class they both use.** Two rules of equal specificity in different modules are decided by import order.
