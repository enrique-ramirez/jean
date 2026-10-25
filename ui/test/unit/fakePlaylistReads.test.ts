import assert from "node:assert/strict";
import test from "node:test";
import { COMPONENT_RATE_LIMITS } from "../fake-api/fooJean/rateLimits.ts";
import { GENERATION_SEED } from "../fake-api/state.ts";
import {
	ask,
	bodyOf,
	type FakeState,
	frozenAt,
	ROLES,
	refusalOf,
	tooFast,
	withRole,
} from "./fakeLibraryHarness.ts";
import { MIXED, mixedState, UNKNOWN_PLAYLIST } from "./fakePlaylistHarness.ts";

const SEED = String(GENERATION_SEED);
const PHONE = "192.168.1.20";
const LAPTOP = "192.168.1.21";

const itemsQuery = (
	roles: [string, string][] = [],
	columns = ["%title%"],
): [string, string][] => [
	["offset", "0"],
	["count", "12"],
	...columns.map((column): [string, string] => ["columns", column]),
	...roles,
];

const changesQuery = (
	roles: [string, string][] = [],
	{ structure = SEED, since = SEED } = {},
): [string, string][] => [
	["structure", structure],
	["since", since],
	["columns", "%title%"],
	...roles,
];

const askItems = (
	state: FakeState,
	{
		guid = MIXED,
		roles = [] as [string, string][],
		columns = ["%title%"],
		client = PHONE,
	} = {},
) =>
	ask(state, `/api/playlists/${guid}/items`, {
		query: itemsQuery(roles, columns),
		client,
	});

const askChanges = (
	state: FakeState,
	{ guid = MIXED, roles = [] as [string, string][], client = PHONE } = {},
) =>
	ask(state, `/api/playlists/${guid}/items/changes`, {
		query: changesQuery(roles),
		client,
	});

const askQueue = (state: FakeState, roles: [string, string][] = []) =>
	ask(state, "/api/queue", { query: roles });

const limited = () => mixedState({ rateLimits: COMPONENT_RATE_LIMITS });

test("a client's 31st playlist row read inside 100 ms is 429 too many playlist row reads, with Retry-After", async (t) => {
	frozenAt(t);
	const state = limited();

	for (let request = 1; request <= 30; request += 1)
		assert.equal((await askItems(state)).status, 200, `request ${request}`);

	assert.deepEqual(tooFast(await askItems(state)), {
		status: 429,
		body: { error: "too many playlist row reads" },
		waits: true,
	});
	assert.equal(state.requests.at(-1)?.limited, "playlistRows");
});

test("a page and a delta of a playlist's rows spend from one bucket", async (t) => {
	frozenAt(t);
	const state = limited();

	for (let request = 1; request <= 15; request += 1) {
		assert.equal((await askItems(state)).status, 200, `page ${request}`);
		assert.equal((await askChanges(state)).status, 200, `delta ${request}`);
	}

	assert.equal((await askChanges(state)).status, 429);
	assert.equal((await askItems(state)).status, 429);
});

test("the playlist row bucket is per client: one spent leaves another's whole", async (t) => {
	frozenAt(t);
	const state = limited();

	for (let request = 1; request <= 30; request += 1)
		assert.equal((await askItems(state)).status, 200);
	assert.equal((await askItems(state)).status, 429);

	for (let request = 1; request <= 30; request += 1)
		assert.equal(
			(await askItems(state, { client: LAPTOP })).status,
			200,
			`the second client's request ${request}`,
		);
});

test("a spent playlist row bucket answers one more read 100 ms later, and no more", async (t) => {
	frozenAt(t);
	const state = limited();

	for (let request = 1; request <= 30; request += 1)
		assert.equal((await askItems(state)).status, 200);
	t.mock.timers.tick(99);
	assert.equal((await askItems(state)).status, 429, "at 99 ms");

	t.mock.timers.tick(1);
	assert.equal((await askItems(state)).status, 200, "at 100 ms");
	assert.equal((await askItems(state)).status, 429, "the token is spent");
});

test("a playlist row read refused 400 for what it asks spends nothing from the bucket", async (t) => {
	frozenAt(t);
	const state = limited();

	for (let request = 1; request <= 10; request += 1)
		assert.equal((await askItems(state, { columns: [] })).status, 400);
	for (let request = 1; request <= 30; request += 1)
		assert.equal((await askItems(state)).status, 200, `request ${request}`);
	assert.equal((await askItems(state)).status, 429);
});

// The bucket comes before anything asked of the player, and which playlists exist is the player's
// to say, so a client that has spent its reads is refused whichever playlist it names.
test("a client that has spent its playlist row reads is refused 429 even for a playlist the player does not have", async (t) => {
	frozenAt(t);
	const state = limited();

	assert.equal((await askItems(state, { guid: UNKNOWN_PLAYLIST })).status, 404);
	for (let request = 1; request <= 29; request += 1)
		assert.equal((await askItems(state)).status, 200, `request ${request}`);

	assert.equal((await askItems(state, { guid: UNKNOWN_PLAYLIST })).status, 429);
});

// The mixed playlist's rows, by position, and the cover each draws: the path of its album's
// first track by number in the library, which for North by Ana is A/2, not the row itself.
const COVERS = [
	"B/1.flac",
	"A/2.flac",
	"A/2.flac",
	null,
	"C/1.flac",
	null,
	null,
	null,
	"E/1.flac",
	"E/1.flac",
	"B/1.flac",
	"A/2.flac",
];

const coversOf = (rows: { cover?: unknown }[]) =>
	rows.map((row) => {
		assert.ok("cover" in row, `a row with no cover: ${JSON.stringify(row)}`);
		return row.cover;
	});

test("a page of a playlist asked with roles carries each row's album cover path, null for a row outside the library, and none without roles", async (t) => {
	frozenAt(t);
	const state = mixedState();

	const answer = await askItems(state, { roles: ROLES });

	assert.equal(answer.status, 200);
	const { items } = bodyOf(answer);
	assert.deepEqual(coversOf(items), COVERS);
	assert.equal(items[1].libraryPath, "A/1.flac");

	const bare = bodyOf(await askItems(state)).items;
	assert.equal(bare.length, 12);
	for (const row of bare) assert.ok(!("cover" in row), JSON.stringify(row));
});

test("a page asked with a role naming an undeclared expression, or before any snapshot, answers 200 with every cover null", async (t) => {
	frozenAt(t);
	const undeclared = await askItems(mixedState(), {
		roles: withRole("album", "%nothing%"),
	});
	const unbuilt = await askItems(mixedState({}, { build: false }), {
		roles: ROLES,
	});

	for (const [what, answer] of [
		["an undeclared expression", undeclared],
		["no snapshot", unbuilt],
	] as const) {
		assert.equal(answer.status, 200, what);
		assert.deepEqual(
			coversOf(bodyOf(answer).items),
			COVERS.map(() => null),
			what,
		);
	}
});

const BAD_ROLES: [string, [string, string][], object][] = [
	[
		"an unknown role",
		[...ROLES, ["colour", "%genre%"]],
		{ error: "unacceptable role", detail: "'colour' is not a role" },
	],
	[
		"an empty expression",
		withRole("album", ""),
		{
			error: "unacceptable role",
			detail: "role 'album' must be printable text of 1 to 1024 characters",
		},
	],
	[
		"a role named twice in two spellings",
		[...ROLES, ["album", "%title%"]],
		{ error: "duplicate role", detail: "role 'album' is named twice" },
	],
];

test("a page, a delta or the queue naming an unknown, empty or repeated role is 400 in the summary's words", async (t) => {
	frozenAt(t);
	const state = mixedState();

	for (const [what, roles, body] of BAD_ROLES) {
		assert.deepEqual(
			refusalOf(await askItems(state, { roles })),
			{ status: 400, body },
			`a page, ${what}`,
		);
		assert.deepEqual(
			refusalOf(await askChanges(state, { roles })),
			{ status: 400, body },
			`a delta, ${what}`,
		);
		assert.deepEqual(
			refusalOf(await askQueue(state, roles)),
			{ status: 400, body },
			`the queue, ${what}`,
		);
	}
});

const retagRow = (state: FakeState, index: number) => {
	state.playItem("p1", index);
	assert.ok(state.retagPlaying({ "%title%": `Retagged ${index}` }));
};

test("a delta asked with roles carries each changed row's album cover path, null outside the library, and none without roles", async (t) => {
	frozenAt(t);
	const state = mixedState();
	retagRow(state, 1);
	retagRow(state, 3);

	const covered = await askChanges(state, { roles: ROLES });
	assert.equal(covered.status, 200);
	const { items } = bodyOf(covered);
	assert.deepEqual(
		items.map((row: { position: number }) => row.position),
		[1, 3],
	);
	assert.deepEqual(coversOf(items), ["A/2.flac", null]);

	const bare = bodyOf(await askChanges(state)).items;
	assert.equal(bare.length, 2);
	for (const row of bare) assert.ok(!("cover" in row), JSON.stringify(row));

	const undeclared = bodyOf(
		await askChanges(state, { roles: withRole("album", "%nothing%") }),
	).items;
	assert.deepEqual(coversOf(undeclared), [null, null]);
});

test("the queue asked with roles carries each entry's album cover path, a handle queued with no row included, and null outside the library", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const playlist = state.playlistById("p1");
	assert.ok(playlist);
	state.queueInsert([
		{ playlistId: "p1", track: playlist.items[1] },
		{ playlistId: "p1", track: playlist.items[3] },
		{ playlistId: null, track: playlist.items[10] },
	]);

	const covered = await askQueue(state, ROLES);
	assert.equal(covered.status, 200);
	assert.deepEqual(coversOf(bodyOf(covered).entries), [
		"A/2.flac",
		null,
		"B/1.flac",
	]);

	const bare = bodyOf(await askQueue(state)).entries;
	assert.equal(bare.length, 3);
	for (const entry of bare)
		assert.ok(!("cover" in entry), JSON.stringify(entry));

	const undeclared = bodyOf(
		await askQueue(state, withRole("album", "%nothing%")),
	).entries;
	assert.deepEqual(coversOf(undeclared), [null, null, null]);
});
