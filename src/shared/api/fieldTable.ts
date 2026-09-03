// A positional column set: the title-formatting expressions to ask the player for, and the index each name landed at.
// The player answers columns as a bare array in the order it was asked, so both halves have to be derived from one list: written out separately, an expression inserted in the middle makes a row report its genre as its artist.
export function fieldTable<
	const Fields extends readonly (readonly [string, string])[],
>(fields: Fields) {
	return {
		expressions: fields.map(([, expression]) => expression),
		// Cast because Object.fromEntries widens its keys to string, and the point of this map is that FIELD.rating typechecks and FIELD.ratings does not.
		index: Object.fromEntries(fields.map(([name], at) => [name, at])) as Record<
			Fields[number][0],
			number
		>,
	};
}
