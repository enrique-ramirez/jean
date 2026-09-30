const SEPARATOR_CODE = 31;
const SEPARATOR = String.fromCharCode(SEPARATOR_CODE);

// foobar2000's `%genre%` joins a multi-valued tag with ", ", which a single value may hold as well.
// `$meta_sep` joins with a separator of Jean's choosing instead, and answers false for a track without
// the tag, where `$if2` falls back to `%genre%` so the field still answers `?`.
export const GENRE_EXPRESSION = `$if2($meta_sep(genre,$char(${SEPARATOR_CODE})),%genre%)`;

export const PLAYER_JOINER = ", ";

export const valuesIn = (raw: string) => raw.split(SEPARATOR);

export const spellValues = (raw: string) => valuesIn(raw).join(PLAYER_JOINER);
