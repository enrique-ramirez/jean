import assert from "node:assert/strict";
import test from "node:test";

import {
	FIELD,
	lastPlayedIn,
	lastPlayedOf,
	playCountOf,
	playCountsIn,
	readTimestamp,
	TRACK_EXPRESSIONS,
} from "../../src/domain/track/fields.ts";
import { rowAt } from "../../src/domain/track/libraryColumns.ts";
import {
	NOW_PLAYING_EXPRESSIONS,
	NOW_PLAYING_FIELD,
	readNowPlaying,
} from "../../src/features/now-playing/nowPlayingFields.ts";
import { libraryColumnsOf } from "./libraryTable.ts";

const EARLY = "2025-03-01 09:00:00";
const LATE = "2026-08-30 22:49:08";

const NO_ANSWER = ["?", "", "N/A", "0"];

interface Sources {
	scrobbled: string;
	local: string;
}

const libraryWith = (
	field: number,
	local: number,
	sources: readonly Sources[],
) =>
	libraryColumnsOf(
		sources.map(({ scrobbled, local: here }) => {
			const columns: string[] = new Array(TRACK_EXPRESSIONS.length).fill("?");
			columns[field] = scrobbled;
			columns[local] = here;
			return columns;
		}),
		TRACK_EXPRESSIONS.length,
	);

const playCountsOf = (sources: readonly Sources[]) => {
	const columns = libraryWith(FIELD.playCount, FIELD.playCountLocal, sources);
	const swept = playCountsIn(columns);
	return sources.map((_, ref) => {
		const row = playCountOf(rowAt(columns, ref));
		assert.equal(swept(ref), row, `track ${ref} swept and read disagree`);
		return row;
	});
};

const lastPlayedTimes = (sources: readonly Sources[]) => {
	const columns = libraryWith(FIELD.lastPlayed, FIELD.lastPlayedLocal, sources);
	const swept = lastPlayedIn(columns);
	return sources.map((_, ref) => {
		const row = lastPlayedOf(rowAt(columns, ref));
		assert.equal(swept(ref), row, `track ${ref} swept and read disagree`);
		return row;
	});
};

const nowPlaying = (field: number, local: number, sources: Sources) => {
	const row: string[] = new Array(NOW_PLAYING_EXPRESSIONS.length).fill("?");
	row[field] = sources.scrobbled;
	row[local] = sources.local;
	return readNowPlaying(row, field);
};

test("the play count is last.fm's where it is the higher", () => {
	assert.deepEqual(playCountsOf([{ scrobbled: "108", local: "42" }]), [108]);
});

test("the play count is this machine's where last.fm is behind it", () => {
	assert.deepEqual(playCountsOf([{ scrobbled: "42", local: "108" }]), [108]);
});

// foo_enhanced_playcount answers 0 for a track last.fm has not matched.
test("a real 0 against a real 4 is 4, from either side", () => {
	assert.deepEqual(
		playCountsOf([
			{ scrobbled: "0", local: "4" },
			{ scrobbled: "4", local: "0" },
		]),
		[4, 4],
	);
});

test("a track only one component counted shows that component's count", () => {
	for (const missing of NO_ANSWER) {
		assert.deepEqual(
			playCountsOf([
				{ scrobbled: "7", local: missing },
				{ scrobbled: missing, local: "7" },
			]),
			[7, 7],
			`with the other side answering ${JSON.stringify(missing)}`,
		);
	}
});

test("a track neither component counted has no play count", () => {
	for (const scrobbled of NO_ANSWER)
		for (const local of NO_ANSWER)
			assert.deepEqual(
				playCountsOf([{ scrobbled, local }]),
				[null],
				`with ${JSON.stringify(scrobbled)} and ${JSON.stringify(local)}`,
			);
});

test("the last play is the later of the two, whichever side holds it", () => {
	assert.deepEqual(
		lastPlayedTimes([
			{ scrobbled: LATE, local: EARLY },
			{ scrobbled: EARLY, local: LATE },
		]),
		[readTimestamp(LATE), readTimestamp(LATE)],
	);
});

test("a last play only one component saw is that component's", () => {
	for (const missing of NO_ANSWER) {
		assert.deepEqual(
			lastPlayedTimes([
				{ scrobbled: EARLY, local: missing },
				{ scrobbled: missing, local: EARLY },
			]),
			[readTimestamp(EARLY), readTimestamp(EARLY)],
			`with the other side answering ${JSON.stringify(missing)}`,
		);
	}
});

test("a track neither component saw played has no last play", () => {
	assert.deepEqual(lastPlayedTimes([{ scrobbled: "N/A", local: "?" }]), [null]);
});

const F = NOW_PLAYING_FIELD;

test("now playing shows the higher count", () => {
	assert.equal(
		nowPlaying(F.playCount, F.playCountLocal, {
			scrobbled: "0",
			local: "4",
		}),
		"4",
	);
	assert.equal(
		nowPlaying(F.playCount, F.playCountLocal, {
			scrobbled: "12",
			local: "4",
		}),
		"12",
	);
});

test("now playing shows the later last play and the earlier first play", () => {
	for (const [scrobbled, local] of [
		[EARLY, LATE],
		[LATE, EARLY],
	]) {
		const sources = { scrobbled, local };
		assert.equal(
			nowPlaying(F.lastPlayed, F.lastPlayedLocal, sources),
			LATE,
			`last played from ${JSON.stringify(sources)}`,
		);
		assert.equal(
			nowPlaying(F.firstPlayed, F.firstPlayedLocal, sources),
			EARLY,
			`first played from ${JSON.stringify(sources)}`,
		);
	}
});

test("now playing shows the one first play a component answered", () => {
	assert.equal(
		nowPlaying(F.firstPlayed, F.firstPlayedLocal, {
			scrobbled: "N/A",
			local: EARLY,
		}),
		EARLY,
	);
	assert.equal(
		nowPlaying(F.firstPlayed, F.firstPlayedLocal, {
			scrobbled: LATE,
			local: "?",
		}),
		LATE,
	);
});

test("now playing compares counts as numbers rather than as text", () => {
	assert.equal(
		nowPlaying(F.playCount, F.playCountLocal, { scrobbled: "9", local: "10" }),
		"10",
	);
});

test("a field with no partner reads as the player answered it", () => {
	const row: string[] = new Array(NOW_PLAYING_EXPRESSIONS.length).fill("?");
	row[F.bpm] = "120";
	assert.equal(readNowPlaying(row, F.bpm), "120");
});
