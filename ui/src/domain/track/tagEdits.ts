export type TagValue = string | readonly string[];
export type TagValues = Readonly<Record<string, TagValue>>;

export function tagEdits(
	read: TagValues,
	form: TagValues,
): Record<string, string | string[]> {
	const edits: Record<string, string | string[]> = {};
	for (const [tag, value] of Object.entries(form)) {
		const before = read[tag];
		if (typeof value === "string") {
			if (value !== (before ?? "")) edits[tag] = value;
			continue;
		}
		const was =
			before === undefined || before === ""
				? []
				: typeof before === "string"
					? [before]
					: before;
		if (value.length !== was.length || value.some((v, i) => v !== was[i])) {
			edits[tag] = [...value];
		}
	}
	return edits;
}

/**
 * What a save leaves to draw over the row the host holds: the fields written so far to that row.
 * A form whose track is no longer the one shown wrote to a row the host does not hold, so nothing
 * is left to draw.
 */
export function writtenAfter<Row, Fields extends object>(
	earlier: { base: Row; fields: Fields } | null,
	hosted: Row | null,
	formTrackKey: string | undefined,
	shownTrackKey: string | undefined,
	fields: Fields,
): { base: Row; fields: Fields } | null {
	if (hosted === null || formTrackKey !== shownTrackKey) return null;
	return {
		base: hosted,
		fields: {
			...(earlier?.base === hosted ? earlier.fields : null),
			...fields,
		},
	};
}
