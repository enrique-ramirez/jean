import { quoted } from "./queryCompletion";

// A field named bare, without `%`, is matched against each of a multi-valued tag's values. `IS`
// matches a whole value; `HAS` is a substring test, so `Rock` would also collect `Punk Rock`.
export const genreQuery = (genre: string) => `genre IS ${quoted(genre)}`;
