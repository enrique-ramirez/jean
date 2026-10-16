import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";

import {
	type Album,
	albumIndex,
	albumsOf,
} from "../../src/domain/track/albums.ts";
import { FIELD } from "../../src/domain/track/fields.ts";
import { albumCanonicalIndex } from "../../src/domain/track/grouping.ts";
import { deriveIntensity } from "../../src/domain/track/intensity.ts";
import {
	canonicalPlayingArtworkUrl,
	librarySourceOf,
} from "../../src/domain/track/librarySource.ts";
import {
	type PathTable,
	pathCollector,
} from "../../src/domain/track/pathTable.ts";
import { generationKey } from "../../src/domain/track/playlistEntries.ts";
import { trackRows } from "../../src/domain/track/project.ts";
import { buildShelves } from "../../src/features/home/shelves.ts";
import { libraryArtworkUrl } from "../../src/shared/api/artwork.ts";
import {
	decodedSnapshot,
	type LoadedLibrary,
	loadedLibrary,
	type PlayLibrary,
	playLibrary,
	randomPlayDelta,
	seeded,
} from "./playDeltaLibrary.ts";

const SEEDS = Array.from({ length: 16 }, (_, at) => 1000 + at * 37);
const DELTAS_PER_SEED = 6;

interface Step {
	seed: number;
	step: number;
	library: PlayLibrary;
	loaded: LoadedLibrary;
	key: string;
	fresh: ReturnType<typeof decodedSnapshot>;
}

async function everyDelta(t: TestContext, check: (step: Step) => void) {
	for (const seed of SEEDS)
		await t.test(`seed ${seed}`, async (run) => {
			const random = seeded(seed);
			const library = playLibrary(random);
			const loaded = await loadedLibrary(run, library);
			const key = generationKey(loaded.key, library.structure);

			for (let step = 0; step < DELTAS_PER_SEED; step += 1) {
				await loaded.apply(randomPlayDelta(random, library));
				const fresh = decodedSnapshot(library.rebuilt());
				check({ seed, step, library, loaded, key, fresh });
			}
		});
}

const where = ({ seed, step }: Step) => `seed ${seed}, delta ${step + 1}`;

test("heat, patina and the played count after any play delta are what a rebuild gives", async (t) => {
	await everyDelta(t, (step) => {
		const held = step.loaded.snapshot();
		const rebuilt = deriveIntensity(step.fresh.columns);

		assert.deepEqual(held.heat, rebuilt.heat, `heat, ${where(step)}`);
		assert.deepEqual(held.patina, rebuilt.patina, `patina, ${where(step)}`);
		assert.equal(
			held.playedCount,
			rebuilt.playedCount,
			`played, ${where(step)}`,
		);
	});
});

test("the album index after any play delta is what a rebuild gives", async (t) => {
	await everyDelta(t, (step) => {
		assert.deepEqual(
			albumIndex(step.key, step.loaded.snapshot().columns),
			albumsOf(trackRows(step.fresh.columns)),
			where(step),
		);
	});
});

const shelvesOf = (albums: Album[]) => {
	const random = mock.method(Math, "random", seeded(5));
	try {
		return buildShelves(albums, null);
	} finally {
		random.mock.restore();
	}
};

test("Home's shelves after any play delta are what a rebuild gives", async (t) => {
	await everyDelta(t, (step) => {
		assert.deepEqual(
			shelvesOf(albumIndex(step.key, step.loaded.snapshot().columns)),
			shelvesOf(albumsOf(trackRows(step.fresh.columns))),
			where(step),
		);
	});
});

const creditedOf = (row: string[]) =>
	row[FIELD.albumArtist] === "?" ? row[FIELD.artist] : row[FIELD.albumArtist];

test("the status bar's cover after any play delta is the one a rebuild picks", async (t) => {
	await everyDelta(t, (step) => {
		const rebuilt = albumCanonicalIndex(step.fresh.columns);
		const { origin } = step.loaded;

		for (const row of step.library.rows) {
			const album = row[FIELD.album];
			const credited = creditedOf(row);
			const ref = rebuilt.refFor(album, credited);
			assert.equal(
				canonicalPlayingArtworkUrl(origin, album, credited),
				ref === null
					? null
					: libraryArtworkUrl(origin, step.fresh.paths.at(ref)),
				`${album} by ${credited}, ${where(step)}`,
			);
		}
	});
});

const ROOT = "D:\\Music\\";

const absolute = (relative: string) => ROOT + relative.replaceAll("/", "\\");

const pathTableOf = (paths: readonly string[]) => {
	const collector = pathCollector();
	for (const path of paths) collector.add(path);
	return collector.table();
};

const countingReads = (paths: PathTable) => {
	const counted = { reads: 0, table: paths };
	counted.table = {
		length: paths.length,
		at: (index) => {
			counted.reads += 1;
			return paths.at(index);
		},
	};
	return counted;
};

const sourceOver = (
	paths: readonly string[],
	subsongs: readonly number[],
	table: PathTable = pathTableOf(paths),
) =>
	librarySourceOf({
		kind: "library",
		paths: table,
		subsongs: Int32Array.from(subsongs),
		artworkOrigin: null,
	});

const everyRef = (count: number) =>
	Int32Array.from({ length: count }, (_, at) => at);

test("the playing track is found at its place in the view it is listed in", () => {
	const library = playLibrary(seeded(3));
	const source = sourceOver(library.paths, library.subsongs);
	const ordinal = 20;
	const track = {
		path: absolute(library.paths[ordinal]),
		subsong: library.subsongs[ordinal],
	};

	assert.equal(
		source.playingPosition(everyRef(library.paths.length), track),
		ordinal,
	);

	const sorted = Int32Array.of(31, 4, ordinal, 9);
	assert.equal(source.playingPosition(sorted, track), 2);
	assert.equal(source.playingPosition(Int32Array.of(31, 4, 9), track), -1);
});

test("the playing subsong of a cue sheet is told from its siblings", () => {
	const library = playLibrary(seeded(3));
	const source = sourceOver(library.paths, library.subsongs);
	const cue = library.subsongs.indexOf(2);
	assert.ok(cue > 0, "the library holds no cue sheet");

	const refs = Int32Array.of(cue, cue - 1, cue + 1);
	assert.equal(
		source.playingPosition(refs, {
			path: absolute(library.paths[cue]),
			subsong: 2,
		}),
		0,
	);
	assert.equal(
		source.playingPosition(refs, {
			path: absolute(library.paths[cue]),
			subsong: 1,
		}),
		1,
	);
});

test("a track the library does not hold, or no track, has no place", () => {
	const library = playLibrary(seeded(3));
	const source = sourceOver(library.paths, library.subsongs);
	const refs = everyRef(library.paths.length);

	assert.equal(
		source.playingPosition(refs, {
			path: `${ROOT}Elsewhere\\Not here.flac`,
			subsong: 0,
		}),
		-1,
	);
	assert.equal(source.playingPosition(refs, null), -1);
	assert.equal(source.playingPosition(refs, { path: "", subsong: 0 }), -1);
});

const LARGE = 200_000;

test("finding the playing track reads a handful of paths, not the library", () => {
	const paths = Array.from(
		{ length: LARGE },
		(_, at) => `Artist ${at % 500}/Record ${at % 9000}/${at} Song.flac`,
	);
	const counted = countingReads(pathTableOf(paths));
	const source = sourceOver(paths, new Array(LARGE).fill(0), counted.table);
	const refs = everyRef(LARGE);

	source.playingPosition(refs, { path: absolute(paths[17]), subsong: 0 });

	counted.reads = 0;
	const later = LARGE - 3;
	assert.equal(
		source.playingPosition(refs, { path: absolute(paths[later]), subsong: 0 }),
		later,
	);
	assert.ok(counted.reads < 16, `${counted.reads} paths read for one lookup`);
});
