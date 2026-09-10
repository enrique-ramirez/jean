import assert from "node:assert/strict";
import test from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { deriveIntensity } from "../../src/domain/track/intensity.ts";
import { libraryColumnsOf } from "../../src/domain/track/libraryColumns.ts";

// The two numbers a row is shaded from. Nothing renders either of them, so what
// `heat.spec.ts` can see is one row against another; the scale itself, the
// clamp and the never-played sentinel only exist here.

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

// 'YYYY-MM-DD HH:MM:SS' in local time, which is what the component writes and
// what `readTimestamp` parses.
const stamp = (at: number) => {
	const when = new Date(at);
	const pad = (part: number) => String(part).padStart(2, "0");
	return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
};

const intensityOf = (rows: string[][]) =>
	deriveIntensity(libraryColumnsOf(rows, TRACK_EXPRESSIONS.length));

const row = (plays: number | null, lastPlayed?: number): string[] => {
	const columns: string[] = new Array(TRACK_EXPRESSIONS.length).fill("?");
	if (plays !== null) columns[FIELD.playCount] = String(plays);
	columns[FIELD.lastPlayed] =
		lastPlayed === undefined ? "N/A" : stamp(lastPlayed);
	return columns;
};

test("heat is logarithmic, so one outlier does not flatten everything else", () => {
	const { heat } = intensityOf([row(163), row(107), row(72)]);

	assert.equal(heat[0], 1);
	assert.ok(heat[1] > 0.8, `107 plays against 163 shaded ${heat[1]}`);
	assert.ok(heat[1] < heat[0]);
	assert.ok(heat[2] < heat[1]);
});

test("the most played track in the set is the top of the scale", () => {
	assert.equal(intensityOf([row(3), row(1)]).heat[0], 1);
});

test("a track never played is flat rather than faded", () => {
	const { heat, patina } = intensityOf([row(100, Date.now()), row(0)]);

	assert.equal(heat[1], 0);
	assert.equal(patina[1], 0);
});

test("a date without a play count still reads as never played", () => {
	// The two facts come from different components and are spelled two ways
	// each, so an install can answer the date and not the count. Faded is a claim
	// about how long ago you stopped listening, and this row was never started.
	const { patina } = intensityOf([
		row(50, Date.now()),
		row(0, Date.now() - 5 * YEAR_MS),
	]);

	assert.equal(patina[1], 0);
});

test("a field the player cannot resolve counts as never played", () => {
	// With no playback-statistics component every row answers '?'. A library
	// where nothing is shaded is the right answer, and the ceiling is zero, so
	// this is also where a division by it would show up.
	const { heat, patina, playedCount } = intensityOf([row(null), row(null)]);

	assert.deepEqual([...heat], [0, 0]);
	assert.deepEqual([...patina], [0, 0]);
	assert.equal(playedCount, 0);
});

test("patina reaches its ceiling at six years and stops there", () => {
	const now = Date.now();
	const { patina } = intensityOf([
		row(4, now - 3 * YEAR_MS),
		row(4, now - 6 * YEAR_MS),
		row(4, now - 40 * YEAR_MS),
	]);

	assert.ok(Math.abs(patina[0] - 0.5) < 0.01, `three years read ${patina[0]}`);
	assert.ok(patina[1] >= 0.99);
	assert.equal(patina[2], 1);
});

test("a date in the future does not go negative", () => {
	// Clock skew between the player's machine and this one, which is ordinary.
	const { patina } = intensityOf([row(4, Date.now() + 2 * DAY_MS)]);
	assert.equal(patina[0], 0);
});

test("playedCount is how many rows have been played at all", () => {
	const { playedCount } = intensityOf([row(9), row(0), row(null), row(1)]);
	assert.equal(playedCount, 2);
});
