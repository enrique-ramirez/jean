import type { Ids, JlibColumn } from "@/shared/api/jlib";
import { fold } from "@/shared/lib/text";
import { FIELD } from "./fields";
import type { LibraryColumns } from "./libraryColumns";

// Which field matched has to outweigh how well it matched: the spread must be wide enough that a
// hit on the album lands below a hit on the title a rung further down the ladder, and narrow enough
// that an exact album title still beats a passing mention in a song.
const TITLE = 1;
const ARTIST = 0.85;
const ALBUM = 0.6;

const SEARCHED = [
	{ field: FIELD.title, weight: TITLE },
	{ field: FIELD.artist, weight: ARTIST },
	{ field: FIELD.albumArtist, weight: ARTIST },
	{ field: FIELD.album, weight: ALBUM },
];

const TITLE_AT = SEARCHED.findIndex((field) => field.field === FIELD.title);

export interface SearchField {
	readonly ids: Ids;
	readonly weight: number;
	readonly text: (ref: number) => string;
}

export interface SearchIndex {
	readonly fields: readonly SearchField[];
	readonly title: SearchField;
}

export interface FoldCache {
	over: (columns: LibraryColumns) => SearchIndex;
	warm: (columns: LibraryColumns, hasTime: () => boolean) => boolean;
}

const WARM_CHECK_EVERY = 256;

export function foldCache(): FoldCache {
	const held = SEARCHED.map((): string[] => []);
	const warmed = SEARCHED.map(() => 0);
	let last: { of: readonly JlibColumn[]; index: SearchIndex } | null = null;

	return {
		over: (columns) => {
			const searched = SEARCHED.map(({ field }) => columns.fields[field]);
			const previous = last;
			if (
				previous &&
				searched.every((column, at) => column === previous.of[at])
			)
				return previous.index;

			const fields = SEARCHED.map(({ weight }, at): SearchField => {
				const { ids, value } = searched[at];
				const folded = held[at];

				return {
					ids,
					weight,
					text: (ref) => {
						const id = ids[ref];
						const known = folded[id];
						if (known !== undefined) return known;
						const next = fold(value(id));
						folded[id] = next;
						return next;
					},
				};
			});

			const index = { fields, title: fields[TITLE_AT] };
			last = { of: searched, index };
			return index;
		},

		warm: (columns, hasTime) => {
			for (let at = 0; at < SEARCHED.length; at += 1) {
				const { distinct, value } = columns.fields[SEARCHED[at].field];
				const folded = held[at];
				for (let id = warmed[at]; id < distinct; id += 1) {
					if (id % WARM_CHECK_EVERY === 0 && !hasTime()) {
						warmed[at] = id;
						return false;
					}
					if (folded[id] === undefined) folded[id] = fold(value(id));
				}
				warmed[at] = distinct;
			}
			return true;
		},
	};
}

export const searchIndex = (columns: LibraryColumns): SearchIndex =>
	foldCache().over(columns);

export const rowMatches = (index: SearchIndex, ref: number, tokens: string[]) =>
	tokens.every((token) =>
		index.fields.some((field) => field.text(ref).includes(token)),
	);
