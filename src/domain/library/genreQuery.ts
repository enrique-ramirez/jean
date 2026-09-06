// foobar2000 reads a double-quoted string, and the escape inside one is a doubled quote.
const quoted = (value: string) => `"${value.replace(/"/g, '""')}"`;

// `IS` matches the whole tag; `HAS` is a substring test, so `Rock` would also collect `Punk Rock`.
export const genreQuery = (genre: string) => `%genre% IS ${quoted(genre)}`;
