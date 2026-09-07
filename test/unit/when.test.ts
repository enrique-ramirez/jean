import assert from "node:assert/strict";
import test from "node:test";

import { describeWhen } from "../../src/features/home/when.ts";

// A shelf caption is the one figure on the home screen that is neither a number
// nor a fixed string, so it is where "the locale follows the language, not the
// browser" is actually decided. `home.spec.ts` sees the caption; it cannot see
// which locale produced it.

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => Date.now() - days * DAY;

test("nothing played is nothing to describe", () => {
	assert.equal(describeWhen(null, "en", "Today"), null);
	assert.equal(describeWhen(0, "en", "Today"), null);
});

test("today is the caller's word, since Intl has none for it", () => {
	assert.equal(describeWhen(daysAgo(0), "en", "Today"), "Today");
	assert.equal(describeWhen(daysAgo(0), "es", "Hoy"), "Hoy");
});

test("the same moment reads differently in two languages", () => {
	const at = daysAgo(3);
	assert.notEqual(
		describeWhen(at, "en", "Today"),
		describeWhen(at, "es", "Hoy"),
	);
});

test("it capitalises in the locale rather than in ASCII", () => {
	// `Intl` returns a lower-case phrase and a caption starts a line, so the
	// first letter grows -- in Turkish a dotless i, which `toUpperCase` gets
	// wrong.
	const shown = describeWhen(daysAgo(3), "en", "Today") as string;
	assert.equal(shown[0], shown[0].toUpperCase());
});

test("a year back is a month and a year, not a count of days", () => {
	const shown = describeWhen(daysAgo(400), "en", "Today") as string;
	assert.match(shown, /\d{4}/);
	assert.doesNotMatch(shown, /ago/);
});
