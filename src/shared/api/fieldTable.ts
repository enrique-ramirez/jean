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
