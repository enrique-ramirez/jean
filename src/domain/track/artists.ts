import {
	collapseRepeatedTag,
	creditedArtists,
	FIELD,
	tagKey,
	value,
} from "@/domain/track/fields";
import type { TrackColumns } from "@/shared/api/types";
import { type FuzzyKey, fuzzyKey, fuzzyScore, squash } from "@/shared/lib/text";

// Not an artist, and a page for it would be every compilation track in the library. Asked wherever a
// name is about to become somewhere you can go -- the index, a credit drawn as links, the track menu
// -- since leaving it to the index alone still offers the trip from everywhere else.
const NOT_AN_ARTIST = new Set(["various artists", "various", "va"]);

export const namesAnArtist = (name: string | null | undefined) => {
	const key = tagKey(name);
	return key.length > 0 && !NOT_AN_ARTIST.has(key);
};

export interface Artist {
	name: string;
	key: string;
	match: FuzzyKey;
	trackCount: number;
	guestCount: number;
	albumCount: number;
	coverRefs: number[];
}

interface Draft {
	name: string;
	key: string;
	// Built once with the draft rather than when the list is derived, since deriving happens again
	// every time a chunk of library arrives and squashing every name each time is the expensive half.
	match: FuzzyKey;
	trackCount: number;
	guestCount: number;
	albums: Map<string, number>;
}

const albumKeyOf = (row: TrackColumns) => {
	const album = value(row, FIELD.album);
	return album ? tagKey(album) : null;
};

/**
 * Every name credited anywhere, from both tags. Neither one alone is the artist: `%album artist%` is
 * the closest thing to an act but is written by whoever tagged the files, so it carries doubled and
 * misspelt values; `%artist%` is a credit line rather than a name, and holds the guests.
 *
 * A name is counted once per track however many ways it was credited there, so the counts add up to
 * the track list the page draws.
 */
function absorb(byKey: Map<string, Draft>, rows: TrackColumns[], from: number) {
	const credit = (
		key: string,
		name: string,
		ref: number,
		row: TrackColumns,
		isGuest: boolean,
	) => {
		let draft = byKey.get(key);
		if (!draft) {
			draft = {
				name,
				key,
				match: fuzzyKey(name),
				trackCount: 0,
				guestCount: 0,
				albums: new Map(),
			};
			byKey.set(key, draft);
		}

		if (isGuest) draft.guestCount += 1;
		else draft.trackCount += 1;

		const album = albumKeyOf(row);
		if (album && !draft.albums.has(album)) draft.albums.set(album, ref);
	};

	for (let ref = from; ref < rows.length; ref += 1) {
		const row = rows[ref];
		const { lead, guests } = creditedArtists(value(row, FIELD.artist));
		const albumArtist = value(row, FIELD.albumArtist);

		// Keyed rather than deduplicated by spelling: one track credits the same name in both tags, and
		// the two spellings differ often enough -- `TV On The Radio` beside `TV on the Radio` -- that a
		// set of strings would count that track twice.
		const leads = new Map<string, string>();
		for (const name of [
			lead,
			albumArtist && collapseRepeatedTag(albumArtist),
		]) {
			const key = tagKey(name);
			if (name && namesAnArtist(name) && !leads.has(key)) leads.set(key, name);
		}

		for (const [key, name] of leads) credit(key, name, ref, row, false);

		const credited = new Set(leads.keys());
		for (const guest of guests) {
			const key = tagKey(guest);
			if (!namesAnArtist(guest) || credited.has(key)) continue;
			credited.add(key);
			credit(key, guest, ref, row, true);
		}
	}
}

const derive = (byKey: Map<string, Draft>): Artist[] =>
	[...byKey.values()]
		.map((draft) => ({
			name: draft.name,
			key: draft.key,
			match: draft.match,
			trackCount: draft.trackCount,
			guestCount: draft.guestCount,
			albumCount: draft.albums.size,
			coverRefs: [...draft.albums.values()],
		}))
		.sort((a, b) => b.trackCount - a.trackCount);

export function artistsOf(rows: TrackColumns[]): Artist[] {
	const byKey = new Map<string, Draft>();
	absorb(byKey, rows, 0);
	return derive(byKey);
}

let held: {
	key: string;
	counted: number;
	drafts: Map<string, Draft>;
	artists: Artist[];
} | null = null;

/**
 * Extended in place as the library arrives, never cached on the key alone: **the key carries the
 * library's total count, so it does not change while rows are still streaming in**. Cached on it and
 * nothing else, this answers from whatever the first chunk happened to hold and never notices the
 * rest -- an artist the user has half of, or has not reached yet, is simply absent for the session.
 *
 * Asked for only once something needs it, so a session that never searches never builds it.
 */
export function artistIndex(key: string, rows: TrackColumns[]): Artist[] {
	if (held?.key !== key)
		held = { key, counted: 0, drafts: new Map(), artists: [] };

	if (held.counted !== rows.length) {
		absorb(held.drafts, rows, held.counted);
		held.counted = rows.length;
		held.artists = derive(held.drafts);
	}

	return held.artists;
}

/**
 * The artists a query plausibly *names*, best first. The floor is what keeps a section honest: a list
 * of two shows two things however badly the second scored, so sorting alone cannot decide whether the
 * query is about an artist at all. Below a whole-word match, `blood` offers `youngbloodz` above two
 * hundred songs with the word in their titles.
 *
 * Entities take the whole ladder, unlike tracks: a track was filtered on the token before it was
 * ranked, so it can never reach the rungs that catch a typo, and an artist was not.
 */
export function rankArtists(
	artists: Artist[],
	query: string,
	floor: number,
): Artist[] {
	const squashed = squash(query);
	if (squashed.length === 0) return [];

	return (
		artists
			.map((artist) => ({ artist, score: fuzzyScore(artist.match, squashed) }))
			.filter((entry) => entry.score >= floor)
			// Then by how much of them the library holds: at the same rung, the one you own more of is
			// more likely the one meant.
			.sort(
				(a, b) =>
					b.score - a.score || b.artist.trackCount - a.artist.trackCount,
			)
			.map((entry) => entry.artist)
	);
}

export interface ArtistTracks {
	own: Int32Array;
	guest: Int32Array;
}

/**
 * Split by how the name was credited, since the page keeps guest spots apart from an artist's own
 * records. A track counts as theirs if either tag names them; only a name that appears solely after
 * a `feat.` is a guest.
 */
export function refsOfArtist(
	rows: TrackColumns[],
	artist: string,
): ArtistTracks {
	const wanted = tagKey(artist);
	// An empty key would match every untagged row rather than nothing.
	if (!wanted) return { own: new Int32Array(0), guest: new Int32Array(0) };

	const own: number[] = [];
	const guest: number[] = [];

	for (let ref = 0; ref < rows.length; ref += 1) {
		const row = rows[ref];
		const { lead, guests } = creditedArtists(value(row, FIELD.artist));
		const albumArtist = value(row, FIELD.albumArtist);

		if (
			tagKey(lead) === wanted ||
			(albumArtist && tagKey(collapseRepeatedTag(albumArtist)) === wanted)
		)
			own.push(ref);
		else if (guests.some((name) => tagKey(name) === wanted)) guest.push(ref);
	}

	return { own: Int32Array.from(own), guest: Int32Array.from(guest) };
}
