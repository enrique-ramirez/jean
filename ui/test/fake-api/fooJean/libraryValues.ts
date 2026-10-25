import { compareUtf8 } from "../jlib.ts";
import { fold } from "./librarySearch.ts";
import {
	genreGroupsOf,
	type LibraryRoleName,
	readValue,
	tagGrouper,
	tagKey,
} from "./librarySummary.ts";

export const VALUE_FIELDS = [
	"artist",
	"albumArtist",
	"album",
	"genre",
] as const satisfies readonly LibraryRoleName[];

export type ValueField = (typeof VALUE_FIELDS)[number];

const namesOf = (
	columns: Partial<Record<LibraryRoleName, string[]>>,
	field: ValueField,
) => {
	if (field === "genre") return genreGroupsOf(columns).names;

	const groups = tagGrouper();
	const distinct = [...new Set(columns[field] ?? [])]
		.filter((raw) => readValue(raw) !== null && tagKey(raw) !== "")
		.sort(compareUtf8);
	for (const raw of distinct) groups.add(raw);
	return groups.names;
};

export function valuesBeginning(
	columns: Partial<Record<LibraryRoleName, string[]>>,
	field: ValueField,
	prefix: string,
	limit: number,
) {
	const folded = fold(prefix);
	return namesOf(columns, field)
		.filter((name) => fold(name).startsWith(folded))
		.slice(0, limit);
}
