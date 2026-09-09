# Artists

Who an artist is -- in `domain/track/artists.ts`, since the search index needs it too -- and the page that stands for one. How a set becomes playable is in `src/domain/library/CLAUDE.md`; the search dropdown that will point here is in `src/features/search/CLAUDE.md`.

## Neither tag is the artist

**The index is the union of `%album artist%` and `%artist%`.** The comment on `artistsOf` in `domain/track/artists.ts` has why neither is enough alone and why a name credited in both is counted once. `artists.test.ts` asserts that count for every artist it builds.

**`feat.`, `ft.` and `featuring` are the only safe separators, and the list is closed** -- the comment beside `FEATURING` in `domain/track/fields.ts` has the names that rule out a looser one.

**A comma is ambiguous and the string alone cannot settle it**, which is why `collapseRepeatedTag` in `domain/track/fields.ts` collapses only where every part is the same name. Its comment carries the rule and why the player is not asked to settle the rest.

**`Various Artists` is not an artist** -- see `NOT_AN_ARTIST` in `domain/track/artists.ts`.

**The index is extended as the library arrives, never cached on the library key alone.** That key carries the total the *player* reported, so it does not change while rows are still streaming in: cached on it, the index answers from whatever the first chunk held for the rest of the session, and an artist further down the library is simply absent. `artistIndex` in `domain/track/artists.ts` is where that is handled, and there is a test for it.

## Reaching one

**A track list gives its rows no artist link** -- the comment beside `credit` in `trackActions.ts` has why. A virtualised list would carry one per row regardless. The track menu's *Go to artist* is how a row reaches an artist instead, which also covers the status bar -- its title and artist sit inside a single button and cannot hold a link at all.

**Where a name is drawn as plain text with nothing competing for the press, it links**: the album group's header and the details panel. `ArtistLinks`'s own comment in `domain/track/ArtistLinks.tsx` has why the tag's own text survives exactly, separators included.

## The page

**It is a portrait of your collection of an artist, not a portrait of the artist.** Every streaming client leads with a photograph, monthly listeners and who else to listen to. Jean has none of that and must not fake it -- what it has instead is what you own, what you have worn out and what you have never played, which is the one thing they structurally cannot show. That is why *Your history* is a section rather than a footnote.

**There is no artist image anywhere, and the reason is not laziness** -- see `src/features/now-playing/CLAUDE.md` for why.

**So the name is the hero, and covers are the aside.** It is `ViewHeader`, the same header every other view draws, which is what makes the fallback free: with no albums the aside simply does not render and the name carries the page alone.

**The discography is newest first, by each album's earliest year** -- the comment on `absorb()` in `domain/track/albums.ts` has why earliest.

**Guest spots are a separate section, never mixed into the records.** That separation is the whole reason the credit line is split at all. It is how they are *drawn*, not two sets: `refsOfArtist` hands back `all` as well, and everything that plays an artist plays that, so the overview and the track list cannot mean different things by the same name.

## Two views, one artist

**The tabs are a route, `artist/<name>/tracks`, not a toggle.** A track list with its own sorting, selection and finder is a place: it survives a reload, and Back means something. The overview is the bare route.

**The tracks tab is `LibraryListView`, unchanged.** Everything a playlist has -- the finder, the layout switch, the columns, the heat -- arrives by using the same component rather than by rebuilding a list scoped to one artist.

**Both views draw one `ViewHeader`, and the tabs are a slot in it.** That is what keeps the name, the stats and the actions from moving as you switch.

**Choosing a record on the overview opens the tracks and scrolls to it.** It does not play: the discography is for finding your way to a record, and a click that started the music would leave nowhere to go but back. `revealTrack.ts` carries the ask, and it carries a **ref rather than a position** -- the list that answers is not the one that asked.

**One key rather than an initial each.** `T` for Tracks is the theme toggle, and a scoped binding quietly shadowing a global one is worse than a key that is not a first letter. The strip underlines a letter only when the key really is the label's initial.

**The MusicBrainz panel is the same component the now-playing screen draws** -- its comment has why the subject is a parameter rather than the playing track.
