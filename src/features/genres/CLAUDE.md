# Genres

The index of every genre in the library, and the dialog that turns one into an autoplaylist. How a single genre's *view* works — the matcher, the route, the query — is in `src/domain/library/CLAUDE.md`.

**A genre can never be a search.** beefweb's search index covers title, artist and album and **not genre**, so a genre is a filter over rows Jean already holds rather than something the player can be asked for.

**A chip's scope changes when you press it.** A genre chip in a view header is a percentage *of that view* and opens every track in the library with that tag; the destination's own eyebrow says `Genre` first, which is what keeps the jump legible on arrival. The "all genres" chip is drawn **only on the all-music view** — the one view whose genre count and the index behind it are the same set.

## The tile

**A genre has no artwork of its own and never will**, so `mark.ts` derives a figure and a tint from the name, seeded through `squash()`: the same genre spelled three ways is one identity, and the mark is stable on every device forever. **A fixed set of hues off a ramp, never a free hue per tag.**

**The figure is drawn *into* its field, not over it** — "away from the page" is a different direction in each theme. It is held at reduced opacity rather than given a third colour token, so one value covers both directions where a colour would need two.

**The sleeves are the genre's biggest albums, not a random draw**, and each leans off the same seed as the figure, so a genre with six albums does not deal a different five each visit. The tile carries extra bottom padding: **a leaning sleeve reaches past its own box** and the tile clips. `Artwork`'s disc glyph is hidden inside a sleeve.

**The counts' units live in a visually-hidden sibling**, or the pill announces two numbers about nothing.

## Finding one

**The search is the page**, and it uses `fuzzyScore` in `shared/lib/text.ts` rather than the token matcher. A genre is one short name typed from memory, so separators are **dropped rather than split on** and every spelling of a hyphenated genre is one key.

Tiers, ordered and not weighted: exact, prefix, word-start, substring, subsequence, then a bounded edit distance. Length only settles ties *inside* a tier, so a short name beats a long one that contains it. Two gates keep short queries from matching everything: subsequence and the typo budget each need a minimum query length. Covered by `test/unit/fuzzyMatch.test.ts`.

**The completion is stricter than the matcher.** A ghost sits *under* the real text, so it may only be offered where the best match starts with what was typed character for character.

**Space opens the focused tile and stops the event** — it is the player's play/pause everywhere else. **Left and right stop the event too** — those keys seek the player everywhere else on the page. Arrows walk the grid, **reading the column count off the laid-out grid**: it is `auto-fill` and nothing in JavaScript knows it until the browser has decided. **Typing any other character lands in the field**, which is what makes the page keyboard-first without autofocusing it — autofocus on a phone opens the keyboard over the thing you came to look at.

## Create autoplaylist

Only on a genre view, only where the component is reachable and says it can, and **absent rather than disabled** without it.

**Named plainly, with no `#Jean` prefix.** That namespace is Jean's own plumbing and is filtered out of the sidebar; a genre autoplaylist is the user's music. **No managed key either** — a key would make it Jean's to recognise and manage, and would 409 the second one somebody asked for.

**The player is asked what the query matches before anything is made.** Jean matches the tag whole in JavaScript; this is foobar2000 answering its own query against the Media Library, and the two can differ. An install with the Media Library disabled will have every autoplaylist come out empty whatever the query says, and the dialog has to say so rather than creating one. **The preview goes through react-query rather than an effect**: it runs on foobar2000's main thread, and a bare effect fires it twice per open under StrictMode and again on every reopen.
