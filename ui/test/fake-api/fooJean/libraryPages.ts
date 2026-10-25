import { CHUNK, runToEnd, type Sweep } from "../yielding.ts";
import {
	readValue,
	tagGrouper,
	tagKey,
	VALUE_SEPARATOR,
} from "./librarySummary.ts";

export interface PageColumns {
	trackCount: number;
	title: readonly string[];
	trackNumber: readonly string[];
	discNumber: readonly string[];
	album: readonly string[];
	albumArtist: readonly string[];
	albumArtists: readonly string[];
	albumArtistIds: readonly string[];
	artist: readonly string[];
	artists: readonly string[];
	artistIds: readonly string[];
	artistSort: readonly string[];
	genre: readonly string[];
}

export interface Page {
	refs: number[];
	album: string;
	artist: string | null;
}

export interface Credited {
	own: number[];
	shared: number[];
	guest: number[];
}

const FEATURING = /(\s+(?:feat|ft|featuring)\.?\s+)/i;
const JOINER = /\s*,\s+|\s+(?:&|x|×|vs\.?|with|feat\.?|ft\.?|featuring)\s+/i;

export const valuesIn = (raw: string) => raw.split(VALUE_SEPARATOR);

const countOf = (raw: string | null) =>
	raw === null ? 0 : valuesIn(raw).length;

export const collapseRepeatedTag = (value: string) => {
	const parts = value.split(", ");
	if (parts.length < 2) return value;
	const first = tagKey(parts[0]);
	return parts.every((part) => tagKey(part) === first) ? parts[0] : value;
};

export const creditedArtists = (artist: string | null) => {
	if (!artist) return { lead: null, guests: [] as string[] };
	const [lead, ...guests] = artist
		.split(FEATURING)
		.filter((_, at) => at % 2 === 0)
		.map((part) => collapseRepeatedTag(part.trim()))
		.filter(Boolean);
	return { lead: lead ?? null, guests };
};

export interface Member {
	name: string;
	key: string;
	isGuest: boolean;
}

const NO_MEMBERS: readonly Member[] = [];

const partsOf = (credit: string): Member[] => {
	const featuring = FEATURING.exec(credit);
	const cut = featuring ? featuring.index : credit.length;
	const parts: Member[] = [];
	const add = (text: string, isGuest: boolean) => {
		for (const part of text.split(JOINER)) {
			const name = part.trim();
			if (name) parts.push({ name, key: tagKey(name), isGuest });
		}
	};
	add(credit.slice(0, cut), false);
	if (featuring) add(credit.slice(cut + featuring[0].length), true);
	return parts;
};

interface Tags {
	credit: readonly string[];
	names: readonly string[];
	ids: readonly string[];
}

const tagsOf = (columns: PageColumns): Tags[] => [
	{
		credit: columns.artist,
		names: columns.artists,
		ids: columns.artistIds,
	},
	{
		credit: columns.albumArtist,
		names: columns.albumArtists,
		ids: columns.albumArtistIds,
	},
];

interface Learned {
	idNames: Map<string, string>;
	standalone: Set<string>;
}

const soleNameOf = (credit: string | null) => {
	const { lead } = creditedArtists(credit);
	return lead ? collapseRepeatedTag(lead) : null;
};

function* learnSweep(columns: PageColumns): Sweep<Learned> {
	const idNames = new Map<string, string>();
	const standalone = new Set<string>();
	for (const { credit, ids } of tagsOf(columns)) {
		const soleNames: (string | null)[] = [];
		for (let ref = 0; ref < credit.length; ref += 1) {
			soleNames.push(soleNameOf(readValue(credit[ref])));
			if (ref % CHUNK === CHUNK - 1) yield;
		}
		for (const name of soleNames) if (name) standalone.add(tagKey(name));
		for (let ref = 0; ref < columns.trackCount; ref += 1) {
			if (ref % CHUNK === CHUNK - 1) yield;
			const raw = readValue(ids[ref]);
			if (raw === null || countOf(raw) !== 1 || idNames.has(raw)) continue;
			const name = soleNames[ref];
			if (name) idNames.set(raw, name);
		}
	}
	return { idNames, standalone };
}

const membersOf = (
	credit: string | null,
	names: string | null,
	ids: string | null,
	learned: Learned,
	guesses: boolean,
): readonly Member[] => {
	if (credit === null) return NO_MEMBERS;
	const parts = partsOf(credit);
	const guestKeys = new Set(
		parts.filter((part) => part.isGuest).map((part) => part.key),
	);

	if (names !== null && countOf(names) > 1)
		return valuesIn(names)
			.map((name) => name.trim())
			.filter(Boolean)
			.map((name) => {
				const key = tagKey(name);
				return { name, key, isGuest: guestKeys.has(key) };
			});

	const idList = ids === null ? [] : valuesIn(ids);
	if (idList.length === 1) return NO_MEMBERS;
	if (idList.length > 1) {
		if (parts.length === idList.length)
			return parts.map((part, at) => {
				const name = learned.idNames.get(idList[at]) ?? part.name;
				return { ...part, name, key: tagKey(name) };
			});
		return idList.flatMap((id) => {
			const name = learned.idNames.get(id);
			if (!name) return [];
			const key = tagKey(name);
			return [{ name, key, isGuest: guestKeys.has(key) }];
		});
	}

	if (!guesses || parts.length < 2) return NO_MEMBERS;
	return parts.filter((part) => learned.standalone.has(part.key));
};

export function* creditMembersSweep(columns: PageColumns, guesses: boolean) {
	const learned = yield* learnSweep(columns);
	const [artist, albumArtist] = tagsOf(columns);
	const mayGuess = (ref: number) =>
		guesses &&
		readValue(artist.ids[ref]) === null &&
		readValue(albumArtist.ids[ref]) === null;
	const reader =
		({ credit, names, ids }: Tags) =>
		(ref: number) =>
			membersOf(
				readValue(credit[ref]),
				readValue(names[ref]),
				readValue(ids[ref]),
				learned,
				mayGuess(ref),
			);
	return { artist: reader(artist), albumArtist: reader(albumArtist) };
}

export const creditMembers = (columns: PageColumns, guesses: boolean) =>
	runToEnd(creditMembersSweep(columns, guesses));

const groupOf =
	(values: readonly string[], groups: Map<string, number>) => (ref: number) =>
		groups.get(values[ref]) ?? -1;

export function* recordsSweep(columns: PageColumns) {
	const albums = tagGrouper();
	const albumOf = groupOf(
		columns.album,
		yield* albums.addBytewiseSweep(columns.album),
	);
	const artists = tagGrouper();
	const byAlbumArtist = groupOf(
		columns.albumArtist,
		yield* artists.addBytewiseSweep(columns.albumArtist),
	);
	const byArtist = groupOf(
		columns.artist,
		yield* artists.addBytewiseSweep(columns.artist),
	);
	const artistOf = (ref: number) => {
		const credited = byAlbumArtist(ref);
		return credited >= 0 ? credited : byArtist(ref);
	};
	return {
		albumOf,
		artistOf,
		albumGroup: albums.group,
		artistGroup: artists.group,
		albumNames: albums.names,
		artistNames: artists.names,
		recordOf: (ref: number) => {
			const album = albumOf(ref);
			return album < 0 ? null : `${album},${artistOf(ref)}`;
		},
	};
}

export const recordsOf = (columns: PageColumns) =>
	runToEnd(recordsSweep(columns));

export function* albumPageSweep(
	columns: PageColumns,
	artist: string | null,
	album: string,
): Sweep<Page> {
	const nothing = { refs: [], album, artist: null };
	if (!tagKey(album)) return nothing;

	const records = yield* recordsSweep(columns);
	const albumGroup = records.albumGroup(tagKey(album));
	if (albumGroup < 0) return nothing;
	const artistGroup = artist ? records.artistGroup(tagKey(artist)) : -1;

	const refs: number[] = [];
	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		if (ref % CHUNK === CHUNK - 1) yield;
		if (
			records.albumOf(ref) === albumGroup &&
			records.artistOf(ref) === artistGroup
		)
			refs.push(ref);
	}
	if (refs.length === 0) return nothing;

	return {
		refs,
		album: records.albumNames[albumGroup],
		artist: artistGroup < 0 ? null : records.artistNames[artistGroup],
	};
}

export function* artistPageSweep(
	columns: PageColumns,
	artist: string,
	guesses: boolean,
): Sweep<Credited> {
	const own: number[] = [];
	const shared: number[] = [];
	const guest: number[] = [];
	const wanted = tagKey(artist);
	if (!wanted) return { own, shared, guest };

	const members = yield* creditMembersSweep(columns, guesses);
	const names = (named: readonly Member[], isGuest: boolean) =>
		named.some((member) => member.key === wanted && member.isGuest === isGuest);
	const namedAt = (ref: number, isGuest: boolean) =>
		names(members.artist(ref), isGuest) ||
		names(members.albumArtist(ref), isGuest);

	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		if (ref % CHUNK === CHUNK - 1) yield;
		const credit = creditedArtists(readValue(columns.artist[ref]));
		const act = readValue(columns.albumArtist[ref]);
		if (
			tagKey(credit.lead) === wanted ||
			(act !== null && tagKey(collapseRepeatedTag(act)) === wanted)
		)
			own.push(ref);
		else if (namedAt(ref, false)) shared.push(ref);
		else if (
			credit.guests.some((name) => tagKey(name) === wanted) ||
			namedAt(ref, true)
		)
			guest.push(ref);
	}
	return { own, shared, guest };
}

export function* genrePageSweep(
	columns: PageColumns,
	genre: string,
): Sweep<number[]> {
	const wanted = tagKey(genre);
	if (!wanted) return [];

	const refs: number[] = [];
	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		if (ref % CHUNK === CHUNK - 1) yield;
		const raw = readValue(columns.genre[ref]);
		if (raw !== null && valuesIn(raw).some((one) => tagKey(one) === wanted))
			refs.push(ref);
	}
	return refs;
}
