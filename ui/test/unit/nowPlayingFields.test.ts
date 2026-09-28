import assert from "node:assert/strict";
import test from "node:test";

import { NOW_PLAYING_EXPRESSIONS } from "../../src/features/now-playing/nowPlayingFields.ts";

// `%comment%` on a real library is mostly ReplayGain hex an old tagger wrote
// there, and the identifier fields and MusicBrainz ids are next to never set.
// A Details row for any of them is noise on the few files that carry one.
const LEFT_OUT = [
	"comment",
	"isrc",
	"barcode",
	"catalognumber",
	"label",
	"media",
	"mood",
	"style",
	"key",
	"language",
];

// A field is reached as `%name%` or through `$meta(name)` and its kin, and
// foobar2000 matches field names without regard to case.
const fieldsNamed = (expression: string): string[] =>
	[
		...expression.matchAll(/%([^%]+)%/g),
		...expression.matchAll(/\$(?:meta|meta_sep|meta_num|info)\(([^,)]+)/g),
	].map((match) => match[1].trim().toLowerCase());

test("the details panel asks the player for no comment, identifier or MusicBrainz field", () => {
	const asked = NOW_PLAYING_EXPRESSIONS.flatMap(fieldsNamed);

	assert.ok(asked.length > 0, "no field was read out of the expressions");
	assert.deepEqual(
		asked.filter(
			(field) => LEFT_OUT.includes(field) || field.startsWith("musicbrainz"),
		),
		[],
	);
});
