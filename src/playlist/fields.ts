import type { TrackColumns } from "../api/types";

// Everything fetched for every track, kept deliberately small: each entry is a
// string per row, and per-track-unique values are the expensive ones. %path% is
// absent on purpose -- the single largest field, and tracks are addressed by
// index, so it is fetched on demand for the one track that needs it.
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
] as const;

export type FieldName = (typeof FIELDS)[number][0];

export const TRACK_EXPRESSIONS: string[] = FIELDS.map(
	([, expression]) => expression,
);

// Cast rather than inferred: Object.fromEntries widens its keys to string, and
// the whole point of this map is that FIELD.rating is a name the compiler
// knows and FIELD.ratings is not.
export const FIELD = Object.fromEntries(
	FIELDS.map(([name], index) => [name, index]),
) as Record<FieldName, number>;

// A field the player cannot resolve comes back as '?'; one that resolves but is
// empty comes back as '' -- or 'N/A' from the playback-statistics component.
// That difference is the whole capability-detection mechanism.
const UNRESOLVED = "?";
const ABSENT = new Set([UNRESOLVED, "", "N/A"]);

export function value(row: TrackColumns, field: number): string | null {
	const raw = row[field];
	return raw === undefined || ABSENT.has(raw) ? null : raw;
}

export function number(row: TrackColumns, field: number): number | null {
	const raw = value(row, field);
	if (raw === null) return null;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

// 'YYYY-MM-DD HH:MM:SS', with a trailing space from some components. Not every
// engine parses the space separator, hence the swap for 'T'.
export function timestamp(row: TrackColumns, field: number): number | null {
	const raw = value(row, field);
	if (!raw) return null;
	const parsed = Date.parse(raw.trim().replace(" ", "T"));
	return Number.isFinite(parsed) ? parsed : null;
}

// Rows spread evenly across the list. Sampling rather than scanning is only
// safe where a wrong answer picks a default; where it decides whether a column
// exists at all, scan -- see hasAnyRating.
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

// Whether a field resolved at all, which is how a column that depends on a
// component this player does not have gets hidden.
export const fieldIsAvailable = (
	rows: TrackColumns[],
	field: number,
	sampleSize = 200,
) => sampleRows(rows, sampleSize).some((row) => row[field] !== UNRESOLVED);

// Tags drift in case and spacing between files in the same album --
// '5 Seconds Of Summer' and '5 Seconds of Summer' are one artist. Compare
// loosely to decide what the user sees; display the file's own spelling.
const normalise = (text: string | null | undefined) =>
	(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const sameTagValue = (
	a: string | null | undefined,
	b: string | null | undefined,
) => normalise(a) === normalise(b);

const escapeForRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// What a track's artist adds to the album's -- 'feat. Future & Halsey' out of
// 'Post Malone feat. Future & Halsey' on a Post Malone album. Null when the
// artist is not the album's plus something, which is the compilation case:
// there the artist is the fact about the row rather than a footnote to it.
//
// Matched loosely and sliced out of the original, never rebuilt from the
// normalised form: the album artist comes off the group's first row and may be
// another file's spelling, but what is shown has to be this file's.
export function featuring(
	artist: string | null | undefined,
	albumArtist: string | null | undefined,
): string | null {
	if (!artist || !albumArtist) return null;

	// The lookahead stops a prefix from being a coincidence: without it a 'Kid'
	// album turns 'Kidz Bop' into 'z Bop'.
	const name = escapeForRegExp(albumArtist.trim()).replace(/\s+/g, "\\s+");
	const match = new RegExp(`^\\s*${name}(?=$|[\\s,;/&])`, "i").exec(artist);
	if (!match) return null;

	// A separator the tag happened to choose carries nothing, and a leading comma
	// is not something to print. A connective word is different: 'feat.' and 'w.'
	// are how the sleeve says it, and they stay.
	return artist.slice(match[0].length).replace(/^[\s,;/&]+/, "") || null;
}
