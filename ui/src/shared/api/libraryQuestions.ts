import {
	ask,
	askResult,
	READ_TIMEOUT_MS,
	reach,
	refusalOf,
	retryAfterMs,
	type Schema,
} from "./client";
import type { SummaryRole } from "./librarySummary";
import {
	type ReadFailure,
	type ReadFailureReason,
	readFailed,
} from "./readFailure";

export type LibraryRoleName =
	| SummaryRole
	| "artists"
	| "artistIds"
	| "albumArtists"
	| "albumArtistIds"
	| "artistSort";

export type LibraryRoles = Record<LibraryRoleName, string>;

export type NamedArtist = Schema["NamedArtist"];
export type NamedAlbum = Schema["NamedAlbum"];
export type NamedGenre = Schema["NamedGenre"];
export type SetFigures = Schema["SetFigures"];
export type ArtistCards = Schema["ArtistCards"];
export type AlbumRecord = Schema["AlbumRecord"];

export interface ArtistAnswered {
	figures: SetFigures;
	cards: ArtistCards;
	records: Record<"own" | "shared", AlbumRecord[]>;
}

export interface LibrarySearchAnswer {
	matched: Int32Array | null;
	matchCount: number;
	figures: SetFigures;
	best: Int32Array;
	artists: { total: number; top: NamedArtist[] };
	albums: { total: number; top: NamedAlbum[] };
	genres: { total: number; top: NamedGenre[] };
	namesATrack: boolean;
}

// The longest query `foo_jean` takes, in UTF-8 bytes.
export const MAX_QUERY_BYTES = 1024;

const utf8 = new TextEncoder();

export const isQueryTooLong = (query: string) =>
	utf8.encode(query).length > MAX_QUERY_BYTES;

export const PREVIEW_ARTISTS = 2;
export const PREVIEW_ALBUMS = 3;
export const PREVIEW_GENRES = 1;
const ENTITY_LIMIT = Math.max(PREVIEW_ARTISTS, PREVIEW_ALBUMS, PREVIEW_GENRES);

export type LibraryQuestion =
	| {
			kind: "search";
			query: string;
			limit: number;
			entityLimit?: number;
			splitsCredits: boolean;
	  }
	| { kind: "album"; artist: string | null; album: string }
	| { kind: "artist"; artist: string; splitsCredits: boolean }
	| { kind: "genre"; genre: string };

export type QuestionAnswerTo<Question extends LibraryQuestion> =
	Question extends { kind: "search" }
		? LibrarySearchAnswer
		: Question extends { kind: "album" }
			? {
					refs: Int32Array;
					album: string;
					artist: string | null;
					figures: SetFigures;
				}
			: Question extends { kind: "artist" }
				? {
						own: Int32Array;
						shared: Int32Array;
						guest: Int32Array;
					} & ArtistAnswered
				: { refs: Int32Array; figures: SetFigures };

export type QuestionResult<Question extends LibraryQuestion> =
	| {
			ok: true;
			structure: number;
			revision: number;
			answer: QuestionAnswerTo<Question>;
	  }
	| ReadFailure;

const QUESTION_REFUSALS: Partial<Record<number, ReadFailureReason>> = {
	202: "notReady",
	400: "refused",
	409: "undeclared",
	429: "tooFast",
	503: "unavailable",
};

type OrdinalSet = Schema["OrdinalSet"];

export function decodeSet(
	set: OrdinalSet,
	trackCount: number,
): Int32Array | null {
	try {
		if ("runs" in set) {
			let count = 0;
			for (const [start, length] of set.runs) {
				if (!(Number.isInteger(start) && Number.isInteger(length))) return null;
				if (start < 0 || length < 0 || start + length > trackCount) return null;
				count += length;
			}
			if (count > trackCount) return null;
			const ordinals = new Int32Array(count);
			let at = 0;
			for (const [start, length] of set.runs)
				for (let step = 0; step < length; step += 1)
					ordinals[at++] = start + step;
			return ordinals;
		}
		if (!("bitset" in set)) return null;

		const bytes = Uint8Array.from(atob(set.bitset), (char) =>
			char.charCodeAt(0),
		);
		const ordinals: number[] = [];
		for (let byte = 0; byte < bytes.length; byte += 1)
			for (let bit = 0; bit < 8; bit += 1)
				if ((bytes[byte] >> bit) & 1) {
					const ordinal = byte * 8 + bit;
					if (ordinal >= trackCount) return null;
					ordinals.push(ordinal);
				}
		return Int32Array.from(ordinals);
	} catch {
		return null;
	}
}

function decodeOrdinals(list: number[], trackCount: number) {
	return Array.isArray(list) &&
		list.every(
			(ordinal) =>
				Number.isInteger(ordinal) && ordinal >= 0 && ordinal < trackCount,
		)
		? Int32Array.from(list)
		: null;
}

const boundOf = (
	library: { structure: number; trackCount: number },
	data: { structure: number },
) =>
	data.structure === library.structure
		? library.trackCount
		: Number.MAX_SAFE_INTEGER;

const SET_NAMES = ["own", "shared", "guest"] as const;

function decodeSets(
	sets: Record<(typeof SET_NAMES)[number], OrdinalSet>,
	trackCount: number,
) {
	const own = decodeSet(sets.own, trackCount);
	const shared = decodeSet(sets.shared, trackCount);
	const guest = decodeSet(sets.guest, trackCount);
	return own && shared && guest ? { own, shared, guest } : null;
}

interface Document {
	structure: number;
	revision: number;
}

interface Read {
	response: Response;
	error: unknown;
	document: Document | undefined;
	answer: unknown;
}

const orNull = <Value>(value: Value | null | undefined) => value ?? null;

// A `202` is a success to openapi-fetch and carries the library document, which is not an answer.
const answered = <Answer extends Document>(
	got: { data?: unknown; error?: unknown; response: Response },
	answerOf: (data: Answer) => unknown,
): Read => {
	const data = got.response.status === 200 ? (got.data as Answer) : undefined;
	return {
		response: got.response,
		error: got.error,
		document: data,
		answer: data ? answerOf(data) : null,
	};
};

export async function fetchLibraryAnswer<Question extends LibraryQuestion>(
	origin: string,
	question: Question,
	roles: LibraryRoles,
	library: { structure: number; trackCount: number },
	signal?: AbortSignal,
): Promise<QuestionResult<Question>> {
	const reached = await reach(
		ask(
			origin,
			READ_TIMEOUT_MS,
			async (api, init): Promise<Read> => {
				const options = { ...init, cache: "no-store" } as const;
				switch (question.kind) {
					case "search":
						return answered<Schema["SearchAnswer"]>(
							await api.GET("/library/search", {
								...options,
								params: {
									query: {
										...roles,
										query: question.query,
										limit: question.limit,
										entityLimit: question.entityLimit ?? ENTITY_LIMIT,
										splitsCredits: question.splitsCredits,
									},
								},
							}),
							(data) => {
								const bound = boundOf(library, data);
								const matched = data.matched
									? decodeSet(data.matched, bound)
									: null;
								const best = decodeOrdinals(data.best, bound);
								return best && (matched || data.matched === null)
									? {
											matched,
											matchCount: data.matchCount,
											figures: data.figures,
											best,
											artists: data.artists,
											albums: data.albums,
											genres: data.genres,
											namesATrack: data.namesATrack,
										}
									: null;
							},
						);
					case "album":
						return answered<Schema["AlbumAnswer"]>(
							await api.GET("/library/album", {
								...options,
								params: {
									query: {
										...roles,
										name: question.album,
										...(question.artist === null
											? null
											: { by: question.artist }),
									},
								},
							}),
							(data) => {
								const refs = decodeSet(data.refs, boundOf(library, data));
								return refs
									? {
											refs,
											album: data.album,
											artist: orNull(data.artist),
											figures: data.figures,
										}
									: null;
							},
						);
					case "artist":
						return answered<Schema["ArtistAnswer"]>(
							await api.GET("/library/artist", {
								...options,
								params: {
									query: {
										...roles,
										name: question.artist,
										splitsCredits: question.splitsCredits,
									},
								},
							}),
							(data) => {
								const sets = decodeSets(data, boundOf(library, data));
								return sets
									? {
											...sets,
											figures: data.figures,
											cards: data.cards,
											records: data.records,
										}
									: null;
							},
						);
					case "genre":
						return answered<Schema["GenreAnswer"]>(
							await api.GET("/library/genre", {
								...options,
								params: { query: { ...roles, name: question.genre } },
							}),
							(data) => {
								const refs = decodeSet(data.refs, boundOf(library, data));
								return refs ? { refs, figures: data.figures } : null;
							},
						);
				}
			},
			signal,
		),
		signal,
	);
	if (!reached) return readFailed("unreachable");
	const { response, error, document, answer } = reached;

	const refusal = QUESTION_REFUSALS[response.status];
	if (refusal) {
		const { error: said, message } = refusalOf(response, error);
		return readFailed(
			refusal,
			said ? message : "",
			refusal === "tooFast" ? retryAfterMs(response) : null,
		);
	}
	if (!document || !answer)
		return readFailed("failed", `HTTP ${response.status}`);

	return {
		ok: true,
		structure: document.structure,
		revision: document.revision,
		answer: answer as QuestionAnswerTo<Question>,
	};
}

export type ValueField = "artist" | "albumArtist" | "album" | "genre";

export const fetchLibraryValues = (
	origin: string,
	roles: LibraryRoles,
	wanted: { field: ValueField; prefix: string; limit: number },
	signal?: AbortSignal,
) =>
	askResult(
		origin,
		READ_TIMEOUT_MS,
		(api, init) =>
			api.GET("/library/values", {
				...init,
				cache: "no-store",
				params: { query: { ...roles, ...wanted } },
			}),
		signal,
	);
