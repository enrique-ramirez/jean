import assert from "node:assert/strict";
import test from "node:test";

import type { Member } from "../../src/domain/artist/credits.ts";
import { creditSpans } from "../../src/domain/track/creditSpans.ts";

const member = (name: string, isGuest = false): Member => ({
	name,
	key: name.toLowerCase(),
	isGuest,
});

const linked = (credit: string, members: Member[]) =>
	creditSpans(credit, members).map((span) =>
		span.name === null ? span.text : `[${span.text}→${span.name}]`,
	);

test("each member the library names becomes a stretch of its own, the joiners staying as tagged", () => {
	assert.deepEqual(
		linked("Marshmello, YUNGBLUD & blackbear", [
			member("Marshmello"),
			member("YUNGBLUD"),
			member("blackbear"),
		]),
		[
			"[Marshmello→Marshmello]",
			", ",
			"[YUNGBLUD→YUNGBLUD]",
			" & ",
			"[blackbear→blackbear]",
		],
	);
});

test("the credit's own spelling is drawn and the member's names the address", () => {
	assert.deepEqual(
		linked("tv on the radio & Yeah Yeah Yeahs", [
			member("TV On The Radio"),
			member("Yeah Yeah Yeahs"),
		]),
		[
			"[tv on the radio→TV On The Radio]",
			" & ",
			"[Yeah Yeah Yeahs→Yeah Yeah Yeahs]",
		],
	);
});

test("a name is only found whole, so Kid does not cut Kidz Bop", () => {
	assert.deepEqual(
		linked("Kidz Bop & Kid", [member("Kid"), member("Kidz Bop")]),
		["[Kidz Bop→Kidz Bop]", " & ", "[Kid→Kid]"],
	);
});

test("a member the credit does not spell is left out, and the rest still link", () => {
	assert.deepEqual(
		linked("Alice in Chains, Mad Season", [
			member("Alice in Chains"),
			member("Someone Else"),
		]),
		["[Alice in Chains→Alice in Chains]", ", Mad Season"],
	);
});

test("with no member found, feat. is the one split, and the lead carries the whole of what precedes it", () => {
	assert.deepEqual(linked("Blood, Sweat & Tears feat. Nobody", []), [
		"[Blood, Sweat & Tears→Blood, Sweat & Tears]",
		" feat. ",
		"[Nobody→Nobody]",
	]);
	assert.deepEqual(linked("Blood, Sweat & Tears", [member("Unrelated")]), [
		"[Blood, Sweat & Tears→Blood, Sweat & Tears]",
	]);
});

test("Various Artists is never somewhere to go, as a member or as the lead", () => {
	assert.deepEqual(linked("Various Artists", [member("Various Artists")]), [
		"Various Artists",
	]);
	assert.deepEqual(linked("Various Artists feat. Someone", []), [
		"Various Artists",
		" feat. ",
		"[Someone→Someone]",
	]);
});
