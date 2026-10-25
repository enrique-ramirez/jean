import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { CHUNK, mapped, runToEnd, type Sweep } from "../yielding.ts";
import {
	albumPageSweep,
	artistPageSweep,
	creditMembersSweep,
	genrePageSweep,
	type PageColumns,
} from "./libraryPages.ts";
import {
	type SearchAsked,
	type SearchHeld,
	searchPageSweep,
} from "./librarySearch.ts";
import { setsOverSweep } from "./librarySets.ts";
import {
	fixedOffset,
	type LibraryRoleName,
	type LocalTime,
} from "./librarySummary.ts";
import { type ValueField, valuesBeginning } from "./libraryValues.ts";

type OrdinalSet = components["schemas"]["OrdinalSet"];

export type PageQuestion =
	| { kind: "album"; name: string; by?: string }
	| { kind: "artist"; name: string; splitsCredits: boolean }
	| { kind: "genre"; name: string };

export type Question =
	| PageQuestion
	| ({ kind: "search" } & SearchAsked)
	| { kind: "credits"; ordinal: number; splitsCredits: boolean }
	| { kind: "values"; field: ValueField; prefix: string; limit: number };

export interface QuestionLibrary {
	structure: number;
	revision: number;
	directory: string[];
	filename: string[];
	subsong: string[];
	// Each path as the directory and the filename make it, where the caller holds them already.
	paths?: string[];
	columns: Partial<Record<LibraryRoleName, string[]>>;
}

// What is derived from a library's columns, held for as long as the same columns are asked of: the
// state hands back one columns object until a column moves.
interface Derived {
	page?: PageColumns;
	sets?: ReturnType<typeof setsOverSweep> extends Sweep<infer R> ? R : never;
	search: SearchHeld;
}
const derivedOf = new WeakMap<object, Derived>();

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

function* runsOf(ordinals: readonly number[]): Sweep<[number, number][]> {
	const runs: [number, number][] = [];
	let counted = 0;
	for (const ordinal of ordinals) {
		if (counted++ % CHUNK === CHUNK - 1) yield;
		const last = runs[runs.length - 1];
		if (last && ordinal === last[0] + last[1]) last[1] += 1;
		else runs.push([ordinal, 1]);
	}
	return runs;
}

export function* setSweep(
	ordinals: readonly number[],
	trackCount: number,
): Sweep<OrdinalSet> {
	const runs = yield* runsOf(ordinals);
	if (runs.length === 0) return { runs };
	const bitsetLength = 4 * Math.ceil(Math.ceil(trackCount / 8) / 3);
	if (JSON.stringify(runs).length <= bitsetLength) return { runs };

	const bytes = new Uint8Array(Math.ceil(trackCount / 8));
	let counted = 0;
	for (const ordinal of ordinals) {
		if (counted++ % CHUNK === CHUNK - 1) yield;
		bytes[ordinal >> 3] |= 1 << (ordinal & 7);
	}
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return { bitset: btoa(binary) };
}

export function* answerQuestionSweep(
	library: QuestionLibrary,
	question: Question,
	local: LocalTime = fixedOffset(-new Date().getTimezoneOffset()),
) {
	const { structure, revision } = library;
	const trackCount = library.directory.length;
	const derived: Derived = derivedOf.get(library.columns) ?? {
		search: new Map(),
	};
	derivedOf.set(library.columns, derived);
	derived.page ??= columnsOf(library);
	const columns = derived.page;
	function* setsOf() {
		derived.sets ??= yield* setsOverSweep(library, local);
		return derived.sets;
	}
	const sent = (ordinals: readonly number[]) => setSweep(ordinals, trackCount);

	switch (question.kind) {
		case "search": {
			const sets = yield* setsOf();
			const paths =
				library.paths ??
				(yield* mapped(
					library.directory,
					(directory, at) => directory + library.filename[at],
				));
			const found = yield* searchPageSweep(
				{ ...columns, paths },
				question,
				derived.search,
			);
			return {
				structure,
				revision,
				matched: found.matched && (yield* sent(found.matched)),
				matchCount: found.matched?.length ?? 0,
				figures: yield* sets.figures(found.matched ?? []),
				best: found.best,
				artists: found.artists,
				albums: found.albums,
				genres: found.genres,
				namesATrack: found.namesATrack,
			};
		}
		case "album": {
			const sets = yield* setsOf();
			const { refs, album, artist } = yield* albumPageSweep(
				columns,
				question.by || null,
				question.name,
			);
			return {
				structure,
				revision,
				refs: yield* sent(refs),
				figures: yield* sets.figures(refs),
				album,
				artist,
			};
		}
		case "artist": {
			const sets = yield* setsOf();
			const { own, shared, guest } = yield* artistPageSweep(
				columns,
				question.name,
				question.splitsCredits,
			);
			const all = [...own, ...shared, ...guest].sort((a, b) => a - b);
			return {
				structure,
				revision,
				own: yield* sent(own),
				shared: yield* sent(shared),
				guest: yield* sent(guest),
				figures: yield* sets.figures(all),
				cards: sets.cards(all),
				records: { own: sets.records(own), shared: sets.records(shared) },
			};
		}
		case "credits": {
			const members = yield* creditMembersSweep(
				columns,
				question.splitsCredits,
			);
			return {
				structure,
				revision,
				artist: members.artist(question.ordinal),
				albumArtist: members.albumArtist(question.ordinal),
			};
		}
		case "values":
			return {
				structure,
				revision,
				values: valuesBeginning(
					library.columns,
					question.field,
					question.prefix,
					question.limit,
				),
			};
		case "genre": {
			const sets = yield* setsOf();
			const refs = yield* genrePageSweep(columns, question.name);
			return {
				structure,
				revision,
				refs: yield* sent(refs),
				figures: yield* sets.figures(refs),
			};
		}
	}
}

export const answerQuestion = (
	library: QuestionLibrary,
	question: Question,
	local?: LocalTime,
) => runToEnd(answerQuestionSweep(library, question, local));
