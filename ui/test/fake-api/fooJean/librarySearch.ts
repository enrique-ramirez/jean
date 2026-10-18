import { compareUtf8 } from "../jlib.ts";
import {
	collapseRepeatedTag,
	creditedArtists,
	creditMembers,
	type PageColumns,
	recordsOf,
	valuesIn,
} from "./libraryPages.ts";
import { readValue, tagGrouper, tagKey } from "./librarySummary.ts";

export interface SearchedLibrary extends PageColumns {
	paths: readonly string[];
}

export interface SearchAsked {
	query: string;
	limit: number;
	entityLimit: number;
	splitsCredits: boolean;
}

export interface Section<Entity> {
	total: number;
	top: Entity[];
}

export interface NamedArtist {
	name: string;
	trackCount: number;
	guestCount: number;
	albumCount: number;
	cover: string | null;
}

export interface NamedAlbum {
	album: string;
	artist: string | null;
	trackCount: number;
	cover: string | null;
}

export interface NamedGenre {
	name: string;
	trackCount: number;
}

export interface Searched {
	matched: number[] | null;
	best: number[];
	artists: Section<NamedArtist>;
	albums: Section<NamedAlbum>;
	genres: Section<NamedGenre>;
	namesATrack: boolean;
}

const fold = (text: string) =>
	text
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "");

const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

const squash = (text: string) => fold(text).replace(NOT_ALPHANUMERIC, "");

const tokenize = (query: string) =>
	fold(query.trim()).split(/\s+/).filter(Boolean);

const MAX_CLOSENESS = 999;

// Lengths are in UTF-16 code units, as JavaScript counts them.
const closenessTo = (text: string, query: string) =>
	Math.max(0, MAX_CLOSENESS - Math.abs(text.length - query.length));

const TITLE_WEIGHT = 1;
const ARTIST_WEIGHT = 0.85;
const ALBUM_WEIGHT = 0.6;

const TRACK_EXACT = 4000;
const TRACK_PREFIX = 3000;
const TRACK_WORD = 2000;
const TRACK_SUBSTRING = 1000;

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

const fieldScore = (text: string, token: string) => {
	const first = text.indexOf(token);
	if (first < 0) return 0;

	const closeness = closenessTo(text, token);
	if (first === 0)
		return (
			(text.length === token.length ? TRACK_EXACT : TRACK_PREFIX) + closeness
		);

	for (let at = first; at >= 0; at = text.indexOf(token, at + 1))
		if (!WORD_CHARACTER.test(text[at - 1])) return TRACK_WORD + closeness;

	return TRACK_SUBSTRING + closeness;
};

const ENTITY_EXACT = 6000;
const ENTITY_PREFIX = 5000;
const ENTITY_WORD = 4000;

interface FuzzyKey {
	squashed: string;
	words: string[];
}

const fuzzyKey = (text: string): FuzzyKey => ({
	squashed: squash(text),
	words: fold(text).split(NOT_ALPHANUMERIC).filter(Boolean),
});

const entityScore = ({ squashed, words }: FuzzyKey, query: string) => {
	const closeness = closenessTo(squashed, query);
	if (squashed === query) return ENTITY_EXACT + closeness;
	if (squashed.startsWith(query)) return ENTITY_PREFIX + closeness;
	if (words.some((word) => word.startsWith(query)))
		return ENTITY_WORD + closeness;
	return 0;
};

const ranked = <Entity extends { match: FuzzyKey; trackCount: number }>(
	entities: Entity[],
	query: string,
): Omit<Entity, "match">[] => {
	const squashed = squash(query);
	if (squashed.length === 0) return [];
	return entities
		.map((entity) => ({ entity, score: entityScore(entity.match, squashed) }))
		.filter(({ score }) => score >= ENTITY_WORD)
		.sort(
			(a, b) => b.score - a.score || b.entity.trackCount - a.entity.trackCount,
		)
		.map(({ entity: { match, ...named } }) => named);
};

const NOT_AN_ARTIST = new Set(["various artists", "various", "va"]);

const namesAnArtist = (name: string | null | undefined) => {
	const key = tagKey(name);
	return key.length > 0 && !NOT_AN_ARTIST.has(key);
};

const positiveInteger = (raw: string) => {
	const text = readValue(raw);
	if (text === null) return null;
	const parsed = Number.parseInt(text, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const foldedColumn = (values: readonly string[]) => {
	const known = new Map<string, string>();
	return values.map((raw) => {
		let text = known.get(raw);
		if (text === undefined) {
			text = fold(raw);
			known.set(raw, text);
		}
		return text;
	});
};

const bestOf = (
	matched: readonly number[],
	score: (ref: number) => number,
	limit: number,
) => {
	if (limit < 1) return [];
	const scored = matched.map((ref, position) => ({
		ref,
		position,
		score: score(ref),
	}));
	scored.sort((a, b) => b.score - a.score || a.position - b.position);
	return scored.slice(0, limit).map(({ ref }) => ref);
};

const canonicalOf = (
	columns: SearchedLibrary,
	recordOf: (ref: number) => string | null,
) => {
	const lowest = new Map<string, readonly [number, number, number]>();
	const records: (string | null)[] = [];
	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		const record = recordOf(ref);
		records.push(record);
		if (record === null) continue;
		const order = [
			positiveInteger(columns.discNumber[ref]) ?? 0,
			positiveInteger(columns.trackNumber[ref]) ?? 0,
			ref,
		] as const;
		const held = lowest.get(record);
		if (
			!held ||
			order[0] < held[0] ||
			(order[0] === held[0] && order[1] < held[1])
		)
			lowest.set(record, order);
	}
	return (ref: number) => {
		const record = records[ref];
		return record === null ? ref : (lowest.get(record)?.[2] ?? ref);
	};
};

const albumsFor = (
	columns: SearchedLibrary,
	canonical: (ref: number) => number,
	records: ReturnType<typeof recordsOf>,
) => {
	const drafts = new Map<
		string,
		{
			album: string;
			artist: string | null;
			match: FuzzyKey;
			trackCount: number;
			first: number;
		}
	>();
	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		const record = records.recordOf(ref);
		if (record === null) continue;
		const held = drafts.get(record);
		if (held) {
			held.trackCount += 1;
			continue;
		}
		const album = records.albumNames[records.albumOf(ref)];
		const artistGroup = records.artistOf(ref);
		drafts.set(record, {
			album,
			artist: artistGroup < 0 ? null : records.artistNames[artistGroup],
			match: fuzzyKey(album),
			trackCount: 1,
			first: ref,
		});
	}
	return [...drafts.values()].map(
		({ album, artist, match, trackCount, first }) => ({
			album,
			artist,
			match,
			trackCount,
			cover: columns.paths[canonical(first)],
		}),
	);
};

const artistsFor = (
	columns: SearchedLibrary,
	guesses: boolean,
	canonical: (ref: number) => number,
) => {
	const members = creditMembers(columns, guesses);
	const drafts = new Map<
		string,
		{
			name: string;
			match: FuzzyKey;
			trackCount: number;
			guestCount: number;
			albums: Map<string, number>;
		}
	>();
	const named = (name: string) => ({ key: tagKey(name), name });

	const credit = (
		{ key, name }: { key: string; name: string },
		ref: number,
		albumKey: string | null,
		isGuest: boolean,
	) => {
		let draft = drafts.get(key);
		if (!draft) {
			draft = {
				name,
				match: fuzzyKey(name),
				trackCount: 0,
				guestCount: 0,
				albums: new Map(),
			};
			drafts.set(key, draft);
		}
		if (isGuest) draft.guestCount += 1;
		else draft.trackCount += 1;
		if (albumKey && !draft.albums.has(albumKey))
			draft.albums.set(albumKey, ref);
	};

	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		const credited = creditedArtists(readValue(columns.artist[ref]));
		const creditedLeads =
			credited.lead && namesAnArtist(credited.lead)
				? [named(credited.lead)]
				: [];
		const creditedGuests = credited.guests.filter(namesAnArtist).map(named);

		const tag = readValue(columns.albumArtist[ref]);
		const act = tag === null ? "" : collapseRepeatedTag(tag);
		const actLeads = tag !== null && namesAnArtist(act) ? [named(act)] : [];

		const albumName = readValue(columns.album[ref]);
		const albumKey = albumName ? tagKey(albumName) : null;

		const leads = new Map<string, string>();
		const shared = [...members.artist(ref), ...members.albumArtist(ref)];
		for (const lead of [
			...creditedLeads,
			...actLeads,
			...shared.filter((member) => !member.isGuest),
		])
			if (!leads.has(lead.key)) leads.set(lead.key, lead.name);

		for (const [key, name] of leads)
			credit({ key, name }, ref, albumKey, false);

		const seen = new Set(leads.keys());
		for (const guest of [
			...creditedGuests,
			...shared.filter((member) => member.isGuest),
		]) {
			if (seen.has(guest.key)) continue;
			seen.add(guest.key);
			credit(guest, ref, albumKey, true);
		}
	}

	return [...drafts.values()]
		.map((draft) => {
			const [firstAlbumTrack] = draft.albums.values();
			return {
				name: draft.name,
				match: draft.match,
				trackCount: draft.trackCount,
				guestCount: draft.guestCount,
				albumCount: draft.albums.size,
				cover:
					firstAlbumTrack === undefined
						? null
						: columns.paths[canonical(firstAlbumTrack)],
			};
		})
		.sort((a, b) => b.trackCount - a.trackCount);
};

const genresFor = (columns: SearchedLibrary) => {
	const groups = tagGrouper();
	const groupsOf = new Map<string, number[]>();
	for (const raw of [
		...new Set(columns.genre.filter((one) => readValue(one) !== null)),
	].sort(compareUtf8))
		groupsOf.set(raw, [
			...new Set(
				valuesIn(raw)
					.filter((genre) => tagKey(genre) !== "")
					.map(groups.add),
			),
		]);
	const drafts = new Map<
		string,
		{ name: string; match: FuzzyKey; trackCount: number }
	>();
	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		for (const group of groupsOf.get(columns.genre[ref]) ?? []) {
			const name = groups.names[group];
			const key = tagKey(name);
			let draft = drafts.get(key);
			if (!draft) {
				draft = { name, match: fuzzyKey(name), trackCount: 0 };
				drafts.set(key, draft);
			}
			draft.trackCount += 1;
		}
	}
	// JavaScript compares strings by UTF-16 code unit, which is the order the cases freeze.
	return [...drafts.entries()]
		.sort(
			([a, one], [b, other]) =>
				other.trackCount - one.trackCount || (a < b ? -1 : a > b ? 1 : 0),
		)
		.map(([, draft]) => draft);
};

const nothing = (): Searched => ({
	matched: null,
	best: [],
	artists: { total: 0, top: [] },
	albums: { total: 0, top: [] },
	genres: { total: 0, top: [] },
	namesATrack: false,
});

const sectionOf = <Entity>(
	entities: Entity[],
	entityLimit: number,
): Section<Entity> => ({
	total: entities.length,
	top: entities.slice(0, entityLimit),
});

export const searchPage = (
	columns: SearchedLibrary,
	{ query, limit, entityLimit, splitsCredits }: SearchAsked,
): Searched => {
	if (columns.trackCount === 0) return nothing();

	const wanted = query.trim();
	const tokens = tokenize(query);
	const titles = foldedColumn(columns.title);
	const fields = [
		{ text: titles, weight: TITLE_WEIGHT },
		{ text: foldedColumn(columns.artist), weight: ARTIST_WEIGHT },
		{ text: foldedColumn(columns.albumArtist), weight: ARTIST_WEIGHT },
		{ text: foldedColumn(columns.album), weight: ALBUM_WEIGHT },
	];

	let matched: number[] | null = null;
	if (tokens.length > 0) {
		matched = [];
		for (let ref = 0; ref < columns.trackCount; ref += 1)
			if (
				tokens.every((token) =>
					fields.some((field) => field.text[ref].includes(token)),
				)
			)
				matched.push(ref);
	}

	const best =
		matched === null
			? []
			: bestOf(
					matched,
					(ref) =>
						tokens.reduce(
							(total, token) =>
								total +
								fields.reduce(
									(top, field) =>
										Math.max(
											top,
											fieldScore(field.text[ref], token) * field.weight,
										),
									0,
								),
							0,
						),
					limit,
				);

	const records = recordsOf(columns);
	const canonical = canonicalOf(columns, records.recordOf);
	const folded = fold(wanted);

	return {
		matched,
		best,
		artists: sectionOf(
			wanted
				? ranked(artistsFor(columns, splitsCredits, canonical), wanted)
				: [],
			entityLimit,
		),
		albums: sectionOf(
			wanted ? ranked(albumsFor(columns, canonical, records), wanted) : [],
			entityLimit,
		),
		genres: sectionOf(
			wanted ? ranked(genresFor(columns), wanted) : [],
			entityLimit,
		),
		namesATrack:
			wanted !== "" &&
			matched !== null &&
			matched.some((ref) => titles[ref] === folded),
	};
};
