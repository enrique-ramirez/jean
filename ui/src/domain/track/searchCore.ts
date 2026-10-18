import {
	type Artist,
	artistIndex,
	refsOfArtist,
} from "@/domain/artist/artists";
import { decodeJlib } from "@/shared/api/jlib";
import { fold, glyphs, queryOf, TIER } from "@/shared/lib/text";
import { type Album, albumIndex, refsOfAlbum } from "./albums";
import { TRACK_EXPRESSIONS } from "./fields";
import { type Genre, genreIndex } from "./genres";
import type { LibraryColumns } from "./libraryColumns";
import { searchLibrary } from "./libraryIndex";
import {
	columnsOfSnapshot,
	patchedColumns,
	splicedColumns,
	withLatePart,
} from "./librarySnapshot";
import { refsOfGenre } from "./project";
import { rankEntities } from "./rankEntities";
import { bestMatches } from "./rankTracks";
import { type FoldCache, foldCache } from "./searchText";

export interface SearchCore {
	readonly columns: LibraryColumns;
	readonly generation: string;
	readonly folded: FoldCache;
}

export type SearchQuestion =
	| { kind: "search"; query: string; limit: number; splitsCredits: boolean }
	| { kind: "album"; artist: string | null; album: string }
	| { kind: "artist"; artist: string; splitsCredits: boolean }
	| { kind: "genre"; genre: string };

export interface SearchAnswer {
	matched: Int32Array | null;
	best: Int32Array;
	artists: Artist[];
	albums: Album[];
	genres: Genre[];
	namesATrack: boolean;
}

export interface AlbumAnswer {
	refs: Int32Array;
	album: string;
	artist: string | null;
}

export interface ArtistAnswer {
	own: Int32Array;
	shared: Int32Array;
	guest: Int32Array;
	all: Int32Array;
}

export type AnswerTo<Question extends SearchQuestion> = Question extends {
	kind: "search";
}
	? SearchAnswer
	: Question extends { kind: "album" }
		? AlbumAnswer
		: Question extends { kind: "artist" }
			? ArtistAnswer
			: Int32Array;

const SECTION_FLOOR = TIER.word;

const NOTHING = new Int32Array(0);

let cores = 0;

const coreOver = (columns: LibraryColumns, folded: FoldCache): SearchCore => ({
	columns,
	generation: `search-core:${cores}`,
	folded,
});

export function searchCoreOf(exportBytes: ArrayBuffer): SearchCore {
	const library = decodeJlib(exportBytes);
	if (library.kind !== "snapshot") throw new Error("not a snapshot");

	cores += 1;
	return coreOver(columnsOfSnapshot(library, TRACK_EXPRESSIONS), foldCache());
}

export function searchCoreOver(columns: LibraryColumns): SearchCore {
	cores += 1;
	return coreOver(columns, foldCache());
}

export function patchedSearchCore(
	core: SearchCore,
	deltaBytes: ArrayBuffer,
): SearchCore | null {
	const delta = decodeJlib(deltaBytes);
	if (delta.kind !== "delta") return null;

	const columns = patchedColumns(core.columns, delta, TRACK_EXPRESSIONS);
	return columns ? { ...core, columns } : null;
}

export function splicedSearchCore(
	core: SearchCore,
	spliceBytes: ArrayBuffer,
): SearchCore | null {
	const splice = decodeJlib(spliceBytes);
	if (splice.kind !== "splice") return null;

	const columns = splicedColumns(core.columns, splice, TRACK_EXPRESSIONS);
	if (!columns) return null;

	cores += 1;
	return coreOver(columns, foldCache());
}

export function partedSearchCore(
	core: SearchCore,
	partBytes: ArrayBuffer,
	patchBytes: readonly ArrayBuffer[],
): SearchCore | null {
	const library = decodeJlib(partBytes);
	if (library.kind !== "snapshot") return null;

	let part: LibraryColumns | null = columnsOfSnapshot(
		library,
		TRACK_EXPRESSIONS,
	);
	for (const bytes of patchBytes) {
		const delta = decodeJlib(bytes);
		if (delta.kind !== "delta") return null;
		part = patchedColumns(part, delta, TRACK_EXPRESSIONS);
		if (!part) return null;
	}

	const columns = withLatePart(core.columns, part);
	return columns ? { ...core, columns } : null;
}

function searchAnswer(
	core: SearchCore,
	query: string,
	limit: number,
	splitsCredits: boolean,
): SearchAnswer {
	const { columns, generation } = core;
	const wanted = query.trim();

	const index = core.folded.over(columns);
	const asked = queryOf(query);
	const matched = searchLibrary(index, columns.trackCount, asked);
	const named = asked.glyphic ? glyphs(wanted) : fold(wanted);
	const titleOf = asked.glyphic ? index.title.glyphs : index.title.text;

	return {
		matched,
		best: matched
			? Int32Array.from(
					bestMatches(index, matched, asked, limit),
					(position) => matched[position],
				)
			: NOTHING,
		artists: wanted
			? rankEntities(
					artistIndex(generation, columns, splitsCredits),
					wanted,
					SECTION_FLOOR,
				)
			: [],
		albums: wanted
			? rankEntities(albumIndex(generation, columns), wanted, SECTION_FLOOR)
			: [],
		genres: wanted
			? rankEntities(genreIndex(generation, columns), wanted, SECTION_FLOOR)
			: [],
		namesATrack:
			wanted !== "" &&
			matched !== null &&
			matched.some((ref) => titleOf(ref) === named),
	};
}

const EMPTY_SEARCH: SearchAnswer = {
	matched: null,
	best: NOTHING,
	artists: [],
	albums: [],
	genres: [],
	namesATrack: false,
};

export function answerOf<Question extends SearchQuestion>(
	core: SearchCore,
	question: Question,
): AnswerTo<Question>;
export function answerOf(
	core: SearchCore,
	question: SearchQuestion,
): SearchAnswer | AlbumAnswer | ArtistAnswer | Int32Array {
	const { columns } = core;

	switch (question.kind) {
		case "search":
			return columns.trackCount === 0
				? EMPTY_SEARCH
				: searchAnswer(
						core,
						question.query,
						question.limit,
						question.splitsCredits,
					);
		case "album":
			return refsOfAlbum(columns, question.artist, question.album);
		case "artist":
			return refsOfArtist(columns, question.artist, question.splitsCredits);
		case "genre":
			return refsOfGenre(columns, question.genre);
	}
}
