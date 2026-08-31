// Diacritic-insensitive matching, for anything the user types at a list.
//
// `babasonicos` has to find `Babasónicos`. Requiring people to type the accents
// in their own library is a tax on exactly the tracks they are most likely to
// be looking for, and from the outside it does not look like a strict search --
// it looks like the search is broken.
//
// NFD splits a letter into its base plus its combining marks; dropping the
// marks leaves the base. Measured over a 30,441-row library: folding the whole
// index costs ~6 ms against the ~0.6 ms a plain lowercase took. That is paid
// once, when the index is built, and never per keystroke -- the haystacks and
// the query both come through here, so a search is still a plain includes().
//
// Defined here, once, because two searches use it: the library index in
// playlist/searchText.js and the filter inside ActionMenu. Two copies of a
// matching rule is two behaviours waiting to drift apart.
const COMBINING_MARKS = /\p{Diacritic}/gu

export const fold = (text) => text.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '')
