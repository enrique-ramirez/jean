import { fieldTable } from "@/shared/api/fieldTable";
import type { TrackColumns } from "@/shared/api/types";

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

// A field the player cannot resolve returns '?'; one that resolves but is empty returns '' or 'N/A'.
// That difference is the whole of the capability detection.
const UNRESOLVED = "?";
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

export const titleOf = (row: TrackColumns) =>
	value(row, FIELD.title) ?? "Unknown title";

export const artistOf = (row: TrackColumns) =>
	value(row, FIELD.artist) ?? "Unknown artist";

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

export function sampleRows(
	rows: TrackColumns[],
	sampleSize: number,
): TrackColumns[] {
	const step = Math.max(1, Math.floor(rows.length / sampleSize));
	return Array.from(
		{ length: Math.ceil(rows.length / step) },
		(_, at) => rows[at * step],
	);
}

export const fieldIsAvailable = (
	rows: TrackColumns[],
	field: number,
	sampleSize = 200,
) => {
	const alternative = TRACK_ALTERNATIVE[field];
	return sampleRows(rows, sampleSize).some(
		(row) =>
			row[field] !== UNRESOLVED ||
			(alternative !== undefined && row[alternative] !== UNRESOLVED),
	);
};

export const tagKey = (text: string | null | undefined) =>
	(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const sameTagValue = (
	a: string | null | undefined,
	b: string | null | undefined,
) => tagKey(a) === tagKey(b);

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
