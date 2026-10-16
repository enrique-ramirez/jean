import { fieldTable } from "@/shared/api/fieldTable";
import type { JlibColumn } from "@/shared/api/jlib";
import {
	everyValueOf,
	GENRE_EXPRESSION,
	valuesIn,
} from "@/shared/api/multiValue";
import { RATING_EXPRESSION } from "@/shared/api/rating";
import type {
	NowPlayingTrack,
	PlayingTrack,
	TrackColumns,
} from "@/shared/api/types";
import type { Translate } from "@/shared/i18n/locale";
import { finished, SLICE_MASK, type Steps } from "@/shared/lib/idle";
import { slicedOver } from "./columnCache";
import {
	byValueSteps,
	type LibraryColumns,
	libraryColumnsOf,
	UNRESOLVED,
} from "./libraryColumns";

const FIELDS = [
	["trackNumber", "%tracknumber%"],
	["discNumber", "%discnumber%"],
	["title", "%title%"],
	["artist", "%artist%"],
	["album", "%album%"],
	["albumArtist", "%album artist%"],
	["duration", "%length_seconds%"],
	["playCount", "%lastfm_play_count%"],
	["lastPlayed", "%lastfm_last_played%"],
	["rating", RATING_EXPRESSION],
	["year", "%year%"],
	["genre", GENRE_EXPRESSION],
	["codec", "%codec%"],
	["bitrate", "%bitrate%"],
	["playCountLocal", "%play_count%"],
	["lastPlayedLocal", "%last_played%"],
	["added", "%added%"],
	["artists", everyValueOf("artists")],
	["artistIds", everyValueOf("musicbrainz_artistid")],
	["albumArtists", everyValueOf("albumartists")],
	["albumArtistIds", everyValueOf("musicbrainz_albumartistid")],
] as const;

export const { expressions: TRACK_EXPRESSIONS, index: FIELD } =
	fieldTable(FIELDS);

export const CREDIT_TAGS = [
	FIELD.artists,
	FIELD.artistIds,
	FIELD.albumArtists,
	FIELD.albumArtistIds,
];

export const LATE_FIELDS = [
	FIELD.codec,
	FIELD.bitrate,
	FIELD.added,
	...CREDIT_TAGS,
];

export const LATE_EXPRESSIONS = LATE_FIELDS.map(
	(field) => TRACK_EXPRESSIONS[field],
);

export const EARLY_EXPRESSIONS = TRACK_EXPRESSIONS.filter(
	(expression) => !LATE_EXPRESSIONS.includes(expression),
);

export const EMPTY_COLUMNS = libraryColumnsOf([], TRACK_EXPRESSIONS.length);

const ABSENT = new Set([UNRESOLVED, "", "N/A"]);

export const readValue = (raw: string | undefined): string | null =>
	raw === undefined || ABSENT.has(raw) ? null : raw;

// `%lastfm_play_count%` and its kin are foo_enhanced_playcount's, counting scrobbles from every
// device and answering `0` and `N/A` for a track last.fm has not matched. `%play_count%` and its kin
// are foo_playcount's, counting plays on this machine. Neither component is bundled with foobar2000.
const UNPLAYED = "0";

export interface Combination {
	readonly read: (raw: string | undefined) => number | null;
	readonly pick: (a: number, b: number) => number;
}

export const HIGHER: Combination = { read: readNumber, pick: Math.max };
export const LATER: Combination = { read: readTimestamp, pick: Math.max };
export const EARLIER: Combination = { read: readTimestamp, pick: Math.min };

export interface Pair {
	readonly scrobbled: number;
	readonly local: number;
	readonly by: Combination;
}

const PLAY_COUNT: Pair = {
	scrobbled: FIELD.playCount,
	local: FIELD.playCountLocal,
	by: HIGHER,
};

const LAST_PLAYED: Pair = {
	scrobbled: FIELD.lastPlayed,
	local: FIELD.lastPlayedLocal,
	by: LATER,
};

const pairsByField = (pairs: readonly Pair[]) =>
	new Map(pairs.map((pair) => [pair.scrobbled, pair]));

const TRACK_PAIRS = pairsByField([PLAY_COUNT, LAST_PLAYED]);

const answerOf = (by: Combination, raw: string | undefined) =>
	raw === UNPLAYED ? null : by.read(raw);

const either = (by: Combination, a: number | null, b: number | null) =>
	a === null ? b : b === null ? a : by.pick(a, b);

function combined(
	{ scrobbled, local, by }: Pair,
	row: TrackColumns,
): string | undefined {
	const remote = answerOf(by, row[scrobbled]);
	const here = answerOf(by, row[local]);
	if (remote === null && here === null)
		return readValue(row[scrobbled]) === null ? row[local] : row[scrobbled];
	return either(by, remote, here) === remote ? row[scrobbled] : row[local];
}

export const pairedReader = (pairs: readonly Pair[]) => {
	const byField = pairsByField(pairs);
	return (row: TrackColumns, field: number): string | undefined => {
		const pair = byField.get(field);
		return pair === undefined ? row[field] : combined(pair, row);
	};
};

const answerIn = (pair: Pair) => (row: TrackColumns) =>
	answerOf(pair.by, combined(pair, row));

export const playCountOf = answerIn(PLAY_COUNT);
export const lastPlayedOf = answerIn(LAST_PLAYED);

function* columnReaderSteps(
	columns: LibraryColumns,
	{ scrobbled, local, by }: Pair,
): Steps<(ref: number) => number | null> {
	const remote = columns.fields[scrobbled];
	const here = columns.fields[local];
	const answer = (raw: string) => answerOf(by, raw);
	const remoteAnswers = yield* byValueSteps(remote, answer);
	const localAnswers = yield* byValueSteps(here, answer);
	return (ref) =>
		either(by, remoteAnswers[remote.ids[ref]], localAnswers[here.ids[ref]]);
}

const readerIn = (pair: Pair) =>
	Object.assign(
		(columns: LibraryColumns) => finished(columnReaderSteps(columns, pair)),
		{ steps: (columns: LibraryColumns) => columnReaderSteps(columns, pair) },
	);

export const playCountsIn = readerIn(PLAY_COUNT);

export const lastPlayedIn = readerIn(LAST_PLAYED);

export const withBothSources = (fields: readonly number[]): number[] =>
	fields.flatMap((field) => {
		const pair = TRACK_PAIRS.get(field);
		return pair === undefined ? [field] : [field, pair.local];
	});

export const resolvesAnywhere = (columns: LibraryColumns, field: number) => {
	const pair = TRACK_PAIRS.get(field);
	return (
		!columns.fields[field].allUnresolved ||
		(pair !== undefined && !columns.fields[pair.local].allUnresolved)
	);
};

export function value(row: TrackColumns, field: number): string | null {
	return readValue(row[field]);
}

export function readNumber(raw: string | undefined): number | null {
	const text = readValue(raw);
	if (text === null) return null;
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

export const numberOf = (row: TrackColumns, field: number): number | null =>
	readNumber(row[field]);

// The translator is passed in rather than reached for: what these answer is a phrase, so a caller
// memoising the result has to depend on the language, and a dependency it cannot see is one it will
// not have.
export const titleOf = (row: TrackColumns, t: Translate) =>
	value(row, FIELD.title) ?? t("track.unknownTitle");

export const artistOf = (row: TrackColumns, t: Translate) =>
	value(row, FIELD.artist) ?? t("track.unknownArtist");

export const namedTrack = (
	track: PlayingTrack | null,
	t: Translate,
): NowPlayingTrack | null =>
	track && {
		...track,
		title: track.title ?? t("track.unknownTitle"),
		artist: track.artist ?? t("track.unknownArtist"),
	};

// 'YYYY-MM-DD HH:MM:SS', with a trailing space from some components. Not every engine parses the
// space separator, hence the swap for 'T'.
export function readTimestamp(raw: string | undefined): number | null {
	const text = readValue(raw);
	if (!text) return null;
	const parsed = Date.parse(text.trim().replace(" ", "T"));
	return Number.isFinite(parsed) ? parsed : null;
}

export const tagKey = (text: string | null | undefined) =>
	(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const sameTagValue = (
	a: string | null | undefined,
	b: string | null | undefined,
) => tagKey(a) === tagKey(b);

interface TagGrouper {
	readonly keys: string[];
	readonly names: string[];
	add: (raw: string) => number;
	over: (column: JlibColumn) => Steps<Int32Array>;
	group: (key: string) => number;
}

function tagGrouper(): TagGrouper {
	const byKey = new Map<string, number>();
	const keys: string[] = [];
	const names: string[] = [];

	const add = (raw: string) => {
		const key = tagKey(raw);
		let group = byKey.get(key);
		if (group === undefined) {
			group = keys.length;
			keys.push(key);
			names.push(raw);
			byKey.set(key, group);
		}
		return group;
	};

	return {
		keys,
		names,
		add,
		*over(column) {
			const groups = new Int32Array(column.distinct);
			for (let id = 0; id < column.distinct; id += 1) {
				const raw = readValue(column.value(id));
				groups[id] = raw === null ? -1 : add(raw);
				if ((id & SLICE_MASK) === 0) yield;
			}
			return groups;
		},
		group: (key) => byKey.get(key) ?? -1,
	};
}

export interface TagGroups {
	readonly keys: readonly string[];
	readonly names: readonly string[];
	readonly of: Int32Array;
	readonly group: (key: string) => number;
}

const tagGroupsHeld = slicedOver<TagGroups>();

function* tagGroupsSteps(column: JlibColumn): Steps<TagGroups> {
	const grouper = tagGrouper();
	return {
		keys: grouper.keys,
		names: grouper.names,
		of: yield* grouper.over(column),
		group: grouper.group,
	};
}

const tagGroupSteps = (column: JlibColumn) =>
	tagGroupsHeld.steps([column], () => tagGroupsSteps(column));

export const tagGroups = Object.assign(
	(column: JlibColumn): TagGroups => finished(tagGroupSteps(column)),
	{ steps: tagGroupSteps },
);

export interface GenreGroups {
	readonly keys: string[];
	readonly names: string[];
	readonly of: readonly (readonly number[])[];
	group: (key: string) => number;
}

export function genreGroups(column: JlibColumn): GenreGroups {
	const grouper = tagGrouper();
	const of = Array.from({ length: column.distinct }, (_, id) => {
		const raw = readValue(column.value(id));
		if (raw === null) return [];
		const named = valuesIn(raw).filter((genre) => tagKey(genre) !== "");
		return [...new Set(named.map(grouper.add))];
	});
	return { keys: grouper.keys, names: grouper.names, of, group: grouper.group };
}

// Album artist first: it is missing far more often than artist is, so a record credited to it groups
// correctly and one without it still falls back to whoever the tracks are by.
export interface ArtistGroups {
	readonly names: readonly string[];
	readonly at: (ref: number) => number;
	readonly pairedWith: (ref: number, group: number) => number;
	readonly group: (key: string) => number;
}

const artistGroupsHeld = slicedOver<ArtistGroups>();

const artistGroupSteps = (columns: LibraryColumns) => {
	const albumArtist = columns.fields[FIELD.albumArtist];
	const artist = columns.fields[FIELD.artist];
	return artistGroupsHeld.steps([albumArtist, artist], () =>
		groupedArtists(albumArtist, artist),
	);
};

export const artistGroups = Object.assign(
	(columns: LibraryColumns): ArtistGroups =>
		finished(artistGroupSteps(columns)),
	{ steps: artistGroupSteps },
);

function* groupedArtists(
	albumArtist: JlibColumn,
	artist: JlibColumn,
): Steps<ArtistGroups> {
	const grouper = tagGrouper();
	const byAlbumArtist = yield* grouper.over(albumArtist);
	const byArtist = yield* grouper.over(artist);

	const width = grouper.keys.length + 1;

	const at = (ref: number) => {
		const credited = byAlbumArtist[albumArtist.ids[ref]];
		return credited >= 0 ? credited : byArtist[artist.ids[ref]];
	};

	return {
		names: grouper.names,
		at,
		pairedWith: (ref, group) => group * width + at(ref) + 1,
		group: grouper.group,
	};
}

/**
 * foobar joins a multi-valued tag with `", "`, and a single value may hold commas of its own -- so a
 * comma is ambiguous and the string alone cannot say which it is. Collapsing only where every part
 * is the same name resolves the case that actually occurs, a tag written twice (`Foo Fighters, Foo
 * Fighters`), and never cuts `Blood, Sweat & Tears` in half. It leaves genuine collaborations joined,
 * which costs a spare entry rather than a missing one.
 *
 * The player can settle the rest: `$meta_num()` takes one argument, so it survives the column list
 * being split on commas and would say how many values a tag holds. It is not asked, because that is
 * a column on every row of every library read to disambiguate a case this rare.
 */
export function collapseRepeatedTag(value: string): string {
	const parts = value.split(", ");
	if (parts.length < 2) return value;

	const first = tagKey(parts[0]);
	return parts.every((part) => tagKey(part) === first) ? parts[0] : value;
}

// `feat.`, `ft.` and `featuring` are the only credit separators that cannot be part of a name. `&`,
// `and`, `with`, `,` and `/` all appear inside real ones -- Simon & Garfunkel, Blood, Sweat & Tears,
// Sleep With Sirens -- so splitting on any of them invents artists that do not exist.
// The separator is captured, so a caller drawing the credit can put it back exactly as tagged.
export const FEATURING = /(\s+(?:feat|ft|featuring)\.?\s+)/i;

// Alternating names and the separators between them, verbatim. Even indices are names.
export const splitCredit = (artist: string) => artist.split(FEATURING);

export const isCreditSeparator = (at: number) => at % 2 === 1;

export function creditedArtists(artist: string | null | undefined): {
	lead: string | null;
	guests: string[];
} {
	if (!artist) return { lead: null, guests: [] };

	const [lead, ...guests] = splitCredit(artist)
		.filter((_, at) => !isCreditSeparator(at))
		.map((part) => collapseRepeatedTag(part.trim()))
		.filter(Boolean);

	return { lead: lead ?? null, guests };
}

/**
 * What a cover *is*, as against where `foo_jean` will hand it over. Its artwork address names a track,
 * or a position in a playlist that stops meaning the same picture the moment anything edits it, so
 * the same sleeve has a different address on every track of a record and in every view that draws
 * it. Identity fixes both.
 *
 * Album artist first, matching how albums are grouped everywhere else, or a compilation fragments
 * into one cover per track artist. Null-separated so `A` + `B C` cannot collide with `A B` + `C`.
 */
export const coverKey = (
	artist: string | null | undefined,
	name: string,
	kind: "album" | "track" = "album",
) => `${kind}\u0000${tagKey(artist)}\u0000${tagKey(name)}`;

export function coverIdentity(row: TrackColumns): string | undefined {
	const artist = value(row, FIELD.albumArtist) ?? value(row, FIELD.artist);
	const album = value(row, FIELD.album);
	if (album) return coverKey(artist, album);

	// No album tag is a gap in the tags rather than a reason to give up caching: the track stands as
	// its own picture, which still beats fetching the same one once per view.
	const title = value(row, FIELD.title);
	return title ? coverKey(artist, title, "track") : undefined;
}

const escapeForRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Sliced out of the original rather than rebuilt from the normalised form: the album artist tag may
// carry another file's spelling.
export function featuring(
	artist: string | null | undefined,
	albumArtist: string | null | undefined,
): string | null {
	if (!artist || !albumArtist) return null;

	// The lookahead stops a prefix from matching by coincidence: without it a 'Kid' album turns 'Kidz
	// Bop' into 'z Bop'.
	const name = escapeForRegExp(albumArtist.trim()).replace(/\s+/g, "\\s+");
	const match = new RegExp(`^\\s*${name}(?=$|[\\s,;/&])`, "i").exec(artist);
	if (!match) return null;

	return artist.slice(match[0].length).replace(/^[\s,;/&]+/, "") || null;
}

// Not an artist, and a page for it would be every compilation track in the library. Asked wherever a
// name is about to become somewhere you can go -- the index, a credit drawn as links, the track menu
// -- since leaving it to the index alone still offers the trip from everywhere else.
const NOT_AN_ARTIST = new Set(["various artists", "various", "va"]);

export const namesAnArtist = (name: string | null | undefined) => {
	const key = tagKey(name);
	return key.length > 0 && !NOT_AN_ARTIST.has(key);
};
