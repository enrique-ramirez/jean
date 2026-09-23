import assert from "node:assert/strict";
import test from "node:test";
import {
	LYRICS_EXPRESSIONS,
	NOW_PLAYING_EXPRESSIONS,
} from "../../src/features/now-playing/nowPlayingFields.ts";

// `now-playing-panels.spec.ts` is where the details read is watched filling the
// panel. What stays here is what no browser can see: which expressions the read
// asks the player for.

// The playing-track route answers the track's identity beside its columns, so
// asking for it again as a column is a second, unchecked copy of the same fact.
for (const [name, expressions] of [
	["NOW_PLAYING_EXPRESSIONS", NOW_PLAYING_EXPRESSIONS],
	["LYRICS_EXPRESSIONS", LYRICS_EXPRESSIONS],
] as const) {
	test(`${name} asks for neither %path% nor %subsong%`, () => {
		assert.deepEqual(
			expressions.filter(
				(expression) => expression === "%path%" || expression === "%subsong%",
			),
			[],
		);
	});
}
