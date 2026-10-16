import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { NOW, playLibrary, seeded, stamp } from "./playDeltaLibrary.ts";

const decode = mock.method(TextDecoder.prototype, "decode");

const { decodeJlib } = await import("../../src/shared/api/jlib.ts");
const { librarySnapshotOf, patchedColumns } = await import(
	"../../src/domain/track/librarySnapshot.ts"
);

const decodesDuring = (read: () => void) => {
	const before = decode.mock.callCount();
	read();
	return decode.mock.callCount() - before;
};

const held = () => {
	const library = playLibrary(seeded(11));
	const snapshot = decodeJlib(library.exported());
	if (snapshot.kind !== "snapshot") throw new Error("not a snapshot");
	return {
		library,
		columns: librarySnapshotOf(snapshot, TRACK_EXPRESSIONS).columns,
	};
};

const patched = (
	{ library, columns }: ReturnType<typeof held>,
	changes: Parameters<ReturnType<typeof playLibrary>["change"]>[0],
) => {
	const since = library.revision;
	library.change(changes);
	const delta = decodeJlib(library.changesSince(since));
	if (delta.kind !== "delta") throw new Error("not a delta");
	const after = patchedColumns(columns, delta, TRACK_EXPRESSIONS);
	assert.ok(after, "the delta did not apply");
	return after;
};

test("a patch to one column leaves every other column, its ids and its dictionary, the same objects", () => {
	const library = held();
	const after = patched(library, [
		{ ordinal: 3, field: FIELD.lastPlayedLocal, value: stamp(NOW) },
	]);

	const moved = TRACK_EXPRESSIONS.filter(
		(_, field) => after.fields[field] !== library.columns.fields[field],
	);
	assert.deepEqual(moved, [TRACK_EXPRESSIONS[FIELD.lastPlayedLocal]]);

	for (let field = 0; field < TRACK_EXPRESSIONS.length; field += 1) {
		if (field === FIELD.lastPlayedLocal) continue;
		assert.equal(after.fields[field].ids, library.columns.fields[field].ids);
		assert.equal(after.fields[field].dict, library.columns.fields[field].dict);
	}
});

test("two rows sharing a value decode it once between them, so a value read twice is decoded once", () => {
	const { columns, library } = held();
	const album = columns.fields[FIELD.album];
	const [first, second] = library.rows
		.map((row, ordinal) => ({ album: row[FIELD.album], ordinal }))
		.filter((row, _, all) => row.album === all[0].album);

	const decodes = decodesDuring(() => {
		album.at(first.ordinal);
		album.at(second.ordinal);
	});
	assert.ok(decodes <= 1, `decoded ${decodes} times`);
});

test("a value read before a patch is not decoded again through the patched column", () => {
	const library = held();
	const before = library.columns.fields[FIELD.playCount];
	const kept = library.library.rows[0][FIELD.playCount];
	const id = before.ids[0];
	before.value(id);

	const after = patched(library, [
		{ ordinal: 1, field: FIELD.playCount, value: "9999" },
	]);

	let read = "";
	assert.equal(
		decodesDuring(() => {
			read = after.fields[FIELD.playCount].value(id);
		}),
		0,
	);
	assert.equal(read, kept);
});

test("every value reads back as written, before a patch, after it, and the one it appended", () => {
	const library = held();
	const titles = library.columns.fields[FIELD.title];
	const expected = library.library.rows.map((row) => row[FIELD.title]);

	const twice = () => expected.map((_, row) => titles.at(row));
	assert.deepEqual(twice(), expected);
	assert.deepEqual(twice(), expected);

	const after = patched(library, [
		{ ordinal: 2, field: FIELD.title, value: "A title no row had" },
	]);
	const now = library.library.rows.map((row) => row[FIELD.title]);
	const read = () => now.map((_, row) => after.fields[FIELD.title].at(row));
	assert.deepEqual(read(), now);
	assert.deepEqual(read(), now);
});
