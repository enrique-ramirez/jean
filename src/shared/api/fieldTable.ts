// A positional column set: the title-formatting expressions to ask the player
// for, and the index each name landed at.
//
// The player answers `columns` as a bare array in the order it was asked, so a
// row is read by position and the two halves have to be derived from one list.
// Written out separately -- as they were, in two files -- the day somebody
// inserts an expression in the middle is the day a row starts reporting its
// genre as its artist, silently and everywhere.
export function fieldTable<
	const Fields extends readonly (readonly [string, string])[],
>(fields: Fields) {
	return {
		expressions: fields.map(([, expression]) => expression),
		// Cast because Object.fromEntries widens its keys to string, and the whole
		// point of this map is that FIELD.rating typechecks and FIELD.ratings does
		// not.
		index: Object.fromEntries(fields.map(([name], at) => [name, at])) as Record<
			Fields[number][0],
			number
		>,
	};
}
