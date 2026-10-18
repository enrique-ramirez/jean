import { overColumnsByName } from "@/domain/track/columnCache";
import {
	CREDIT_TAGS,
	collapseRepeatedTag,
	creditedArtists,
	FIELD,
	namesAnArtist,
	readValue,
	tagKey,
} from "@/domain/track/fields";
import { growingIndex } from "@/domain/track/growingIndex";
import {
	byValue,
	isLoaded,
	type LibraryColumns,
} from "@/domain/track/libraryColumns";
import type { TrackRows } from "@/domain/track/project";
import { finished, SLICE_MASK, type Steps } from "@/shared/lib/idle";
import { type FuzzyKey, fuzzyKey } from "@/shared/lib/text";
import { CREDIT_FIELDS, creditMembers, type Member } from "./credits";

export interface Artist {
	name: string;
	key: string;
	match: FuzzyKey;
	sortMatch: FuzzyKey | null;
	trackCount: number;
	guestCount: number;
	albumCount: number;
	coverRefs: number[];
}

interface Draft {
	name: string;
	key: string;
	match: FuzzyKey;
	sortMatch: FuzzyKey | null;
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
const absorbing =
	(guesses: boolean) =>
	(byKey: Map<string, Draft>, rows: TrackRows, from: number) =>
		absorb(byKey, rows, from, guesses);

function* absorb(
	byKey: Map<string, Draft>,
	rows: TrackRows,
	from: number,
	guesses: boolean,
): Steps<void> {
	const { columns } = rows;
	const members = creditMembers(columns, guesses);
	const artist = columns.fields[FIELD.artist];
	const albumArtist = columns.fields[FIELD.albumArtist];
	const album = columns.fields[FIELD.album];
	const artistSort = columns.fields[FIELD.artistSort];

	const credits = byValue(artist, creditOf);
	const acts = byValue(albumArtist, albumArtistOf);
	const albumKeys = byValue(album, (raw) => {
		const name = readValue(raw);
		return name ? tagKey(name) : null;
	});
	const sortKeys = byValue(artistSort, (raw) => {
		const name = readValue(raw);
		return name ? fuzzyKey(name) : null;
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
				sortMatch: null,
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
		if ((position & SLICE_MASK) === 0) yield;
		const ref = rows.ref(position);
		const credited = credits[artist.ids[ref]];
		const act = acts[albumArtist.ids[ref]];
		const albumKey = albumKeys[album.ids[ref]];

		// Keyed rather than deduplicated by spelling: one track credits the same name in both tags, and
		// the two spellings differ often enough -- `TV On The Radio` beside `TV on the Radio` -- that a
		// set of strings would count that track twice.
		const leads = new Map<string, string>();
		const shared = [...members.artist(ref), ...members.albumArtist(ref)];
		for (const lead of [
			...credited.leads,
			...act.leads,
			...shared.filter((member) => !member.isGuest),
		])
			if (!leads.has(lead.key)) leads.set(lead.key, lead.name);

		for (const [key, name] of leads)
			credit({ key, name }, position, albumKey, false);

		const seen = new Set(leads.keys());
		for (const guest of [
			...credited.guests,
			...shared.filter((member) => member.isGuest),
		]) {
			if (seen.has(guest.key)) continue;
			seen.add(guest.key);
			credit(guest, position, albumKey, true);
		}

		if (leads.size === 1 && seen.size === 1) {
			const [soleKey] = leads.keys();
			const sole = byKey.get(soleKey);
			if (sole && !sole.sortMatch)
				sole.sortMatch = sortKeys[artistSort.ids[ref]];
		}
	}
}

const derive = (byKey: Map<string, Draft>): Artist[] =>
	[...byKey.values()]
		.map((draft) => ({
			name: draft.name,
			key: draft.key,
			match: draft.match,
			sortMatch: draft.sortMatch,
			trackCount: draft.trackCount,
			guestCount: draft.guestCount,
			albumCount: draft.albums.size,
			coverRefs: [...draft.albums.values()],
		}))
		.sort((a, b) => b.trackCount - a.trackCount);

export function artistsOf(rows: TrackRows, guesses: boolean): Artist[] {
	const byKey = new Map<string, Draft>();
	finished(absorb(byKey, rows, 0, guesses));
	return derive(byKey);
}

const CREDITED = [...CREDIT_FIELDS, FIELD.album, FIELD.artistSort];
const AWAITED = [...CREDIT_TAGS, FIELD.artistSort];

const guessing = growingIndex(CREDITED, absorbing(true), derive);
const notGuessing = growingIndex(CREDITED, absorbing(false), derive);

const NO_ARTISTS: Artist[] = [];

export const artistIndex = (
	key: string,
	columns: LibraryColumns,
	guesses: boolean,
) =>
	isLoaded(columns, AWAITED)
		? (guesses ? guessing : notGuessing)(key, columns)
		: NO_ARTISTS;

export interface ArtistTracks {
	own: Int32Array;
	shared: Int32Array;
	guest: Int32Array;
	// All three, in library order. The split is how the overview *draws* them; it is not three sets, and
	// playing the artist from any surface has to mean the same thing.
	all: Int32Array;
}

export const refsOfArtist = overColumnsByName(
	CREDIT_FIELDS,
	(artist: string, guesses: boolean) => `${guesses}:${tagKey(artist)}`,
	artistRefs,
);

function artistRefs(
	columns: LibraryColumns,
	artist: string,
	guesses: boolean,
): ArtistTracks {
	const wanted = tagKey(artist);
	if (!wanted || !isLoaded(columns, CREDIT_TAGS))
		return {
			own: new Int32Array(0),
			shared: new Int32Array(0),
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

	const members = creditMembers(columns, guesses);
	const names = (named: readonly Member[], isGuest: boolean) =>
		named.some((member) => member.key === wanted && member.isGuest === isGuest);
	const namedAt = (ref: number, isGuest: boolean) =>
		names(members.artist(ref), isGuest) ||
		names(members.albumArtist(ref), isGuest);

	const own: number[] = [];
	const shared: number[] = [];
	const guest: number[] = [];
	const all: number[] = [];

	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		const credited = artistColumn.ids[ref];

		if (leads[credited] || acts[albumArtistColumn.ids[ref]]) own.push(ref);
		else if (namedAt(ref, false)) shared.push(ref);
		else if (guests[credited] || namedAt(ref, true)) guest.push(ref);
		else continue;

		all.push(ref);
	}

	return {
		own: Int32Array.from(own),
		shared: Int32Array.from(shared),
		guest: Int32Array.from(guest),
		all: Int32Array.from(all),
	};
}
