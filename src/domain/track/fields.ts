import { fieldTable } from "@/shared/api/fieldTable";
import type { TrackColumns } from "@/shared/api/types";

// %path% is absent deliberately: it is the largest field, and tracks are addressed by index, so it is fetched on demand for the one track that needs it.
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

	// The same two facts as foo_playcount spells them, asked for alongside the pair above rather than instead of it. Appended rather than filed beside their partners because the table is positional: an expression inserted in the middle shifts every index after it.
	["playCountLocal", "%play_count%"],
	["lastPlayedLocal", "%last_played%"],
] as const;

export const { expressions: TRACK_EXPRESSIONS, index: FIELD } =
	fieldTable(FIELDS);

// A field the player cannot resolve returns '?'; one that resolves but is empty returns '' or 'N/A'. That difference is the whole capability detection.
const UNRESOLVED = "?";
const ABSENT = new Set([UNRESOLVED, "", "N/A"]);

export const readValue = (raw: string | undefined): string | null =>
	raw === undefined || ABSENT.has(raw) ? null : raw;

// One fact the player may spell two ways, preferred in this order. `%lastfm_play_count%` is foo_enhanced_playcount's and counts scrobbles across every device somebody listens on; `%play_count%` is foo_playcount's and counts plays on this machine. They are different numbers, so the order is a choice rather than a detail: an install with both keeps the figure it already showed, and an install with only the ordinary component gets play history at all instead of an empty shelf. Neither is bundled with foobar2000.
//
// **An index means nothing outside its own table.** `nowPlayingFields.ts` numbers a different set, where 7 is the date rather than the play count, so this is applied by the named readers below and never inside `value()`, which both tables share. A map consulted there would fall back into whatever the other table happened to hold at that index and draw a disc total under "Date".
const TRACK_ALTERNATIVE: Partial<Record<number, number>> = {
	[FIELD.playCount]: FIELD.playCountLocal,
	[FIELD.lastPlayed]: FIELD.lastPlayedLocal,
};

// Falls back on anything `readValue` calls absent, not only on the missing-field sentinel: a counter that exists and has never been incremented answers `0`, so an empty answer means this component is not the one supplying the field.
// A factory rather than one function, because the map is per table and the mechanism is not: `nowPlayingFields.ts` declares its own pairs against its own indices.
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

// A value Jean holds outside a row, such as an optimistic rating, must read by exactly the same rules, or it disagrees with a loaded row about what `''` means.
export function readNumber(raw: string | undefined): number | null {
	const text = readValue(raw);
	if (text === null) return null;
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

export const number = (row: TrackColumns, field: number): number | null =>
	readNumber(row[field]);

// 'YYYY-MM-DD HH:MM:SS', with a trailing space from some components. Not every engine parses the space separator, hence the swap for 'T'.
export function readTimestamp(raw: string | undefined): number | null {
	const text = readValue(raw);
	if (!text) return null;
	const parsed = Date.parse(text.trim().replace(" ", "T"));
	return Number.isFinite(parsed) ? parsed : null;
}

export const timestamp = (row: TrackColumns, field: number): number | null =>
	readTimestamp(row[field]);

// Sampling is only safe where a wrong answer picks a default. Where it decides whether a column exists at all, scan instead.
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

// A field with an alternative exists if either spelling does, or the column would be hidden on the install the fallback was written for.
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

// Tags drift in case and spacing between files in the same album, so compare loosely to decide what the user sees and display the file's own spelling.
export const tagKey = (text: string | null | undefined) =>
	(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const sameTagValue = (
	a: string | null | undefined,
	b: string | null | undefined,
) => tagKey(a) === tagKey(b);

const escapeForRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// What a track's artist adds to the album's: 'feat. Future' out of 'Post Malone feat. Future'. Null on compilations, where the artist is the fact about the row rather than a footnote to it.
// Sliced out of the original rather than rebuilt from the normalised form, because the album artist may carry another file's spelling.
export function featuring(
	artist: string | null | undefined,
	albumArtist: string | null | undefined,
): string | null {
	if (!artist || !albumArtist) return null;

	// The lookahead stops a prefix from being a coincidence: without it a 'Kid' album turns 'Kidz Bop' into 'z Bop'.
	const name = escapeForRegExp(albumArtist.trim()).replace(/\s+/g, "\\s+");
	const match = new RegExp(`^\\s*${name}(?=$|[\\s,;/&])`, "i").exec(artist);
	if (!match) return null;

	// The tag's own separator carries nothing, but a connective word does: 'feat.' and 'w.' are how the sleeve says it, so they stay.
	return artist.slice(match[0].length).replace(/^[\s,;/&]+/, "") || null;
}
