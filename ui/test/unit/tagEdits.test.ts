import assert from "node:assert/strict";
import test from "node:test";

import { type TagValues, tagEdits } from "../../src/domain/track/tagEdits.ts";

const read: TagValues = {
	TITLE: "Bridge over Troubled Water",
	ARTIST: ["Simon", "Garfunkel"],
	ALBUM: "Bridge over Troubled Water",
	GENRE: ["Folk", "Pop"],
	TRACKNUMBER: "1",
	COMPOSER: [],
	DATE: "",
};

const copied = (values: TagValues): TagValues =>
	Object.fromEntries(
		Object.entries(values).map(([tag, value]) => [
			tag,
			typeof value === "string" ? value : [...value],
		]),
	);

test("a form nobody changed sends no field", () => {
	assert.deepEqual(tagEdits(read, { ...read }), {});
});

test("chips in the same values and order as were read send nothing", () => {
	assert.deepEqual(tagEdits(read, copied(read)), {});
});

test("only the fields that differ from what was read are sent", () => {
	assert.deepEqual(
		tagEdits(read, { ...copied(read), TITLE: "Cecilia", GENRE: ["Folk"] }),
		{ TITLE: "Cecilia", GENRE: ["Folk"] },
	);
});

test("a multi-value field is sent as its chips in chip order, a reorder alone counting as a change", () => {
	assert.deepEqual(
		tagEdits(read, { ...copied(read), ARTIST: ["Garfunkel", "Simon"] }),
		{ ARTIST: ["Garfunkel", "Simon"] },
	);
	assert.deepEqual(
		tagEdits(read, { ...copied(read), ARTIST: ["Simon", "Garfunkel", "Art"] }),
		{ ARTIST: ["Simon", "Garfunkel", "Art"] },
	);
});

test("a chip holding a semicolon is sent as one literal value, never split or escaped", () => {
	assert.deepEqual(
		tagEdits(read, { ...copied(read), ARTIST: ["Simon; Garfunkel"] }),
		{ ARTIST: ["Simon; Garfunkel"] },
	);
});

test("a multi-value field left with no chips is sent as an empty array", () => {
	assert.deepEqual(tagEdits(read, { ...copied(read), GENRE: [] }), {
		GENRE: [],
	});
});

test("a single-value field emptied is sent as the empty string", () => {
	assert.deepEqual(tagEdits(read, { ...copied(read), ALBUM: "" }), {
		ALBUM: "",
	});
});

test("an empty tag, read as empty or not read at all, is sent once given a value and not while left empty", () => {
	assert.deepEqual(
		tagEdits(read, {
			...copied(read),
			DATE: "1970",
			COMPOSER: ["Paul Simon"],
			BPM: "120",
			"ALBUM ARTIST": ["Simon & Garfunkel"],
		}),
		{
			DATE: "1970",
			COMPOSER: ["Paul Simon"],
			BPM: "120",
			"ALBUM ARTIST": ["Simon & Garfunkel"],
		},
	);
	assert.deepEqual(
		tagEdits(read, { ...copied(read), PUBLISHER: "", "ALBUM ARTIST": [] }),
		{},
	);
});

test("a field that was read but is not in the form is never sent", () => {
	const { TRACKNUMBER: _, GENRE: __, ...form } = copied(read);
	assert.deepEqual(tagEdits(read, form), {});
});
