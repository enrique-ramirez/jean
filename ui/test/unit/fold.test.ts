import assert from "node:assert/strict";
import test from "node:test";

import {
	fold,
	fuzzyKey,
	fuzzyScore,
	glyphs,
	nameKey,
	squash,
	TIER,
	tokenize,
} from "../../src/shared/lib/text.ts";
import { QUESTIONS_FILE, questionsFile } from "./caseFiles.ts";

test("a letter with no decomposition folds to the ASCII letters CLDR spells it with", () => {
	assert.equal(fold("MØ"), "mo");
	assert.equal(fold("Mœnia"), "moenia");
	assert.equal(fold("Straße"), "strasse");
	assert.equal(fold("Łódź"), "lodz");
	assert.equal(fold("Æon"), "aeon");
	assert.equal(fold("Þórr"), "thorr");
	assert.equal(fold("ı"), "i");
	assert.equal(fold("Ｆｕｌｌ Ｗｉｄｔｈ １２３"), "full width 123");
});

test("an accented letter without a decomposition is folded once its accent is off", () => {
	assert.equal(fold("Ǿ"), "o");
});

test("every dot-like mark folds to a full stop and every dash to a hyphen, the middle dot included", () => {
	assert.equal(fold("· • ‧ ∙ ⋅ ・ ･"), ". . . . . . .");
	assert.equal(fold("— – ‐ － −"), "- - - - -");
	assert.equal(fold("･ ･－･ ･－ ･･･ ･ －･･"), ". .-. .- ... . -..");
});

test("whitespace of every width folds to a space", () => {
	assert.equal(fold("a b　c"), "a b c");
});

test("glyphs are the folded text with its whitespace gone", () => {
	assert.equal(glyphs("･ ･－･ ･－ ･･･ ･ －･･"), "..-..-....-..");
	assert.equal(glyphs("  — · —  "), "-.-");
	assert.equal(glyphs("Star-Lord's Jams"), "star-lord'sjams");
});

test("a name's key is its letters, and its marks only where it has no letters", () => {
	assert.equal(nameKey("Star-Lord"), "starlord");
	assert.equal(nameKey("!!!"), "!!!");
	assert.equal(nameKey("･ ･－･ ･－ ･･･ ･ －･･"), "..-..-....-..");
	assert.equal(nameKey("   "), "");
	assert.equal(squash("!!!"), "");
});

test(`every text in ${QUESTIONS_FILE} folds, squashes and splits as the file says, so the client folds a query as foo_jean folds the library`, () => {
	const entries = questionsFile().fold;
	assert.ok(entries.length > 0);
	for (const entry of entries)
		assert.deepEqual(
			{
				fold: fold(entry.text),
				squash: squash(entry.text),
				tokenize: tokenize(entry.text),
			},
			{ fold: entry.fold, squash: entry.squash, tokenize: entry.tokenize },
			JSON.stringify(entry.text),
		);
});

test("a morse name is named by its marks however the query is spaced, and never by letters", () => {
	const morse = fuzzyKey("･ ･－･ ･－ ･･･ ･ －･･");
	for (const typed of ["..-..-....-..", ". .-. .- ... . -..", "..-..-... .-.."])
		assert.ok(fuzzyScore(morse, nameKey(typed)) >= TIER.exact, typed);
	assert.ok(fuzzyScore(morse, nameKey("-..")) >= TIER.word, "one letter");
	assert.equal(fuzzyScore(morse, nameKey("erased")), 0);
	assert.equal(fuzzyScore(fuzzyKey("Star-Lord"), nameKey("-")), 0);
});
