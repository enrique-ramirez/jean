import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration, spellDuration } from "../../src/domain/track/stats.ts";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("a duration is its two largest units, compactly", () => {
	assert.equal(formatDuration(42 * MINUTE), "42 min");
	assert.equal(formatDuration(3 * HOUR + 5 * MINUTE), "3 hr 5 min");
	assert.equal(formatDuration(2 * DAY + 4 * HOUR + 9 * MINUTE), "2 days 4 hr");
});

test("a zero unit in second place is still written", () => {
	assert.equal(formatDuration(3 * HOUR), "3 hr 0 min");
	assert.equal(formatDuration(DAY), "1 day 0 hr");
});

test("spelled out, the largest unit is a word and a zero second unit is left off", () => {
	assert.deepEqual(spellDuration(DAY), { lead: "1 day", trail: null });
	assert.deepEqual(spellDuration(2 * DAY + 4 * HOUR), {
		lead: "2 days",
		trail: "4 hr",
	});
	assert.deepEqual(spellDuration(HOUR + 30 * MINUTE), {
		lead: "1 hour",
		trail: "30 min",
	});
	assert.deepEqual(spellDuration(59), { lead: "0 minutes", trail: null });
});

test("no time, a negative one or one that is not a number has no duration", () => {
	for (const seconds of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.equal(formatDuration(seconds), null, String(seconds));
		assert.equal(spellDuration(seconds), null, String(seconds));
	}
});
