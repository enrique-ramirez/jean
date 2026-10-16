import assert from "node:assert/strict";
import test from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { rekeyedSnapshotBytes } from "../../src/domain/track/libraryRekey.ts";
import { replayedLibrary } from "../../src/domain/track/libraryReplay.ts";
import { decodeJlib } from "../../src/shared/api/jlib.ts";
import { generatedRows, searchLibraryOf, seeded } from "./searchLibraries.ts";

// A tag can begin with U+FEFF, whose UTF-8 is `EF BB BF`.

const BOM = "﻿";
const TITLE = TRACK_EXPRESSIONS[FIELD.title];

// The player's order: the bytes compared, not the UTF-16 a string holds.
const bytewise = (left: string, right: string) =>
	Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

test("a column holding a value that begins with a byte order mark re-keys to the player's ids, and reads back with the mark", () => {
	const titles = [`${BOM}a`, "b", `${BOM}a`, "b"];
	const rows = generatedRows(seeded(9), titles.length);
	titles.forEach((title, row) => {
		rows[row][FIELD.title] = title;
	});
	const held = replayedLibrary([
		{ kind: "load", bytes: searchLibraryOf(rows).exported().slice(0) },
	]);
	assert.ok(held, "the stored copy did not replay");

	const rekeyed = decodeJlib(
		rekeyedSnapshotBytes(held, { structure: 21, revision: 1 }),
	);
	if (rekeyed.kind !== "snapshot") return assert.fail("not a snapshot");
	const column = rekeyed.columns.get(TITLE);
	assert.ok(column && "at" in column, "no title column");

	const playerOrder = [...new Set(titles)].sort(bytewise);
	assert.deepEqual(
		Array.from(column.ids),
		titles.map((title) => playerOrder.indexOf(title)),
		"ids other than the player's",
	);
	assert.deepEqual(
		titles.map((_, row) => column.at(row)),
		titles,
	);
});
