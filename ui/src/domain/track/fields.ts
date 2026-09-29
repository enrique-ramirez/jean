import { fieldTable } from "@/shared/api/fieldTable";
import type { JlibColumn } from "@/shared/api/jlib";
import type { TrackColumns } from "@/shared/api/types";
import type { Translate } from "@/shared/i18n/locale";
import {
	byValue,
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
	["rating", "%rating%"],
	["year", "%year%"],
	["genre", "%genre%"],
	["codec", "%codec%"],
	["bitrate", "%bitrate%"],
	["playCountLocal", "%play_count%"],
	["lastPlayedLocal", "%last_played%"],
] as const;

export const { expressions: TRACK_EXPRESSIONS, index: FIELD } =
	fieldTable(FIELDS);

export const EMPTY_COLUMNS = libraryColumnsOf([], TRACK_EXPRESSIONS.length);

const ABSENT = new Set([UNRESOLVED, "", "N/A"]);

export const readValue = (raw: string | undefined): string | null =>
	raw === undefined || ABSENT.has(raw) ? null : raw;

// One fact the player may spell two ways, preferred in this order. `%lastfm_play_count%` is
// foo_enhanced_playcount's and counts scrobbles across every device; `%play_count%` is
// foo_playcount's and counts plays on this machine. They are different numbers, so the order is a
// choice. Neither component is bundled with foobar2000.
//
// An index means nothing outside its own table, so the map is applied by the named readers below and
// never inside `value()`, which `nowPlayingFields.ts` shares against its own, differently numbered set.
const TRACK_ALTERNATIVE: Partial<Record<number, number>> = {
	[FIELD.playCount]: FIELD.playCountLocal,
	[FIELD.lastPlayed]: FIELD.lastPlayedLocal,
};

export const withAlternatives = (fields: readonly number[]): number[] =>
	fields.flatMap((field) => {
		const alternative = TRACK_ALTERNATIVE[field];
		return alternative === undefined ? [field] : [field, alternative];
	});

export const alternativeReader =
	(alternatives: Partial<Record<number, number>>) =>
	(row: TrackColumns, field: number): string | undefined => {
		const primary = row[field];
		if (readValue(primary) !== null) return primary;
		const alternative = alternatives[field];
		return alternative === undefined ? primary : row[alternative];
	};

const eitherSpelling = alternativeReader(TRACK_ALTERNATIVE);

export const playCountOf = (row: TrackColumns): number | null =>
	readNumber(eitherSpelling(row, FIELD.playCount));

export const lastPlayedOf = (row: TrackColumns): number | null =>
	readTimestamp(eitherSpelling(row, FIELD.lastPlayed));

export function columnReader<T>(
	columns: LibraryColumns,
	field: number,
	read: (raw: string) => T | null,
): (ref: number) => T | null {
	const primary = columns.fields[field];
	const preferred = byValue(primary, read);

	const alternative = TRACK_ALTERNATIVE[field];
	if (alternative === undefined) return (ref) => preferred[primary.ids[ref]];

	const other = columns.fields[alternative];
	const spare = byValue(other, read);
	return (ref) => preferred[primary.ids[ref]] ?? spare[other.ids[ref]];
}

export const resolvesAnywhere = (columns: LibraryColumns, field: number) => {
	const alternative = TRACK_ALTERNATIVE[field];
	return (
		!columns.fields[field].allUnresolved ||
		(alternative !== undefined && !columns.fields[alternative].allUnresolved)
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

// 'YYYY-MM-DD HH:MM:SS', with a trailing space from some components. Not every engine parses the
// space separator, hence the swap for 'T'.
export function readTimestamp(raw: string | undefined): number | null {
	const text = readValue(raw);
	if (!text) return null;
	const parsed = Date.parse(text.trim().replace(" ", "T"));
	return Number.isFinite(parsed) ? parsed : null;
}

export const timestamp = (row: TrackColumns, field: number): number | null =>
	readTimestamp(row[field]);

export const tagKey = (text: string | null | undefined) =>
	(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const sameTagValue = (
	a: string | null | undefined,
	b: string | null | undefined,
) => tagKey(a) === tagKey(b);

export interface TagGrouper {
	readonly keys: string[];
	readonly names: string[];
	over: (column: JlibColumn) => Int32Array;
	group: (key: string) => number;
}

export function tagGrouper(): TagGrouper {
	const byKey = new Map<string, number>();
	const keys: string[] = [];
	const names: string[] = [];

	return {
		keys,
		names,
		over: (column) => {
			const groups = new Int32Array(column.distinct);

			for (let id = 0; id < column.distinct; id += 1) {
				const raw = readValue(column.value(id));
				if (raw === null) {
					groups[id] = -1;
					continue;
				}

				const key = tagKey(raw);
				let group = byKey.get(key);
				if (group === undefined) {
					group = keys.length;
					keys.push(key);
					names.push(raw);
					byKey.set(key, group);
				}
				groups[id] = group;
			}

			return groups;
		},
		group: (key) => byKey.get(key) ?? -1,
	};
}

export interface TagGroups extends TagGrouper {
	readonly of: Int32Array;
}

export function tagGroups(column: JlibColumn): TagGroups {
	const grouper = tagGrouper();
	return { ...grouper, of: grouper.over(column) };
}

// Album artist first: it is missing far more often than artist is, so a record credited to it groups
// correctly and one without it still falls back to whoever the tracks are by.
export interface ArtistGroups {
	readonly names: string[];
	readonly at: (ref: number) => number;
	readonly pairedWith: (ref: number, group: number) => number;
	readonly group: (key: string) => number;
}

export function artistGroups(columns: LibraryColumns): ArtistGroups {
	const grouper = tagGrouper();
	const albumArtist = columns.fields[FIELD.albumArtist];
	const artist = columns.fields[FIELD.artist];
	const byAlbumArtist = grouper.over(albumArtist);
	const byArtist = grouper.over(artist);

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
const FEATURING = /(\s+(?:feat|ft|featuring)\.?\s+)/i;

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
