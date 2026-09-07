import {
	collapseRepeatedTag,
	creditedArtists,
	FIELD,
	tagKey,
	value,
} from "@/domain/track/fields";
import type { TrackColumns } from "@/shared/api/types";
import { type FuzzyKey, fuzzyKey } from "@/shared/lib/text";
import { growingIndex } from "./growingIndex";

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

export const artistIndex = growingIndex(absorb, derive);

export interface ArtistTracks {
	own: Int32Array;
	guest: Int32Array;
	// Both, in library order. The split is how the overview *draws* them; it is not two sets, and
	// playing the artist from either surface has to mean the same thing.
	all: Int32Array;
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
	if (!wanted)
		return {
			own: new Int32Array(0),
			guest: new Int32Array(0),
			all: new Int32Array(0),
		};

	const own: number[] = [];
	const guest: number[] = [];
	const all: number[] = [];

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
		else continue;

		all.push(ref);
	}

	return {
		own: Int32Array.from(own),
		guest: Int32Array.from(guest),
		all: Int32Array.from(all),
	};
}
