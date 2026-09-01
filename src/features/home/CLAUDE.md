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

**Home opens with a claim, not a label.** The header leads with the library's total
*duration* -- "85 days 11 hr of music" -- because 30,441 is a number and 85 days is a
feeling, and a front door should be the second thing. "Your library" drops to the
eyebrow, alongside the years the collection spans, so orientation costs a line
nobody has to read. Under it a **rail** of counts -- tracks, albums, artists,
genres, playlists -- separated by hairlines rather than boxed into cards, because
they are one sentence about one library and a card apiece would make five unrelated
readings of it. Then the top genres as chips.

Reference pass: the dashboards this could have become (Dribbble's music dashboards,
every KPI grid) put each figure in its own shadowed card, which turns a music
player's front door into an analytics tool and fights the shelves below -- already a
grid of boxes. Spotify's library header is chrome and filter chips and its Wrapped
is gradient panels with enormous sans type; both rejected, the second emphatically.
Taken from Awwwards' stats elements: the hairline between figures, labels pinned in
one place relative to the number, tabular figures so the row shares a grid, and an
asymmetric composition. Taken from Letterboxd's all-time page -- the closest
analogue anywhere, a personal collection counted and characterised -- the move that
makes it a portrait rather than a readout: it *names* things as well as counting
them, which is what the genre chips are for.

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
earns it.** Somebody trying Jean against a folder of four songs is looking hardest
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
the sidebar two centimetres to its left. The rail becomes a three-column grid below
720px, because a wrapping flex row puts a hairline at the *start* of its second
line, separating a figure from the edge of the screen rather than from another
figure.

**The home screen is rows of shelves, and a shelf is a filter with a reason.** Most
played, Recently played, "You used to love this", "Worth a better copy", "You starred
these", "Never opened". Each carries a caption saying *why this record is here* --
"1,300 plays", "Not since 2016", "128 kbps" -- because that sentence is the whole
difference between a shelf and a query result.

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
