import {
	collapseRepeatedTag,
	creditedArtists,
	FIELD,
	namesAnArtist,
	readValue,
	tagKey,
} from "@/domain/track/fields";
import { growingIndex } from "@/domain/track/growingIndex";
import { byValue, type LibraryColumns } from "@/domain/track/libraryColumns";
import type { TrackRows } from "@/domain/track/project";
import { type FuzzyKey, fuzzyKey } from "@/shared/lib/text";

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
	match: FuzzyKey;
	trackCount: number;
	guestCount: number;
	albums: Map<string, number>;
}

interface Named {
	key: string;
	name: string;
}

const named = (name: string): Named => ({ key: tagKey(name), name });

interface Credited {
	leads: Named[];
	guests: Named[];
}

const creditOf = (raw: string): Credited => {
	const { lead, guests } = creditedArtists(readValue(raw));
	return {
		leads: lead && namesAnArtist(lead) ? [named(lead)] : [],
		guests: guests.filter(namesAnArtist).map(named),
	};
};

const albumArtistOf = (raw: string): Credited => {
	const tag = readValue(raw);
	if (!tag) return { leads: [], guests: [] };
	const name = collapseRepeatedTag(tag);
	return { leads: namesAnArtist(name) ? [named(name)] : [], guests: [] };
};

/**
 * Every name credited anywhere, from both tags. Neither one alone is the artist: `%album artist%` is
 * the closest thing to an act but is written by whoever tagged the files, so it carries doubled and
 * misspelt values; `%artist%` is a credit line rather than a name, and holds the guests.
 *
 * A name is counted once per track however many ways it was credited there, so the counts add up to
 * the track list the page draws.
 */
function absorb(byKey: Map<string, Draft>, rows: TrackRows, from: number) {
	const { columns } = rows;
	const artist = columns.fields[FIELD.artist];
	const albumArtist = columns.fields[FIELD.albumArtist];
	const album = columns.fields[FIELD.album];

	const credits = byValue(artist, creditOf);
	const acts = byValue(albumArtist, albumArtistOf);
	const albumKeys = byValue(album, (raw) => {
		const name = readValue(raw);
		return name ? tagKey(name) : null;
	});

	const credit = (
		{ key, name }: Named,
		ref: number,
		albumKey: string | null,
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

		if (albumKey && !draft.albums.has(albumKey))
			draft.albums.set(albumKey, ref);
	};

	for (let position = from; position < rows.length; position += 1) {
		const ref = rows.ref(position);
		const credited = credits[artist.ids[ref]];
		const act = acts[albumArtist.ids[ref]];
		const albumKey = albumKeys[album.ids[ref]];

		// Keyed rather than deduplicated by spelling: one track credits the same name in both tags, and
		// the two spellings differ often enough -- `TV On The Radio` beside `TV on the Radio` -- that a
		// set of strings would count that track twice.
		const leads = new Map<string, string>();
		for (const lead of [...credited.leads, ...act.leads])
			if (!leads.has(lead.key)) leads.set(lead.key, lead.name);

		for (const [key, name] of leads)
			credit({ key, name }, position, albumKey, false);

		const seen = new Set(leads.keys());
		for (const guest of credited.guests) {
			if (seen.has(guest.key)) continue;
			seen.add(guest.key);
			credit(guest, position, albumKey, true);
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

export function artistsOf(rows: TrackRows): Artist[] {
	const byKey = new Map<string, Draft>();
	absorb(byKey, rows, 0);
	return derive(byKey);
}

const CREDITED = [FIELD.artist, FIELD.albumArtist, FIELD.album];

export const artistIndex = growingIndex(CREDITED, absorb, derive);

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
	columns: LibraryColumns,
	artist: string,
): ArtistTracks {
	const wanted = tagKey(artist);
	if (!wanted)
		return {
			own: new Int32Array(0),
			guest: new Int32Array(0),
			all: new Int32Array(0),
		};

	const artistColumn = columns.fields[FIELD.artist];
	const albumArtistColumn = columns.fields[FIELD.albumArtist];

	// Not `namesAnArtist`: a name somebody navigated to is a name they mean, including one the index
	// refuses to list.
	const credits = byValue(artistColumn, (raw) =>
		creditedArtists(readValue(raw)),
	);
	const leads = credits.map((credit) => tagKey(credit.lead) === wanted);
	const guests = credits.map((credit) =>
		credit.guests.some((name) => tagKey(name) === wanted),
	);
	const acts = byValue(albumArtistColumn, (raw) => {
		const tag = readValue(raw);
		return tag !== null && tagKey(collapseRepeatedTag(tag)) === wanted;
	});

	const own: number[] = [];
	const guest: number[] = [];
	const all: number[] = [];

	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		const credited = artistColumn.ids[ref];

		if (leads[credited] || acts[albumArtistColumn.ids[ref]]) own.push(ref);
		else if (guests[credited]) guest.push(ref);
		else continue;

		all.push(ref);
	}

	return {
		own: Int32Array.from(own),
		guest: Int32Array.from(guest),
		all: Int32Array.from(all),
	};
}
