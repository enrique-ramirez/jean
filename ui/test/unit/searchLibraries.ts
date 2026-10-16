import { artistIndex, refsOfArtist } from "../../src/domain/artist/artists.ts";
import { albumIndex, refsOfAlbum } from "../../src/domain/track/albums.ts";
import {
	FIELD,
	TRACK_EXPRESSIONS,
	tagKey,
} from "../../src/domain/track/fields.ts";
import { genreIndex } from "../../src/domain/track/genres.ts";
import type { LibraryColumns } from "../../src/domain/track/libraryColumns.ts";
import {
	libraryIndex,
	searchLibrary,
} from "../../src/domain/track/libraryIndex.ts";
import {
	librarySnapshotOf,
	patchedColumns,
} from "../../src/domain/track/librarySnapshot.ts";
import { refsOfGenre } from "../../src/domain/track/project.ts";
import { rankEntities } from "../../src/domain/track/rankEntities.ts";
import { bestMatches } from "../../src/domain/track/rankTracks.ts";
import { decodeJlib } from "../../src/shared/api/jlib.ts";
import { fold, TIER } from "../../src/shared/lib/text.ts";
import {
	changedColumn,
	type Dictionary,
	dictionary,
	encodeJlib,
	wholeColumn,
} from "../fake-api/jlib.ts";
import { type Random, seeded } from "./playDeltaLibrary.ts";

export { seeded };

const SEPARATOR = "\u001f";
const UNRESOLVED = "?";

const below = (random: Random, count: number) => Math.floor(random() * count);
const pick = <T>(random: Random, from: readonly T[]): T =>
	from[below(random, from.length)];

const WORDS = [
	"Sueño",
	"Canción",
	"Corazón",
	"Blue",
	"Night",
	"Árbol",
	"Fuego",
	"Lluvia",
	"Ñandú",
	"River",
	"Stone",
	"Glass",
	"Über",
	"Mañana",
	"Deléctrico",
	"Café",
	"Light",
	"Song",
	"Noche",
	"Rêve",
	"Blood",
	"Bloodhail",
	"Youngblood",
];

const NAMED_ARTISTS = [
	"Babasónicos",
	"Soda Stereo",
	"Los Planetas",
	"Björk",
	"Sigur Rós",
	"Mogwai",
	"Alice in Chains",
	"The Placeholders",
	"Café Tacvba",
	"Zoé",
];

const GENRES = [
	"Rock",
	"Rock en Español",
	"Post-Rock",
	"Shoegaze",
	"Jazz",
	"Electrónica",
	`Rock${SEPARATOR}Pop`,
	`Shoegaze${SEPARATOR}Dream Pop`,
	UNRESOLVED,
];

const COMPILATION = "Various Artists";

export interface SearchLibrary {
	readonly rows: string[][];
	exported: () => ArrayBuffer;
	change: (changes: readonly Change[]) => ArrayBuffer;
}

export interface Change {
	ordinal: number;
	field: number;
	value: string;
}

const bufferOf = (bytes: Uint8Array) =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;

const pad = (part: number) => String(part).padStart(2, "0");

function artistPool(random: Random, size: number): string[] {
	const pool = [...NAMED_ARTISTS];
	while (pool.length < size)
		pool.push(`${pick(random, WORDS)} ${pick(random, WORDS)} ${pool.length}`);
	return pool;
}

function creditOf(random: Random, lead: string, pool: readonly string[]) {
	const roll = random();
	const other = pick(random, pool);
	if (other === lead || roll > 0.2) return { credit: lead, names: "" };
	if (roll < 0.1)
		return {
			credit: `${lead} feat. ${other}`,
			names: `${lead}${SEPARATOR}${other}`,
		};
	if (roll < 0.15)
		return {
			credit: `${lead} & ${other}`,
			names: `${lead}${SEPARATOR}${other}`,
		};
	return { credit: `${lead}, ${other}`, names: "" };
}

function emptyRow(): string[] {
	return new Array(TRACK_EXPRESSIONS.length).fill(UNRESOLVED);
}

export function generatedRows(random: Random, tracks: number): string[][] {
	const pool = artistPool(random, Math.max(12, Math.ceil(tracks / 60)));
	const rows: string[][] = [];

	let album = 0;
	while (rows.length < tracks) {
		album += 1;
		const isCompilation = album % 13 === 6;
		const lead = pick(random, pool);
		const name =
			album % 17 === 3
				? `${WORDS[album % WORDS.length]} Sessions`
				: `${pick(random, WORDS)} ${pick(random, WORDS)}`;
		const albumArtist = isCompilation
			? COMPILATION
			: album % 5 === 0
				? UNRESOLVED
				: album % 23 === 7
					? lead.toUpperCase()
					: lead;
		const genre = pick(random, GENRES);
		const year = String(1960 + below(random, 65));
		const count = Math.min(1 + below(random, 14), tracks - rows.length);

		for (let track = 1; track <= count; track += 1) {
			const performer = isCompilation ? pick(random, pool) : lead;
			const { credit, names } = creditOf(random, performer, pool);
			const words = 1 + below(random, 4);
			const title = Array.from({ length: words }, () =>
				pick(random, WORDS),
			).join(" ");

			const row = emptyRow();
			row[FIELD.trackNumber] = pad(track);
			row[FIELD.title] = random() < 0.1 ? `${title} ${track}` : title;
			row[FIELD.artist] = credit;
			row[FIELD.album] = album % 29 === 11 ? UNRESOLVED : name;
			row[FIELD.albumArtist] = albumArtist;
			row[FIELD.genre] = genre;
			row[FIELD.year] = year;
			row[FIELD.duration] = String(90 + below(random, 400));
			row[FIELD.codec] = pick(random, ["FLAC", "MP3", "AAC"]);
			row[FIELD.bitrate] = row[FIELD.codec] === "FLAC" ? "900" : "256";
			row[FIELD.playCount] = String(below(random, 60));
			row[FIELD.added] =
				`2024-0${1 + below(random, 9)}-1${below(random, 9)} 10:00:00`;
			row[FIELD.artists] = names;
			row[FIELD.artistIds] = "";
			row[FIELD.albumArtists] = "";
			row[FIELD.albumArtistIds] = "";
			rows.push(row);
		}
	}

	return rows;
}

export function searchLibraryOf(rows: string[][]): SearchLibrary {
	const structure = 3;
	let revision = 10;
	const dictionaries = TRACK_EXPRESSIONS.map(() => dictionary());
	const spine = (values: string[]) => wholeColumn(null, dictionary(), values);

	const exported = bufferOf(
		encodeJlib({
			kind: "snapshot",
			structure,
			revision,
			trackCount: rows.length,
			columns: TRACK_EXPRESSIONS.map((expression, field) =>
				wholeColumn(
					expression,
					dictionaries[field],
					rows.map((row) => row[field]),
				),
			),
			spine: {
				directory: spine(rows.map((row) => `Music/${row[FIELD.album]}/`)),
				filename: spine(rows.map((_, ordinal) => `${ordinal}.flac`)),
				subsong: spine(rows.map(() => "0")),
			},
		}),
	);

	return {
		rows,
		exported: () => exported,
		change: (changes) => {
			const since = revision;
			const bases = dictionaries.map((held: Dictionary) => held.values.length);
			const byField = new Map<number, Map<number, string>>();
			for (const { ordinal, field, value } of changes) {
				rows[ordinal][field] = value;
				const moved = byField.get(field) ?? new Map<number, string>();
				moved.set(ordinal, value);
				byField.set(field, moved);
			}
			revision += 1;

			return bufferOf(
				encodeJlib({
					kind: "delta",
					structure,
					revision,
					since,
					trackCount: rows.length,
					columns: [...byField].map(([field, moved]) =>
						changedColumn(
							TRACK_EXPRESSIONS[field],
							dictionaries[field],
							bases[field],
							[...moved]
								.sort(([a], [b]) => a - b)
								.map(([ordinal, value]) => ({ ordinal, value })),
						),
					),
					spine: {},
				}),
			);
		},
	};
}

export const generatedLibrary = (seed: number, tracks: number) =>
	searchLibraryOf(generatedRows(seeded(seed), tracks));

export function columnsOf(exported: ArrayBuffer): LibraryColumns {
	const library = decodeJlib(exported);
	if (library.kind !== "snapshot") throw new Error("not a snapshot");
	return librarySnapshotOf(library, TRACK_EXPRESSIONS).columns;
}

export function patched(
	held: LibraryColumns,
	delta: ArrayBuffer,
): LibraryColumns {
	const decoded = decodeJlib(delta);
	if (decoded.kind !== "delta") throw new Error("not a delta");
	const columns = patchedColumns(held, decoded, TRACK_EXPRESSIONS);
	if (!columns) throw new Error("the delta does not apply to these columns");
	return columns;
}

const SECTION_FLOOR = TIER.word;

export interface MainSearch {
	matched: number[] | null;
	best: number[];
	artists: string[];
	albums: string[];
	genres: string[];
	namesATrack: boolean;
}

let generation = 0;

export const freshKey = () => {
	generation += 1;
	return `search-oracle:${generation}`;
};

export function mainThreadSearch(
	columns: LibraryColumns,
	key: string,
	query: string,
	limit: number,
	splitsCredits: boolean,
): MainSearch {
	if (columns.trackCount === 0)
		return {
			matched: null,
			best: [],
			artists: [],
			albums: [],
			genres: [],
			namesATrack: false,
		};

	const index = libraryIndex(key, columns);
	const matched = searchLibrary(index, columns.trackCount, query);
	const best = matched
		? bestMatches(index, matched, query, limit).map(
				(position) => matched[position],
			)
		: [];

	const wanted = query.trim();
	const keys = (entities: { key: string }[]) =>
		entities.map((entity) => entity.key);
	const folded = fold(wanted);

	return {
		matched: matched ? [...matched] : null,
		best,
		artists: wanted
			? keys(
					rankEntities(
						artistIndex(key, columns, splitsCredits),
						wanted,
						SECTION_FLOOR,
					),
				)
			: [],
		albums: wanted
			? keys(rankEntities(albumIndex(key, columns), wanted, SECTION_FLOOR))
			: [],
		genres: wanted
			? keys(rankEntities(genreIndex(key, columns), wanted, SECTION_FLOOR))
			: [],
		namesATrack:
			wanted !== "" &&
			matched !== null &&
			matched.some((ref) => index.title.text(ref) === folded),
	};
}

export const mainThreadAlbum = (
	columns: LibraryColumns,
	artist: string | null,
	album: string,
) => {
	const found = refsOfAlbum(columns, artist, album);
	return { refs: [...found.refs], album: found.album, artist: found.artist };
};

export const mainThreadArtist = (
	columns: LibraryColumns,
	artist: string,
	splitsCredits: boolean,
) => {
	const found = refsOfArtist(columns, artist, splitsCredits);
	return {
		own: [...found.own],
		shared: [...found.shared],
		guest: [...found.guest],
		all: [...found.all],
	};
};

export const mainThreadGenre = (columns: LibraryColumns, genre: string) => [
	...refsOfGenre(columns, genre),
];

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

const resolved = (rows: string[][], field: number) =>
	[
		...new Set(rows.map((row) => row[field]).filter((v) => v !== UNRESOLVED)),
	].sort();

const stripped = (text: string) =>
	text.normalize("NFD").replace(/\p{Diacritic}/gu, "");

export function queriesFor(rows: string[][], random: Random): string[] {
	if (rows.length === 0) return ["", "a", "blue", "zzqxj"];

	const row = () => pick(random, rows);
	const titles = resolved(rows, FIELD.title);
	const artists = rows.map((r) => r[FIELD.artist]);
	const albums = resolved(rows, FIELD.album);
	const genres = resolved(rows, FIELD.genre).flatMap((g) => g.split(SEPARATOR));

	const queries = [
		"",
		"   ",
		"a",
		"e",
		"S",
		"zzqxj",
		"qwxz kk",
		"  song   blue ",
	];

	for (let at = 0; at < 6; at += 1) {
		const title = pick(random, titles);
		queries.push(title.slice(0, 1 + below(random, 6)).toLowerCase());
	}
	for (let at = 0; at < 4; at += 1) {
		const word = pick(random, wordsOf(pick(random, titles)));
		queries.push(at % 2 ? word.toUpperCase() : word);
	}
	for (let at = 0; at < 3; at += 1) {
		const one = row();
		const title = pick(random, wordsOf(one[FIELD.title]));
		const artist = pick(random, wordsOf(one[FIELD.artist]));
		const album = pick(random, wordsOf(one[FIELD.album]));
		queries.push(
			`${title} ${artist}`,
			`${artist} ${album}`,
			`${album} ${title}`,
		);
	}

	const accented = [...artists, ...titles].find(
		(text) => stripped(text) !== text,
	);
	if (accented)
		queries.push(accented, stripped(accented), accented.toUpperCase());

	const artist = pick(random, NAMED_ARTISTS);
	queries.push(
		artist,
		artist.toLowerCase(),
		`${artist.slice(0, -2)}${artist.at(-1)}${artist.at(-2)}`,
		COMPILATION,
		pick(random, albums),
		pick(random, genres),
		pick(random, titles),
	);

	return queries;
}

export interface PageQuestions {
	albums: [artist: string | null, album: string][];
	artists: string[];
	genres: string[];
}

const leadOf = (credit: string) => credit.split(/ feat\. | & |, /)[0];

export function pagesFor(
	rows: string[][],
	random: Random,
	count: number,
): PageQuestions {
	const albums: [string | null, string][] = [
		[null, "Nothing Called This"],
		["Nobody", "Nothing Called This"],
	];
	const artists = ["Nobody At All", COMPILATION, ""];
	const genres = ["Nothing Like This", "rock", "pop", "Dream Pop", UNRESOLVED];

	for (let at = 0; at < count && rows.length > 0; at += 1) {
		const row = pick(random, rows);
		const albumArtist = row[FIELD.albumArtist];
		const artist =
			albumArtist === UNRESOLVED ? leadOf(row[FIELD.artist]) : albumArtist;
		albums.push([artist, row[FIELD.album]]);
		albums.push([tagKey(artist), tagKey(row[FIELD.album])]);

		const credit = row[FIELD.artist];
		artists.push(leadOf(credit));
		const guest = credit.split(" feat. ")[1];
		if (guest) artists.push(guest.toLowerCase());

		genres.push(...row[FIELD.genre].split(SEPARATOR));
	}

	return { albums, artists, genres };
}
