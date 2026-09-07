# Search

The library-wide search control. How its results become playable is in `src/domain/library/CLAUDE.md`; find-in-list is a different feature and lives in `src/domain/track/`.

**Search is a persistent, always-visible control** that is *also* bound to `Mod+K`. It cannot be a keyboard shortcut with an icon added later: mobile has no keyboard, and an invisible affordance means the feature does not exist there. On mobile it belongs within thumb reach.

## The dropdown

**Two queries, and only one of them is the search.** `draft` is what is being typed and reaches no further than the field and its dropdown; `query` is the search the app is showing, and it moves only on a commitment. Everything in `useLibrarySearch` is one or the other, and nothing outside the field may read `draft`. Typing therefore disturbs nothing -- not the route, not the page, not the sidebar, not the scratch playlist -- which is what makes a half-typed word safe over a search somebody is using.

**Jean is asking the question, and the user answers by picking.** The query is not the answer; it is Jean guessing at what would help. So what the user picks decides where they go, and the query itself is only promoted when picking it made the query real:

| Picked | Lands | Promotes the draft |
|---|---|---|
| Album, artist, genre | that place | no -- the query was a means, and the place existed already |
| Track | nowhere; it plays where you stand | yes |
| Nothing (Enter) | the results page | yes |

**A track pick promotes the draft as a consequence rather than as a rule.** beefweb plays from playlists and nothing else, so hearing one result means materialising all of them -- and once a set exists under the query's name, the search *is* real. That is also why it does not navigate: the set exists, so the status bar's "playing from" line and the sidebar row already say where the sound came from, and moving the user on top of that buys nothing.

**Do not reach for the play queue to avoid materialising.** `src/shared/api/README.md` has why there is no cheap "play next" there; faking one here means removing and re-appending the user's queue tail, a side effect on their data to save a playlist write.

**Escape backs out one rung per press and never reaches the search**: the panel, then the edit, then the caret. Ending a search is the clear button's job alone. The rungs are indistinguishable on screen -- an unedited draft looks exactly like a reverted one -- so an Escape that cleared would destroy a search on what felt like the first press.

**The draft is given back on a press outside, not on blur.** A click on a result blurs the field on its way to the button, so a revert hung off blur empties the draft before the click that meant to commit it arrives. `useDismissable` watches pointer-down and the panel is inside the element it guards, so only a press genuinely outside either reverts.

**Space is a character**, never a second Enter: bound to activation it breaks every query with a space in it the moment somebody arrows down mid-thought.

## Sections

**A section appears because the query plausibly *is* one of those things, not because something in it matched.** `rankEntities`'s comment in `domain/track/rankEntities.ts` has the floor this rests on and why a sort alone cannot stand in for it. One function ranks all three, since an artist, a record and a genre are the same question asked of different names.

**Entities take the full ladder in `shared/lib/text.ts`; tracks do not** -- the same comment has why.

**Four sections, in this order: artists, albums, genre, tracks.** Two artists, three records, one genre -- six entity rows at the very most, so the tracks still begin inside the first screenful. Each heading carries how many the query named, which is where the ones left out went.

**An album is a row and never a strip of cover art.** A horizontal shelf needs left and right keys and breaks the one up-and-down axis that makes the panel navigable; what tells two records apart is textual, since *Blood, Sweat & Tears* the album and *New Blood* are by the same band; and a cover shelf inside a search dropdown is the most Spotify-shaped thing available.

**A genre is one row, name and count, deliberately unobtrusive** -- and it keeps the artwork slot it has nothing to fill, or its name starts to the left of every other row's.

**An artist row is round and a track row is square** -- the comment on `.face` in `SearchDropdown.module.css` has why. An album row is square like a track's; what separates them is the heading and the second line.

**Picking an album opens it.** An album is a place: `album/<artist>/<title>`, both halves normalised, drawn as a list view. It takes two tags to name one, since one title can belong to two bands.

**One flat list drives the keyboard** -- the comment on `suggestions` in `useLibrarySearch.ts` has why.

**The cursor starts on a row only when the query has one reading** -- the comment on `preselect` in `useLibrarySearch.ts` has why. Every kind counts on both sides of that: a record named exactly the query blocks an artist's guess as surely as a track does.

**The preview is ranked and the results page is not, deliberately.** Ranking eight of two hundred is the whole job; a page you can scroll and sort already answers "what matched" without an opinion, and giving it one would mean two orders for one query.

**Which field matched outranks how well it matched.** Searching `blood` otherwise fills the preview with 10cc, whose *Bloody Tourists* carries its whole track list in on an album tag. The weights in `domain/track/rankTracks.ts` are large enough to move an album-only hit a rung down the ladder, and small enough that an exact album title still beats a passing mention in a song. Typo tolerance is absent there on purpose: everything offered for ranking already holds the token as a substring. Entities will not, and want the full ladder in `shared/lib/text.ts`.

**A preview row carries the album as well as the artist**, where a track list carries the artist alone. The question a result has to answer here is why it is in the list at all, and a query often matched the album rather than anything visible on the row.

**A phone has nothing outside the panel to press**, since it covers everything below the top bar. Dismissing there is the swipe, the clear button or committing, and taking any of those away leaves the panel with no exit.

**Search results shuffle, since playing them makes them a real playlist.** Playback order draws from the active playlist, so shuffling results that were never materialised starts inside them and then wanders the whole library. Materialising on play fixes the cause rather than the symptom.

**Without `permissions.changePlaylists` there is no playlist to make**, so the Shuffle button is not drawn.
