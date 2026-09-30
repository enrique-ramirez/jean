import type { ValueSource } from "@/domain/library/queryCompletion";
import { FIELD, genreGroups, tagGroups } from "@/domain/track/fields";
import type { LibraryColumns } from "@/domain/track/libraryColumns";

export function valueSourceOf(
	columns: LibraryColumns,
	compare: (a: string, b: string) => number,
): ValueSource {
	const names = (field: number) =>
		[...tagGroups(columns.fields[field]).names].sort(compare);

	return {
		artist: names(FIELD.artist),
		"album artist": names(FIELD.albumArtist),
		album: names(FIELD.album),
		genre: [...genreGroups(columns.fields[FIELD.genre]).names].sort(compare),
	};
}
