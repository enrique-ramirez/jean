# Genres

The index of every genre, at `#/genres`. How a single genre's *view* works is in
`src/domain/library/CLAUDE.md`; this is the screen you find one on.

## Why it exists

`beefweb`'s search index covers title, artist and album and **not genre**, so genre can never be a
search — it is a filter over rows Jean already holds. Before this screen the only doors to
`#/genre/<tag>` were the fourteen bars on Home, and a real library has **141**. The other hundred and
twenty-seven were unreachable without hand-editing the hash.

Four ways in now, and they are different questions: the sidebar row (*take me there*), Home's
`Genres ›` heading and its fourth card (*while I am here*), the linked chips in any view header
(*more like this*), and the `‹ All genres` crumb on a genre view (*back*).

**A chip's scope changes when you press it.** On a playlist header `Indie Rock 34%` is 34% *of that
playlist* and opens all 2,667 in the library. The destination's own eyebrow says `Genre` first, which
is what keeps the jump legible on arrival. The `All genres` chip is drawn **only on All music**,
because that is the one view whose genre count and the index behind it are the same set.

## The tile

**Three things carry meaning and the background carries none**: the name, the sleeves, then the
counts. Rejected on the way here: a wall of cover quilts (four crops of a sleeve is texture, not
artwork — the names became unreadable and every tile was the same beige), weighted tag clouds
(font-size-as-data makes small genres unclickable), a per-genre icon set (hundreds of drawings for
tags Jean cannot predict), and pills (nothing to aim at past about twenty).

**A genre has no artwork of its own and never will**, so `mark.ts` derives a figure and a tint from
the name — seeded through `squash()`, so `Heavy Metal`, `heavy-metal` and `heavymetal` are one
identity, and stable on every device forever. **Eight hues off a ramp, never a free hue per tag**: a
hash straight onto the wheel puts 141 unrelated colours on one screen and reads as a fault.

**The figure is drawn *into* its field, not over it** — `--genre-ink-ground` is the sunken neutral on
dark and white on light, because "away from the page" is a different direction in each theme, and
getting that wrong on light was the one thing that looked broken. It is held at half opacity rather
than given a third colour token, for the same reason: opacity fades toward whatever is behind it, so
one value covers both directions where a colour would need two.

**Five sleeves, fanned, the genre's biggest albums.** Not random: a genre with six albums should not
deal a different five each visit. Each leans off the same seed as the figure — a fan that reshuffles
on a re-render reads as a glitch. The tile carries extra bottom padding because **a leaning sleeve
reaches past its own box** and the tile clips. `Artwork`'s disc glyph is hidden inside a sleeve: right
for one cover, and five identical icons in a row is not a loading state.

**The counts are a pill, top right, opposite the name.** Icons rather than words, because at two
columns the words all but span the tile — `DiscAlbum` and `Music2`, the same glyphs the app uses
elsewhere. `DiscAlbum` is *also* what `Artwork` draws for "there is no cover here", and this screen
can show both at once; a glyph invented to dodge that would be vocabulary the design system does not
have. **The units live in a `.visually-hidden` sibling**, or the pill announces `235 · 2,667` — two
numbers about nothing.

## Finding one

**The search is the page.** `fuzzyScore` in `shared/lib/text.ts` — not `tokenize`, which is right for
tracks where a query is half a title and half an artist. A genre is one short name typed from memory,
so separators are **dropped rather than split on** and `hip-hop`, `hip hop` and `hiphop` are one key.

Tiers, ordered and not weighted: exact, prefix, word-start, substring, subsequence, then a bounded
edit distance. Length only settles ties *inside* a tier, so `Rock` beats `Rock En Español` for `rock`.
Two gates keep short queries from matching everything: subsequence needs three characters and the
typo budget needs five. Unit tests in `test/unit/fuzzyMatch.test.ts`.

**The completion is stricter than the matcher.** A ghost sits *under* the real text, so it is offered
only where the best match starts with what was typed character for character — `heavymetal` still
finds `Heavy Metal` and completes to nothing.

**Keys.** `/` focuses the field and `S` switches the order, both declared in `keymap.ts` under
`SCOPE.genres` so they appear in the shortcuts sheet. Arrows walk the grid, reading the column count
off the laid-out grid because it is `auto-fill` and nothing in JavaScript knows it until the browser
has decided. **Space opens the focused tile and stops the event** — it is the player's play/pause
everywhere else, and a tile that opened a genre *and* paused the music would be doing two things with
one key. Typing any other character lands in the field, which is what makes the page keyboard-first
without autofocusing it: autofocus on a phone opens the keyboard over the thing you came to look at.

## Create autoplaylist

Only on a genre view, only with `foo_jean` reachable and `canCreateAutoPlaylists`, and **absent
rather than disabled** without it.

**Named plainly, with no `#Jean` prefix.** That namespace is Jean's own plumbing and is filtered out
of the sidebar; a genre autoplaylist is the user's music. **No `managed.key` either** — a key would
make it Jean's to recognise and manage, and would `409` the second one somebody asked for.

**The player is asked what the query matches before anything is made.** Jean matches the tag whole in
JavaScript; this is foobar2000 answering its own query against the Media Library, and the two can
differ. `libraryEnabled: false` means every autoplaylist on that install is empty whatever the query
says, and the dialog says so rather than creating one. The preview goes through react-query rather
than an effect: it runs on **foobar2000's main thread**, and a bare effect fires it twice per open
under StrictMode and again on every reopen.

`genreQuery` uses `IS`, never `HAS` — `HAS` is a substring test, so `Rock` would collect `Punk Rock`
and `Post Rock` too, a different set from the one the tile counted.
