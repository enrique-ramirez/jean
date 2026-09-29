import assert from "node:assert/strict";
import test from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { libraryColumnsOf } from "../../src/domain/track/libraryColumns.ts";
import { foldCache } from "../../src/domain/track/searchText.ts";

const TITLES = ["Árbol", "Déjà Vu", "Ñandú", "Coração", "Straße"];

const columns = libraryColumnsOf(
	TITLES.map((title) => {
		const row: string[] = [];
		row[FIELD.title] = title;
		return row;
	}),
	TRACK_EXPRESSIONS.length,
);

test("warming folds in slices, resumes where it stopped, and reads the same as folding on demand", () => {
	const cache = foldCache();
	assert.equal(
		cache.warm(columns, () => false),
		false,
		"a slice with no time left finishes nothing",
	);
	assert.equal(
		cache.warm(columns, () => true),
		true,
	);

	const warmed = cache.over(columns);
	const cold = foldCache().over(columns);
	for (const ref of TITLES.keys())
		assert.equal(warmed.title.text(ref), cold.title.text(ref));
});
