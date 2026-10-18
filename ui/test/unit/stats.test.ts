import assert from "node:assert/strict";
import test from "node:test";
import {
	FIELD,
	readTimestamp,
	TRACK_EXPRESSIONS,
} from "../../src/domain/track/fields.ts";
import { libraryColumnsOf } from "../../src/domain/track/libraryColumns.ts";
import { type Refs, trackRows } from "../../src/domain/track/project.ts";
import {
	formatDuration,
	spellDuration,
	summarise,
} from "../../src/domain/track/stats.ts";

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

const EARLY = "2025-03-01 09:00:00";
const MIDDLE = "2025-11-14 18:30:00";
const LATE = "2026-08-30 22:49:08";

interface Track {
	title: string;
	plays?: string;
	playsHere?: string;
	lastPlayed?: string;
	lastPlayedHere?: string;
	seconds?: string;
	year?: string;
	genre?: string;
}

const rowOf = (track: Track) => {
	const row: string[] = new Array(TRACK_EXPRESSIONS.length).fill("?");
	row[FIELD.title] = track.title;
	row[FIELD.playCount] = track.plays ?? "?";
	row[FIELD.playCountLocal] = track.playsHere ?? "?";
	row[FIELD.lastPlayed] = track.lastPlayed ?? "?";
	row[FIELD.lastPlayedLocal] = track.lastPlayedHere ?? "?";
	row[FIELD.duration] = track.seconds ?? "?";
	row[FIELD.year] = track.year ?? "?";
	row[FIELD.genre] = track.genre ?? "?";
	return row;
};

const rowsOf = (tracks: readonly Track[], indices: Refs | null = null) =>
	trackRows(
		libraryColumnsOf(tracks.map(rowOf), TRACK_EXPRESSIONS.length),
		indices,
	);

const historyIn = (rows: ReturnType<typeof rowsOf>) => {
	const { plays, unplayed, lastPlayed, mostPlayed } = summarise(rows);
	return { plays, unplayed, lastPlayed, mostPlayed };
};

const NOTHING = { plays: 0, unplayed: 0, lastPlayed: null, mostPlayed: null };

test("an empty set has no plays, no last play and no most played", () => {
	assert.deepEqual(historyIn(rowsOf([])), NOTHING);
	// The set is the rows, never the library behind them: a library full of plays
	// with none of its tracks chosen is still an empty set.
	const played = [{ title: "Played", plays: "12", lastPlayed: LATE }];
	assert.deepEqual(historyIn(rowsOf(played, [])), NOTHING);
});

test("a set nobody counted is every track unplayed, with no last play and no most played", () => {
	// `0` is foo_enhanced_playcount's answer for a track last.fm has not matched,
	// so it reads as no count, as `?`, `N/A` and an empty value do.
	const tracks: Track[] = [
		{ title: "Unresolved" },
		{ title: "Unmatched", plays: "0", lastPlayed: "N/A" },
		{ title: "Blank", plays: "", playsHere: "", lastPlayedHere: "" },
		{ title: "Not available", plays: "N/A", playsHere: "N/A" },
	];
	assert.deepEqual(historyIn(rowsOf(tracks)), {
		plays: 0,
		unplayed: 4,
		lastPlayed: null,
		mostPlayed: null,
	});
});

test("a set with one played track counts its plays, its last play and names it most played by its position", () => {
	const tracks: Track[] = [
		{ title: "Played", plays: "5", playsHere: "7", lastPlayed: LATE },
		{ title: "Never", plays: "0" },
		{ title: "Untagged" },
	];
	// The rows run in an order of their own, so the played track's position (1)
	// is not its ref (0).
	const rows = rowsOf(tracks, [2, 0, 1]);
	assert.deepEqual(historyIn(rows), {
		plays: 7,
		unplayed: 2,
		lastPlayed: readTimestamp(LATE),
		mostPlayed: { position: 1, plays: 7 },
	});
	assert.equal(rows.at(1)[FIELD.title], "Played");
});

test("a tie for most played goes to the track first in the rows, and the last play is the latest of any track", () => {
	const tracks: Track[] = [
		{ title: "Tied, later in the rows", plays: "9", lastPlayed: EARLY },
		{ title: "First played", plays: "3", lastPlayedHere: MIDDLE },
		{ title: "Tied, first in the rows", plays: "2", playsHere: "9" },
		{ title: "Never", plays: "0" },
		{
			title: "Played last",
			playsHere: "4",
			lastPlayed: EARLY,
			lastPlayedHere: LATE,
		},
	];
	// Row order runs 1, 2, 3, 0, 4: the tie's first track in the rows (ref 2,
	// position 1) is not the first in the library (ref 0, position 3), and the
	// track played most recently is neither of them.
	const rows = rowsOf(tracks, [1, 2, 3, 0, 4]);
	assert.deepEqual(historyIn(rows), {
		plays: 25,
		unplayed: 1,
		lastPlayed: readTimestamp(LATE),
		mostPlayed: { position: 1, plays: 9 },
	});
	assert.equal(rows.at(1)[FIELD.title], "Tied, first in the rows");
});

test("the figures the summary already gave are the same beside the plays", () => {
	const tracks: Track[] = [
		{ title: "One", plays: "5", seconds: "240", year: "1971", genre: "Jazz" },
		{ title: "Two", seconds: "300", year: "1968", genre: "Jazz" },
		{ title: "Three", plays: "0", seconds: "60", year: "1975", genre: "Soul" },
		{ title: "Four", seconds: "100", year: "1969", genre: "Jazz" },
	];
	const { plays, unplayed, lastPlayed, mostPlayed, ...before } = summarise(
		rowsOf(tracks),
	);
	assert.deepEqual(before, {
		trackCount: 4,
		seconds: 700,
		earliest: 1968,
		latest: 1975,
		genreCount: 2,
		topGenres: [
			{ name: "Jazz", count: 3, share: 75 },
			{ name: "Soul", count: 1, share: 25 },
		],
		playedShare: 0.25,
	});
});

test("the played share is the part of the rows with a play, 0 for an empty set", () => {
	const unplayed: Track = { title: "Never", plays: "0" };
	const played: Track = { title: "Played", plays: "2", playsHere: "6" };
	const shareOf = (tracks: Track[], indices: Refs | null = null) =>
		summarise(rowsOf(tracks, indices)).playedShare;
	// Read together, so one failure shows all four.
	assert.deepEqual(
		{
			nobodyCounted: shareOf([{ title: "Untagged" }, unplayed, unplayed]),
			oneOfFour: shareOf([unplayed, played, { title: "Untagged" }, unplayed]),
			allPlayed: shareOf([played, { ...played, plays: "1", playsHere: "?" }]),
			// A library full of plays with none of its tracks chosen.
			empty: shareOf([played, played], []),
		},
		{ nobodyCounted: 0, oneOfFour: 0.25, allPlayed: 1, empty: 0 },
	);
});
