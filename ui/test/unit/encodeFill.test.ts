import assert from "node:assert/strict";
import test from "node:test";

import { encodeFill } from "../../src/shared/api/fillEncoding.ts";
import type { components } from "../../src/shared/api/fooJeanSchema";

type Fill = components["schemas"]["FillPlaylistRequest"];

const FORMS = ["runs", "bitset", "ordinals"] as const;

// `kMaxBodyBytes` in foo_jean, one limit for the whole server. A body over it is
// refused rather than chunked.
const MAX_BODY_BYTES = 256 * 1024;

// The own-playlist fill is the larger of the two envelopes: it carries the
// playlist title as well, and the contract caps a title at 256 characters.
const LONGEST_TITLE = "T".repeat(256);

const LIBRARY = { structure: 41, trackCount: 30_441 };
const LARGEST_LIBRARY = { structure: 8, trackCount: 1_500_000 };

const range = (start: number, count: number) =>
	Array.from({ length: count }, (_, at) => start + at);

const everyOtherTrack = (trackCount: number) =>
	range(0, Math.ceil(trackCount / 2)).map((at) => at * 2);

const ascending = (ordinals: ArrayLike<number>) =>
	Array.from(ordinals).sort((a, b) => a - b);

// What reaches the component. `JSON.stringify` drops an undefined property, so a
// form is only sent if it survives that.
const formsIn = (body: Fill) => {
	const sent = JSON.parse(JSON.stringify(body)) as Fill;
	return FORMS.filter((form) => sent[form] !== undefined);
};

const requestBytes = (body: Fill) =>
	new TextEncoder().encode(JSON.stringify({ title: LONGEST_TITLE, ...body }))
		.length;

const rowsOf = (body: Fill): number[] => {
	if (body.ordinals) return [...body.ordinals];
	if (body.runs)
		return body.runs.flatMap(([start, count]) => range(start, count));

	assert.ok(body.bitset !== undefined, "no form to read the set from");
	const bytes = Buffer.from(body.bitset, "base64");
	const rows: number[] = [];
	for (let byte = 0; byte < bytes.length; byte += 1)
		for (let bit = 0; bit < 8; bit += 1)
			if (bytes[byte] & (1 << bit)) rows.push(byte * 8 + bit);

	return rows;
};

// A set here runs to hundreds of thousands of rows, so a mismatch is reported as
// the first row that differs rather than as a diff of the whole thing.
const firstDifference = (rows: number[], expected: number[]) => {
	if (rows.length !== expected.length)
		return `${rows.length} rows rather than ${expected.length}`;

	const at = rows.findIndex((row, index) => row !== expected[index]);
	return at === -1
		? null
		: `row ${at} is ordinal ${rows[at]} rather than ${expected[at]}`;
};

const SETS: { name: string; ordinals: ArrayLike<number> }[] = [
	{ name: "one row", ordinals: [12_345] },
	{ name: "an album in one folder", ordinals: range(9_000, 12) },
	{
		name: "an artist across three folders",
		ordinals: [...range(112, 9), ...range(4_020, 11), ...range(21_500, 14)],
	},
	{
		// A view holds its refs as an Int32Array, and mapping one gives back
		// another typed array rather than a list.
		name: "a scattered search result, as the Int32Array a view holds",
		ordinals: Int32Array.from(everyOtherTrack(LIBRARY.trackCount)),
	},
	{ name: "the whole library", ordinals: range(0, LIBRARY.trackCount) },
	{ name: "a click-ordered multi-select", ordinals: [900, 12, 12_345, 40] },
];

test("carries the structure the set was resolved against, and exactly one of the three forms", () => {
	for (const { name, ordinals } of SETS) {
		const body = encodeFill(ordinals, LIBRARY);
		const forms = formsIn(body);

		assert.equal(
			body.structure,
			LIBRARY.structure,
			`${name}: a structure the set was not resolved against`,
		);
		assert.equal(
			forms.length,
			1,
			`${name}: sent ${forms.length} of the three forms, ${forms.join(" and ") || "none"}`,
		);
	}
});

test("the form it picks names the rows the caller asked for", () => {
	for (const { name, ordinals } of SETS) {
		const difference = firstDifference(
			ascending(rowsOf(encodeFill(ordinals, LIBRARY))),
			ascending(ordinals),
		);
		assert.equal(difference, null, `${name}: ${difference}`);
	}
});

test("a set that is not ascending is sent as `ordinals`, in the order it was given", () => {
	const clicked = [
		[900, 12, 12_345, 40],
		[11, 10, 9],
		[0, 1, 2, 3, 4, 5, 900, 6],
	];

	for (const set of clicked) {
		const body = encodeFill(set, LIBRARY);

		assert.deepEqual(
			formsIn(body),
			["ordinals"],
			`${set.join(" ")}: sent as ${formsIn(body).join(" and ") || "nothing"}`,
		);
		assert.deepEqual(body.ordinals, set, `${set.join(" ")}: reordered`);
	}
});

test("the whole library of 1,500,000 tracks fits in one request", () => {
	const whole = range(0, LARGEST_LIBRARY.trackCount);
	const body = encodeFill(whole, LARGEST_LIBRARY);
	const bytes = requestBytes(body);
	const difference = firstDifference(rowsOf(body), whole);

	assert.equal(difference, null, `a different set: ${difference}`);
	assert.ok(
		bytes <= MAX_BODY_BYTES,
		`${bytes} bytes, over the ${MAX_BODY_BYTES} the component takes`,
	);
});

test("a set alternating ordinal by ordinal across 1,500,000 tracks fits in one request", () => {
	const scattered = everyOtherTrack(LARGEST_LIBRARY.trackCount);
	const body = encodeFill(scattered, LARGEST_LIBRARY);
	const bytes = requestBytes(body);
	const difference = firstDifference(rowsOf(body), scattered);

	assert.equal(difference, null, `a different set: ${difference}`);
	assert.ok(
		bytes <= MAX_BODY_BYTES,
		`${bytes} bytes, over the ${MAX_BODY_BYTES} the component takes`,
	);
});

test("a set with no rows throws rather than sending a fill that names nothing", () => {
	// The component answers 400 to a body carrying none of the three forms, and
	// this is the last place a caller's empty set can be caught before that trip.
	for (const empty of [[], new Int32Array(0)])
		assert.throws(
			() => encodeFill(empty, LIBRARY),
			`${empty.constructor.name}: encoded an empty set instead of throwing`,
		);
});

test("a row named twice is sent twice, as `ordinals`, the only form that can carry a repeat", () => {
	// Queueing the same track twice is deliberate. An album with one of its tracks
	// queued again is still in ascending order, and it is far cheaper as runs, so
	// an encoder branching on ascendingness alone sends runs and loses the repeat.
	const album = range(9_000, 400);
	const twice = [...album, album[album.length - 1]];
	const body = encodeFill(twice, LIBRARY);

	assert.deepEqual(
		formsIn(body),
		["ordinals"],
		`sent as ${formsIn(body).join(" and ") || "nothing"}`,
	);
	assert.deepEqual(body.ordinals, twice, "the repeat was dropped or reordered");
});
