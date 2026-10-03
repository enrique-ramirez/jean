import assert from "node:assert/strict";
import test from "node:test";

import {
	type DraftLine,
	draftFromText,
	type LyricDraft,
	serialiseDraft,
	shiftAll,
	shiftLine,
	stampLine,
} from "../../src/features/now-playing/lyricDraft.ts";
import {
	type Lyrics,
	parseLyrics,
} from "../../src/features/now-playing/lyricsFormat.ts";

const lrc = (...rows: string[]) => rows.join("\n");

const rowsOf = (written: string) => written.split("\n");

const draftOf = (
	...lines: [at: number | null, text: string][]
): LyricDraft => ({
	headers: [],
	lines: lines.map(([at, text], id) => ({ id, at, text })),
});

const timesOf = (draft: LyricDraft) => draft.lines.map((line) => line.at);

const shape = (lines: DraftLine[]) =>
	lines.map(({ at, text }) => ({ at, text }));

const frozen = (draft: LyricDraft): LyricDraft =>
	Object.freeze({
		headers: Object.freeze([...draft.headers]) as string[],
		lines: Object.freeze(
			draft.lines.map((line) => Object.freeze({ ...line })),
		) as DraftLine[],
	});

const repeat =
	(times: number, step: (draft: LyricDraft) => LyricDraft) =>
	(draft: LyricDraft) =>
		Array.from({ length: times }).reduce<LyricDraft>(step, draft);

// Compared to the millisecond: adding a fraction to seconds in floating point can differ in the
// last bit.
const inMs = (lyrics: Lyrics) =>
	lyrics.kind === "synced"
		? {
				kind: lyrics.kind,
				lines: lyrics.lines.map(({ at, text }) => ({
					at: Math.round(at * 1000),
					text,
				})),
			}
		: lyrics;

const roundTrip = (raw: string) =>
	parseLyrics(serialiseDraft(draftFromText(raw)));

const SYNCED_WITH_HEADERS = lrc(
	"[ti:Leave]",
	"[ar:Somebody]",
	"[offset:500]",
	"[00:40.00]third",
	"[00:10.00][00:50.00]chorus",
	"[00:20.25]second",
	"[00:30.00]",
);

test("a fully timed LRC reads as one line per stamp, sorted by time, with the offset folded in", () => {
	assert.deepEqual(shape(draftFromText(SYNCED_WITH_HEADERS).lines), [
		{ at: 9.5, text: "chorus" },
		{ at: 19.75, text: "second" },
		{ at: 29.5, text: "" },
		{ at: 39.5, text: "third" },
		{ at: 49.5, text: "chorus" },
	]);
});

test("a pasted LRC keeps its header rows in order and drops the offset", () => {
	assert.deepEqual(draftFromText(SYNCED_WITH_HEADERS).headers, [
		"[ti:Leave]",
		"[ar:Somebody]",
	]);
});

test("a pasted LRC keeps every time, however few lines are timed", () => {
	assert.deepEqual(
		shape(draftFromText(lrc("[00:12.00]two", "[00:10.00]one")).lines),
		[
			{ at: 10, text: "one" },
			{ at: 12, text: "two" },
		],
	);
});

test("an LRC with untimed lines keeps them where they were, in the order pasted, with each stamp of a line in its place", () => {
	const raw = lrc(
		"[offset:500]",
		"[00:20.00]one",
		"bare",
		"[00:10.00][00:30.00]two",
	);
	assert.deepEqual(shape(draftFromText(raw).lines), [
		{ at: 19.5, text: "one" },
		{ at: null, text: "bare" },
		{ at: 9.5, text: "two" },
		{ at: 29.5, text: "two" },
	]);
});

test("pasted plain text reads as untimed lines, keeping the blank lines between stanzas", () => {
	assert.deepEqual(shape(draftFromText(lrc("one", "", "two")).lines), [
		{ at: null, text: "one" },
		{ at: null, text: "" },
		{ at: null, text: "two" },
	]);
});

test("a paste with no words reads as no lines", () => {
	assert.deepEqual(draftFromText(""), { headers: [], lines: [] });
	assert.deepEqual(draftFromText(lrc("", "  ", "")), {
		headers: [],
		lines: [],
	});
});

const PLAIN_WITH_SECTIONS = lrc(
	"[Verse: Adrián]",
	"First line",
	"Second line",
	"",
	"[Chorus: Diego]",
	"Third line",
);

test("a plain lyric with bracketed section rows reads with no headers, every row a line, and is written back unchanged", () => {
	const draft = draftFromText(PLAIN_WITH_SECTIONS);

	assert.deepEqual(draft.headers, []);
	assert.deepEqual(shape(draft.lines), [
		{ at: null, text: "[Verse: Adrián]" },
		{ at: null, text: "First line" },
		{ at: null, text: "Second line" },
		{ at: null, text: "" },
		{ at: null, text: "[Chorus: Diego]" },
		{ at: null, text: "Third line" },
	]);
	assert.equal(serialiseDraft(draft), PLAIN_WITH_SECTIONS);
});

test("in a text with no timed line a row spelt as an LRC tag is a line too, and is written back", () => {
	const plain = lrc(
		"[ti:Leave]",
		"[ar:Somebody]",
		"[offset:500]",
		"one",
		"two",
	);
	const draft = draftFromText(plain);

	assert.deepEqual(draft.headers, []);
	assert.deepEqual(
		draft.lines.map((line) => line.text),
		["[ti:Leave]", "[ar:Somebody]", "[offset:500]", "one", "two"],
	);
	assert.equal(serialiseDraft(draft), plain);
	assert.deepEqual(
		draftFromText(lrc("[ti:Leave]", "[ar:Somebody]")).lines.map(
			(line) => line.text,
		),
		["[ti:Leave]", "[ar:Somebody]"],
	);
});

test("in an LRC a bracketed row that is not a known tag stays an untimed line where it was", () => {
	const raw = lrc(
		"[ti:Leave]",
		"[Verse: Adrián]",
		"[00:10.00]one",
		"[Chorus: Diego]",
		"[00:20.00]two",
		"[Verse 2]",
		"[id: 42]",
		"[00:30.00]three",
	);
	const draft = draftFromText(raw);

	assert.deepEqual(draft.headers, ["[ti:Leave]"]);
	assert.deepEqual(shape(draft.lines), [
		{ at: null, text: "[Verse: Adrián]" },
		{ at: 10, text: "one" },
		{ at: null, text: "[Chorus: Diego]" },
		{ at: 20, text: "two" },
		{ at: null, text: "[Verse 2]" },
		{ at: null, text: "[id: 42]" },
		{ at: 30, text: "three" },
	]);
	assert.equal(serialiseDraft(draft), raw);
});

test("in an LRC each known tag is a header whatever its case, and the offset is folded and not kept", () => {
	const tags = [
		"[ti:Leave]",
		"[AR:Somebody]",
		"[al:Record]",
		"[Au:Writer]",
		"[by:Transcriber]",
		"[re:Editor]",
		"[ve:1.0]",
		"[la:es]",
		"[Length: 03:41]",
		"[tool:Something]",
	];
	const draft = draftFromText(
		lrc(...tags, "[OFFSET:500]", "[00:10.00]one", "[00:20.00]two"),
	);

	assert.deepEqual(draft.headers, tags);
	assert.deepEqual(shape(draft.lines), [
		{ at: 9.5, text: "one" },
		{ at: 19.5, text: "two" },
	]);
});

test("every line of a draft has its own id, repeated words included", () => {
	const ids = draftFromText(SYNCED_WITH_HEADERS).lines.map((line) => line.id);
	assert.equal(new Set(ids).size, ids.length);
});

test("shifting all lines moves every timed line by the step, earlier or later, and leaves untimed lines untimed", () => {
	const draft = draftOf([10, "one"], [null, "between"], [20.5, "two"]);
	assert.deepEqual(timesOf(shiftAll(draft, 1)), [11, null, 21.5]);
	assert.deepEqual(timesOf(shiftAll(draft, -0.1)), [9.9, null, 20.4]);
});

test("shifting all lines earlier holds a line at the start rather than before it", () => {
	assert.deepEqual(
		timesOf(shiftAll(draftOf([0.3, "one"], [5, "two"]), -1)),
		[0, 4],
	);
});

test("shifting one line moves that line alone", () => {
	const draft = draftOf([10, "one"], [20, "two"], [30, "three"]);
	assert.deepEqual(timesOf(shiftLine(draft, 1, 1)), [10, 21, 30]);
	assert.deepEqual(timesOf(shiftLine(draft, 1, -0.1)), [10, 19.9, 30]);
});

test("shifting one line earlier holds it at the start rather than before it", () => {
	assert.deepEqual(
		timesOf(shiftLine(draftOf([0.05, "one"], [20, "two"]), 0, -0.1)),
		[0, 20],
	);
});

test("shifting an untimed line leaves it untimed", () => {
	assert.deepEqual(
		timesOf(shiftLine(draftOf([10, "one"], [null, "two"]), 1, 1)),
		[10, null],
	);
});

// Ten taps of 0.1 s in floating point land on 0.9999999999999999.
test("ten 100 ms steps land on exactly one second", () => {
	const later = (draft: LyricDraft) => shiftAll(draft, 0.1);
	const earlier = (draft: LyricDraft) => shiftLine(draft, 0, -0.1);

	assert.deepEqual(
		timesOf(repeat(10, later)(draftOf([0, "one"], [2, "two"]))),
		[1, 3],
	);
	assert.deepEqual(timesOf(repeat(10, earlier)(draftOf([3, "one"]))), [2]);
});

test("stamping a line sets its time to the position and selects the next line", () => {
	const draft = draftOf([null, "one"], [5, "two"], [null, "three"]);
	const stamped = stampLine(draft, 1, 12.5);

	assert.deepEqual(timesOf(stamped.draft), [null, 12.5, null]);
	assert.equal(stamped.selected, 2);
});

// A browser audio element's position is a float with no bound on its digits.
test("a stamp lands on a whole millisecond", () => {
	const stamped = stampLine(draftOf([null, "one"], [null, "two"]), 0, 12.3456);
	assert.deepEqual(timesOf(stamped.draft), [12.346, null]);
});

test("stamping the last line keeps it selected", () => {
	const stamped = stampLine(draftOf([1, "one"], [null, "two"]), 1, 30);

	assert.deepEqual(timesOf(stamped.draft), [1, 30]);
	assert.equal(stamped.selected, 1);
});

test("editing a draft returns a new one and leaves the draft it was given as it was", () => {
	const draft = frozen(
		draftFromText(
			lrc("[ti:Leave]", "[00:10.00]one", "[00:20.00]two", "[00:40.00]three"),
		),
	);
	const before = structuredClone(draft);

	shiftAll(draft, 1);
	shiftLine(draft, 1, -1);
	stampLine(draft, 2, 45);

	assert.deepEqual(draft, before);
});

test("a timed draft is written as LRC: its headers first, then each line as [mm:ss.xx], an untimed line as bare text", () => {
	const draft: LyricDraft = {
		headers: ["[ti:Leave]", "[ar:Somebody]"],
		lines: [
			{ id: 1, at: 9.5, text: "one" },
			{ id: 2, at: null, text: "bare" },
			{ id: 3, at: 30, text: "" },
			{ id: 4, at: 42.347, text: "nearest" },
			{ id: 5, at: 3725.5, text: "late" },
		],
	};

	assert.deepEqual(rowsOf(serialiseDraft(draft)), [
		"[ti:Leave]",
		"[ar:Somebody]",
		"[00:09.50]one",
		"bare",
		"[00:30.00]",
		"[00:42.35]nearest",
		"[62:05.50]late",
	]);
});

test("a timed draft is written in its own order, not sorted by time", () => {
	assert.deepEqual(
		rowsOf(
			serialiseDraft(draftOf([30, "late"], [null, "bare"], [10, "early"])),
		),
		["[00:30.00]late", "bare", "[00:10.00]early"],
	);
});

// A player applies an LRC `[offset:]` tag on top of the times it is given.
test("a shifted lyric is written with the shift in its timestamps and no [offset:] tag", () => {
	const written = serialiseDraft(
		shiftAll(draftFromText(SYNCED_WITH_HEADERS), 1),
	);

	assert.doesNotMatch(written, /\[offset:/i);
	assert.ok(rowsOf(written).includes("[00:10.50]chorus"), written);
});

test("a draft with no timed line is written as plain text, with no header rows", () => {
	const draft: LyricDraft = {
		headers: ["[ti:Leave]", "[ar:Somebody]"],
		lines: [
			{ id: 1, at: null, text: "one" },
			{ id: 2, at: null, text: "" },
			{ id: 3, at: null, text: "two" },
		],
	};

	assert.equal(serialiseDraft(draft), "one\n\ntwo");
});

test("an LRC with headers and an offset, written from its draft, reads back to the same lines", () => {
	assert.deepEqual(
		inMs(roundTrip(SYNCED_WITH_HEADERS)),
		inMs(parseLyrics(SYNCED_WITH_HEADERS)),
	);
});

test("a partly timed draft, written and pasted back, keeps its headers, its times and its untimed lines", () => {
	const draft: LyricDraft = {
		headers: ["[ti:Leave]"],
		lines: [
			{ id: 1, at: null, text: "one" },
			{ id: 2, at: 12.5, text: "two" },
			{ id: 3, at: null, text: "" },
			{ id: 4, at: null, text: "three" },
		],
	};
	const back = draftFromText(serialiseDraft(draft));

	assert.deepEqual(back.headers, draft.headers);
	assert.deepEqual(shape(back.lines), shape(draft.lines));
});

test("plain text, written from its draft, reads back to the same lines", () => {
	const plain = lrc("one", "two", "", "three");
	assert.deepEqual(roundTrip(plain), parseLyrics(plain));
});

test("a timed line with no words survives being written and read back as a timed break", () => {
	const lyrics = parseLyrics(
		serialiseDraft(draftOf([10, "one"], [20, ""], [40, "three"])),
	);
	assert.deepEqual(lyrics, {
		kind: "synced",
		lines: [
			{ at: 10, text: "one" },
			{ at: 20, text: "" },
			{ at: 40, text: "three" },
		],
	});
});

// An LRC stamp is [mm:ss.xx], so `00:60.00` is not a valid one.
test("a time that rounds up to the next minute is written in that minute", () => {
	assert.deepEqual(rowsOf(serialiseDraft(draftOf([59.996, "two"]))), [
		"[01:00.00]two",
	]);
});
