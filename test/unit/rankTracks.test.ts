import assert from "node:assert/strict";
import test from "node:test";

import { bestMatches } from "../../src/domain/track/rankTracks.ts";
import { type RowText, rowMatches } from "../../src/domain/track/searchText.ts";
import { fold, tokenize } from "../../src/shared/lib/text.ts";

const LIBRARY: [title: string, artist: string, album: string][] = [
	["Life Is Bloody", "2 Mello", "Nastlevania"],
	["Cosmos Be Damned (Youngbloodz vs. FFVII Mashup)", "2 Mello", "Nastlevania"],
	["Dreadlock Holiday", "10cc", "Bloody Tourists"],
	["For You and I", "10cc", "Bloody Tourists"],
	["Take These Chains", "10cc", "Bloody Tourists"],
	["Blood", "Pearl Jam", "Vs."],
	["BLOOD.", "Kendrick Lamar", "DAMN."],
	["Bloodstain", "UNKLE", "Psyence Fiction"],
	["Blood Tears", "Blind Guardian", "Nightfall in Middle-Earth"],
	["It's Only Natural", "Blood Red Shoes", "Get Tragic"],
	["Sabbath Bloody Sabbath", "Black Sabbath", "Sabbath Bloody Sabbath"],
];

const index: RowText[] = LIBRARY.map(([title, artist, album]) => ({
	title: fold(title),
	artist: fold(artist),
	album: fold(album),
}));

const preview = (query: string, limit = 5) => {
	const tokens = tokenize(query);
	const matched = index.flatMap((text, at) =>
		rowMatches(text, tokens) ? at : [],
	);

	return bestMatches(index, matched, query, limit).map(
		(position) => LIBRARY[matched[position]][0],
	);
};

test("an exact title wins, and a near-exact one is next", () => {
	assert.deepEqual(preview("blood", 2), ["Blood", "BLOOD."]);
});

test("a title that starts with the word beats one that only contains it", () => {
	const ranked = preview("blood", 11);
	assert.ok(
		ranked.indexOf("Bloodstain") <
			ranked.indexOf("Cosmos Be Damned (Youngbloodz vs. FFVII Mashup)"),
	);
});

test("an album tag does not carry its track list over the songs that match", () => {
	const ranked = preview("blood", 11);
	const firstAlbumOnly = ranked.indexOf("Dreadlock Holiday");

	for (const title of ["Blood", "BLOOD.", "Bloodstain", "Blood Tears"])
		assert.ok(
			ranked.indexOf(title) < firstAlbumOnly,
			`${title} should outrank a track that only matched on its album`,
		);
});

test("an artist counts for more than an album and less than a title", () => {
	const ranked = preview("blood", 11);
	assert.ok(
		ranked.indexOf("It's Only Natural") < ranked.indexOf("For You and I"),
	);
	assert.ok(
		ranked.indexOf("Blood Tears") < ranked.indexOf("It's Only Natural"),
	);
});

test("every token has to land, and a second one sharpens the order", () => {
	assert.deepEqual(preview("bloody sabbath", 3), ["Sabbath Bloody Sabbath"]);
});

test("no query is no preview, however many rows are in front of it", () => {
	assert.deepEqual(preview("   "), []);
});

test("the limit is a limit, and asking for none returns none", () => {
	assert.equal(preview("blood", 3).length, 3);
	assert.deepEqual(bestMatches(index, [0, 1, 2], "blood", 0), []);
});

test("ties keep the order the results page is in", () => {
	const twice: RowText[] = [
		{ title: fold("Blood"), artist: fold("A"), album: fold("One") },
		{ title: fold("Blood"), artist: fold("B"), album: fold("Two") },
	];

	assert.deepEqual(bestMatches(twice, [0, 1], "blood", 2), [0, 1]);
	assert.deepEqual(bestMatches(twice, [1, 0], "blood", 2), [0, 1]);
});
