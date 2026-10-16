import assert from "node:assert/strict";
import test from "node:test";

import { FIELD } from "../../src/domain/track/fields.ts";
import type { LibraryColumns } from "../../src/domain/track/libraryColumns.ts";
import {
	answerOf,
	patchedSearchCore,
	type SearchCore,
	searchCoreOf,
} from "../../src/domain/track/searchCore.ts";
import {
	type Change,
	columnsOf,
	freshKey,
	generatedLibrary,
	mainThreadAlbum,
	mainThreadArtist,
	mainThreadGenre,
	mainThreadSearch,
	pagesFor,
	patched,
	queriesFor,
	type SearchLibrary,
	seeded,
} from "./searchLibraries.ts";

const VARIANTS = [
	{ limit: 8, splitsCredits: true },
	{ limit: 1_000, splitsCredits: false },
];

const LIBRARIES = [
	{ name: "an empty library", seed: 1, tracks: 0, pages: 0 },
	{ name: "a small library", seed: 7, tracks: 400, pages: 12 },
	{ name: "a medium library", seed: 31, tracks: 20_000, pages: 10 },
];

const SMALL = 1_000;

const copyOf = (bytes: ArrayBuffer) => bytes.slice(0);

const listed = (refs: ArrayLike<number> | null | undefined) =>
	refs == null ? null : Array.from(refs);

const keys = (entities: readonly { key: string }[]) =>
	entities.map((entity) => entity.key);

function workerSearch(
	core: SearchCore,
	query: string,
	limit: number,
	splitsCredits: boolean,
) {
	const answer = answerOf(core, {
		kind: "search",
		query,
		limit,
		splitsCredits,
	});
	return {
		matched: listed(answer.matched),
		best: Array.from(answer.best),
		artists: keys(answer.artists),
		albums: keys(answer.albums),
		genres: keys(answer.genres),
		namesATrack: answer.namesATrack,
	};
}

function assertSearchesAgree(
	columns: LibraryColumns,
	core: SearchCore,
	queries: readonly string[],
	where: string,
) {
	const key = freshKey();
	const asked = queries.flatMap((query) =>
		VARIANTS.map((variant) => ({ query, ...variant })),
	);

	const expected = asked.map(({ query, limit, splitsCredits }) =>
		mainThreadSearch(columns, key, query, limit, splitsCredits),
	);
	const answered = asked.map(({ query, limit, splitsCredits }) =>
		workerSearch(core, query, limit, splitsCredits),
	);

	for (const [at, { query, limit, splitsCredits }] of asked.entries())
		assert.deepEqual(
			answered[at],
			expected[at],
			`${where}: ${JSON.stringify(query)}, limit ${limit}, ${splitsCredits ? "splitting" : "not splitting"} credits`,
		);
	return expected;
}

function assertPagesAgree(
	columns: LibraryColumns,
	core: SearchCore,
	pages: ReturnType<typeof pagesFor>,
	where: string,
) {
	for (const [artist, album] of pages.albums) {
		const answer = answerOf(core, { kind: "album", artist, album });
		assert.deepEqual(
			{ refs: listed(answer.refs), album: answer.album, artist: answer.artist },
			mainThreadAlbum(columns, artist, album),
			`${where}: the album ${JSON.stringify([artist, album])}`,
		);
	}

	for (const artist of pages.artists)
		for (const splitsCredits of [true, false]) {
			const answer = answerOf(core, { kind: "artist", artist, splitsCredits });
			assert.deepEqual(
				{
					own: listed(answer.own),
					shared: listed(answer.shared),
					guest: listed(answer.guest),
					all: listed(answer.all),
				},
				mainThreadArtist(columns, artist, splitsCredits),
				`${where}: the artist ${JSON.stringify(artist)}, ${splitsCredits ? "splitting" : "not splitting"} credits`,
			);
		}

	for (const genre of pages.genres)
		assert.deepEqual(
			listed(answerOf(core, { kind: "genre", genre })),
			mainThreadGenre(columns, genre),
			`${where}: the genre ${JSON.stringify(genre)}`,
		);
}

const built = LIBRARIES.map((shape) => {
	const library = generatedLibrary(shape.seed, shape.tracks);
	const random = seeded(shape.seed * 101);
	return {
		...shape,
		library,
		queries: queriesFor(library.rows, random),
		pages: pagesFor(library.rows, random, shape.pages),
	};
});

test("a search answers the refs the main thread's ranking gives, in its order, for any query", () => {
	const expected = built.flatMap(({ name, library, queries }) =>
		assertSearchesAgree(
			columnsOf(library.exported()),
			searchCoreOf(copyOf(library.exported())),
			queries,
			name,
		),
	);

	const reached = (part: (answer: (typeof expected)[number]) => boolean) =>
		expected.filter(part).length;
	assert.ok(
		reached((answer) => (answer.matched?.length ?? 0) > 8),
		"no query matched more than a preview",
	);
	assert.ok(
		reached((answer) => answer.artists.length > 0),
		"no query named an artist",
	);
	assert.ok(
		reached((answer) => answer.albums.length > 0),
		"no query named an album",
	);
	assert.ok(
		reached((answer) => answer.genres.length > 0),
		"no query named a genre",
	);
	assert.ok(
		reached((answer) => answer.namesATrack),
		"no query was a whole title",
	);
});

test("an album, artist or genre page holds the refs the main thread's sweep gives", () => {
	for (const { name, library, pages } of built)
		assertPagesAgree(
			columnsOf(library.exported()),
			searchCoreOf(copyOf(library.exported())),
			pages,
			name,
		);
});

function deltasFor(library: SearchLibrary): Change[][] {
	const random = seeded(library.rows.length + 5);
	const some = (count: number) =>
		Array.from({ length: count }, () =>
			Math.floor(random() * library.rows.length),
		);

	return [
		some(20).map((ordinal, at) => ({
			ordinal,
			field: FIELD.title,
			value: `Zafiro Relámpago ${at}`,
		})),
		some(10).flatMap((ordinal) => [
			{ ordinal, field: FIELD.album, value: "Ópalo Nuevo" },
			{ ordinal, field: FIELD.albumArtist, value: "Nadie Más" },
			{ ordinal, field: FIELD.artist, value: "Nadie Más feat. Björk" },
		]),
		some(10).map((ordinal) => ({
			ordinal,
			field: FIELD.genre,
			value: "Bossa\u001fRock",
		})),
		some(5).map((ordinal) => ({
			ordinal,
			field: FIELD.playCount,
			value: "999",
		})),
	];
}

const AFTER_DELTAS = [
	"zafiro",
	"relampago",
	"zafiro relámpago 3",
	"opalo",
	"nadie mas",
	"Nadie Más",
	"bjork",
	"bossa",
];

test("after each delta, the answers are the patched library's, as the main thread patches it", () => {
	for (const { name, library, queries, pages, tracks } of built) {
		if (tracks === 0) continue;

		let columns = columnsOf(library.exported());
		let core: SearchCore | null = searchCoreOf(copyOf(library.exported()));
		const deltas = deltasFor(library);
		const isCompared = (step: number) =>
			tracks <= SMALL || step === deltas.length - 1;

		for (const [step, changes] of deltas.entries()) {
			const delta = library.change(changes);
			columns = patched(columns, delta);
			core = patchedSearchCore(core, copyOf(delta));
			assert.ok(core, `${name}: delta ${step + 1} was refused`);
			if (!isCompared(step)) continue;

			assertSearchesAgree(
				columns,
				core,
				[...AFTER_DELTAS, ...queries.slice(0, 8)],
				`${name} after delta ${step + 1}`,
			);
			assertPagesAgree(
				columns,
				core,
				{
					albums: [["Nadie Más", "Ópalo Nuevo"], ...pages.albums.slice(0, 4)],
					artists: ["Nadie Más", "björk", ...pages.artists.slice(0, 4)],
					genres: ["Bossa", "rock", ...pages.genres.slice(0, 2)],
				},
				`${name} after delta ${step + 1}`,
			);
		}
	}
});
