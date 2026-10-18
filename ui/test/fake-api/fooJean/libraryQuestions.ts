import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import {
	albumPage,
	artistPage,
	genrePage,
	type PageColumns,
} from "./libraryPages.ts";
import { type SearchAsked, searchPage } from "./librarySearch.ts";
import type { LibraryRoleName } from "./librarySummary.ts";

type OrdinalSet = components["schemas"]["OrdinalSet"];

export type PageQuestion =
	| { kind: "album"; name: string; by?: string }
	| { kind: "artist"; name: string; splitsCredits: boolean }
	| { kind: "genre"; name: string };

export type Question = PageQuestion | ({ kind: "search" } & SearchAsked);

export interface QuestionLibrary {
	structure: number;
	revision: number;
	directory: string[];
	filename: string[];
	subsong: string[];
	columns: Partial<Record<LibraryRoleName, string[]>>;
}

const UNRESOLVED = "?";

const columnsOf = ({ directory, columns }: QuestionLibrary): PageColumns => {
	const trackCount = directory.length;
	const of = (role: LibraryRoleName) =>
		columns[role] ?? new Array<string>(trackCount).fill(UNRESOLVED);
	return {
		trackCount,
		title: of("title"),
		trackNumber: of("trackNumber"),
		discNumber: of("discNumber"),
		album: of("album"),
		albumArtist: of("albumArtist"),
		albumArtists: of("albumArtists"),
		albumArtistIds: of("albumArtistIds"),
		artist: of("artist"),
		artists: of("artists"),
		artistIds: of("artistIds"),
		artistSort: of("artistSort"),
		genre: of("genre"),
	};
};

const runsOf = (ordinals: readonly number[]) => {
	const runs: [number, number][] = [];
	for (const ordinal of ordinals) {
		const last = runs[runs.length - 1];
		if (last && ordinal === last[0] + last[1]) last[1] += 1;
		else runs.push([ordinal, 1]);
	}
	return runs;
};

const setOf = (ordinals: readonly number[], trackCount: number): OrdinalSet => {
	const runs = runsOf(ordinals);
	if (runs.length === 0) return { runs };
	const bitsetLength = 4 * Math.ceil(Math.ceil(trackCount / 8) / 3);
	if (JSON.stringify(runs).length <= bitsetLength) return { runs };

	const bytes = new Uint8Array(Math.ceil(trackCount / 8));
	for (const ordinal of ordinals) bytes[ordinal >> 3] |= 1 << (ordinal & 7);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return { bitset: btoa(binary) };
};

export function answerQuestion(library: QuestionLibrary, question: Question) {
	const { structure, revision } = library;
	const trackCount = library.directory.length;
	const columns = columnsOf(library);
	const sent = (ordinals: readonly number[]) => setOf(ordinals, trackCount);

	switch (question.kind) {
		case "search": {
			const paths = library.directory.map(
				(directory, at) => directory + library.filename[at],
			);
			const found = searchPage({ ...columns, paths }, question);
			return {
				structure,
				revision,
				matched: found.matched && sent(found.matched),
				matchCount: found.matched?.length ?? 0,
				best: found.best,
				artists: found.artists,
				albums: found.albums,
				genres: found.genres,
				namesATrack: found.namesATrack,
			};
		}
		case "album": {
			const { refs, album, artist } = albumPage(
				columns,
				question.by || null,
				question.name,
			);
			return { structure, revision, refs: sent(refs), album, artist };
		}
		case "artist": {
			const { own, shared, guest } = artistPage(
				columns,
				question.name,
				question.splitsCredits,
			);
			return {
				structure,
				revision,
				own: sent(own),
				shared: sent(shared),
				guest: sent(guest),
			};
		}
		case "genre":
			return {
				structure,
				revision,
				refs: sent(genrePage(columns, question.name)),
			};
	}
}
