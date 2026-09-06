// foobar2000's query language, for the one query Jean composes.
//
// The component passes queries through untouched and says so: the player owns the language, and
// quoting is the caller's responsibility. That is not a formality -- a genre pasted in unquoted can
// produce a query that parses perfectly and matches something else, which no validation on either
// side can catch. `POST /autoplaylists/preview` is the check, and it is why the dialog shows the
// player's own match count before anything is created.

// foobar2000 reads a double-quoted string, and the escape inside one is a doubled quote. A tag can
// contain anything somebody typed, quotes included.
const quoted = (value: string) => `"${value.replace(/"/g, '""')}"`;

/**
 * Every track whose genre tag is exactly this.
 *
 * `IS` rather than `HAS`: `HAS` is a substring test, so `Rock` would collect `Punk Rock`,
 * `Rock En Español` and `Post Rock` as well -- a different set from the one the tile counted and the
 * view showed. Jean matches the tag whole everywhere else and this has to agree.
 */
export const genreQuery = (genre: string) => `%genre% IS ${quoted(genre)}`;
