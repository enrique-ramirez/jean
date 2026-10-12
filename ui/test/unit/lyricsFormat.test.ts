import assert from "node:assert/strict";
import test from "node:test";

import {
	type LyricLine,
	parseLyrics,
} from "../../src/features/now-playing/lyricsFormat.ts";

const lrc = (...rows: string[]) => rows.join("\n");

const timesOf = (raw: string) => {
	const lyrics = parseLyrics(raw);
	assert.equal(lyrics.kind, "synced");
	return (lyrics as { lines: LyricLine[] }).lines.map((line) => line.at);
};

test("an [offset:] in milliseconds is subtracted from every line", () => {
	assert.deepEqual(
		timesOf(
			lrc("[offset:500]", "[00:10.00]one", "[00:20.00]two", "[00:40.00]three"),
		),
		[9.5, 19.5, 39.5],
	);
});

test("a negative offset moves every line later", () => {
	assert.deepEqual(
		timesOf(
			lrc(
				"[offset:-1000]",
				"[00:10.00]one",
				"[00:20.00]two",
				"[00:40.00]three",
			),
		),
		[11, 21, 41],
	);
});

test("an offset past a line's own time holds it at the start rather than before it", () => {
	assert.deepEqual(
		timesOf(
			lrc("[offset:2000]", "[00:01.00]one", "[00:20.00]two", "[00:40.00]three"),
		),
		[0, 18, 38],
	);
});

test("an offset that is not a number is ignored, and no ID tag becomes a line", () => {
	const lyrics = parseLyrics(
		lrc(
			"[ar:Somebody]",
			"[offset:soon]",
			"[00:10.00]one",
			"[00:20.00]two",
			"[00:40.00]three",
		),
	);
	assert.deepEqual(lyrics, {
		kind: "synced",
		lines: [
			{ at: 10, text: "one" },
			{ at: 20, text: "two" },
			{ at: 40, text: "three" },
		],
	});
});

// Stray timestamps turn up in lyrics that were never meant to be followed, so a
// lyric has to earn "synced" three ways before the panel offers to follow it.
test("two timed lines are not enough to follow", () => {
	assert.equal(
		parseLyrics(lrc("[00:10.00]one", "[00:40.00]two")).kind,
		"plain",
	);
});

test("three timed lines are enough to follow", () => {
	assert.equal(
		parseLyrics(lrc("[00:10.00]one", "[00:20.00]two", "[00:40.00]three")).kind,
		"synced",
	);
});

test("timed lines have to be at least half of the lines with words", () => {
	const timed = ["[00:10.00]one", "[00:20.00]two", "[00:40.00]three"];
	assert.equal(parseLyrics(lrc(...timed, "a", "b", "c")).kind, "synced");
	assert.equal(parseLyrics(lrc(...timed, "a", "b", "c", "d")).kind, "plain");
});

test("blank lines count for neither side of that half", () => {
	assert.equal(
		parseLyrics(
			lrc("[00:10.00]one", "", "[00:20.00]two", "", "", "[00:40.00]three"),
		).kind,
		"synced",
	);
});

test("timing that spans under twenty seconds reads as plain text", () => {
	assert.equal(
		parseLyrics(lrc("[00:10.00]one", "[00:15.00]two", "[00:29.99]three")).kind,
		"plain",
	);
	assert.equal(
		parseLyrics(lrc("[00:10.00]one", "[00:15.00]two", "[00:30.00]three")).kind,
		"synced",
	);
});

test("a lyric read as plain keeps its words and drops its timestamps and outer blank lines", () => {
	assert.deepEqual(parseLyrics(lrc("", "[00:10.00]one", "", "two", "")), {
		kind: "plain",
		lines: ["one", "", "two"],
	});
});

test("fractions of one, two and three digits are tenths, hundredths and thousandths", () => {
	assert.deepEqual(
		timesOf(lrc("[00:01.5]one", "[00:02.05]two", "[00:30.005]three")),
		[1.5, 2.05, 30.005],
	);
});

test("nothing, or only tags, is no lyric at all", () => {
	assert.equal(parseLyrics(null).kind, "none");
	assert.equal(parseLyrics("").kind, "none");
	assert.equal(parseLyrics(lrc("", "  ", "")).kind, "none");
	assert.equal(
		parseLyrics(lrc("[ar:Somebody]", "[ti:Something]", "[offset:500]")).kind,
		"none",
	);
});

test("a plain lyric keeps its bracketed section rows as lines", () => {
	assert.deepEqual(
		parseLyrics(
			lrc(
				"[Verse: Adrián]",
				"First line",
				"Second line",
				"",
				"[Chorus: Diego]",
				"Third line",
			),
		),
		{
			kind: "plain",
			lines: [
				"[Verse: Adrián]",
				"First line",
				"Second line",
				"",
				"[Chorus: Diego]",
				"Third line",
			],
		},
	);
});

test("an untimed lyric is read without its LRC header tags, and keeps a section row beside them", () => {
	assert.deepEqual(
		parseLyrics(
			lrc(
				"[ti:Leave]",
				"[AR: Somebody]",
				"one",
				"[offset:500]",
				"[Chorus: Diego]",
				"two",
			),
		),
		{ kind: "plain", lines: ["one", "[Chorus: Diego]", "two"] },
	);
});

test("a section row among timed lines is words, so it counts against the timed half and is kept when the lyric reads as plain", () => {
	const timed = ["[00:10.00]one", "[00:20.00]two", "[00:40.00]three"];

	assert.equal(
		parseLyrics(lrc("[ar:Somebody]", ...timed, "[Chorus: Diego]")).kind,
		"synced",
	);
	assert.deepEqual(
		parseLyrics(
			lrc("[ar:Somebody]", "[Chorus: Diego]", ...timed, "a", "b", "c"),
		),
		{
			kind: "plain",
			lines: ["[Chorus: Diego]", "one", "two", "three", "a", "b", "c"],
		},
	);
});
