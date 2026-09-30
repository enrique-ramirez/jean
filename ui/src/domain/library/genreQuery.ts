// foobar2000 reads a double-quoted string, and the escape inside one is a doubled quote.
const quoted = (value: string) => `"${value.replace(/"/g, '""')}"`;

// A field named bare, without `%`, is matched against each of a multi-valued tag's values. `IS`
// matches a whole value; `HAS` is a substring test, so `Rock` would also collect `Punk Rock`.
export const genreQuery = (genre: string) => `genre IS ${quoted(genre)}`;
