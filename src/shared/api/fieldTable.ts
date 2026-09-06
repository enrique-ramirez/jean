// The player answers columns as a bare array in the order it was asked, so the expression list and
// the name-to-index map have to come off one declaration. Written out separately, the day somebody
// inserts an expression in the middle is the day a row reports its genre as its artist.
export function fieldTable<
	const Fields extends readonly (readonly [string, string])[],
>(fields: Fields) {
	return {
		expressions: fields.map(([, expression]) => expression),
		// The cast is what keeps the key union: `Object.fromEntries` widens its keys to `string`.
		index: Object.fromEntries(fields.map(([name], at) => [name, at])) as Record<
			Fields[number][0],
			number
		>,
	};
}
