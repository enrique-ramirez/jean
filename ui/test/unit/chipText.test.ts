import assert from "node:assert/strict";
import test from "node:test";

import { chipsFrom, textOf } from "../../src/domain/track/chipText.ts";

test("each unescaped semicolon splits the text into chips in the order typed", () => {
	assert.deepEqual(chipsFrom("Zoë;Ann;Mei", []), ["Zoë", "Ann", "Mei"]);
});

test("a trailing semicolon makes no empty chip", () => {
	assert.deepEqual(chipsFrom("Ann;", []), ["Ann"]);
	assert.deepEqual(chipsFrom(";", []), []);
});

test("two semicolons together make no empty chip between them", () => {
	assert.deepEqual(chipsFrom("Ann;;Bob", []), ["Ann", "Bob"]);
	assert.deepEqual(chipsFrom(";;", []), []);
});

test("each part loses the whitespace around it and keeps the whitespace inside it", () => {
	assert.deepEqual(chipsFrom("  Ann  Lee ;\tBob ", []), ["Ann  Lee", "Bob"]);
});

test("whitespace alone, or between separators, makes no chip", () => {
	assert.deepEqual(chipsFrom("   ", []), []);
	assert.deepEqual(chipsFrom(" ; \t; ", []), []);
	assert.deepEqual(chipsFrom("", []), []);
});

test("a backslash before a semicolon keeps the text one chip holding a literal semicolon", () => {
	assert.deepEqual(chipsFrom("Simon \\; Garfunkel", []), ["Simon ; Garfunkel"]);
	assert.deepEqual(chipsFrom("a\\;b;c", []), ["a;b", "c"]);
});

test("a backslash before anything but a semicolon stays as typed, a lone trailing one included", () => {
	assert.deepEqual(chipsFrom("AC\\DC", []), ["AC\\DC"]);
	assert.deepEqual(chipsFrom("Ann\\", []), ["Ann\\"]);
	assert.deepEqual(chipsFrom("\\", []), ["\\"]);
	assert.deepEqual(chipsFrom("Ann\\;Bob\\", []), ["Ann;Bob\\"]);
});

test("a comma never splits", () => {
	assert.deepEqual(chipsFrom("Crosby, Stills, Nash & Young", []), [
		"Crosby, Stills, Nash & Young",
	]);
	assert.deepEqual(chipsFrom("Ann,;Bob", []), ["Ann,", "Bob"]);
});

test("a part equal to a chip the field already holds makes no second chip", () => {
	assert.deepEqual(chipsFrom("Bob;Cat", ["Ann", "Bob"]), ["Cat"]);
	// Compared once trimmed and unescaped, as the chip it would have made.
	assert.deepEqual(chipsFrom("  Bob ", ["Bob"]), []);
	assert.deepEqual(chipsFrom("a\\;b", ["a;b"]), []);
});

test("a part repeated within one text makes one chip, where it first appears", () => {
	assert.deepEqual(chipsFrom("Bob;Ann;Bob", []), ["Bob", "Ann"]);
});

test("a pasted text splits at each line break as it does at a semicolon", () => {
	assert.deepEqual(chipsFrom("Zoë\nAnn\r\nMei", []), ["Zoë", "Ann", "Mei"]);
	assert.deepEqual(chipsFrom("Zoë;Ann\nMei;\n\nBob\r\n", []), [
		"Zoë",
		"Ann",
		"Mei",
		"Bob",
	]);
});

test("a chip goes back to text with each literal semicolon written as an escaped one", () => {
	assert.equal(textOf("Simon ; Garfunkel"), "Simon \\; Garfunkel");
	assert.equal(textOf(";;"), "\\;\\;");
	assert.equal(textOf("AC\\DC"), "AC\\DC");
});

test("a chip written back as text and split again is the same one chip", () => {
	// Only chips without surrounding whitespace, which the split trims away.
	for (const chip of [
		"Nina Simone",
		"Simon ; Garfunkel",
		";",
		"a;b;c",
		"AC\\DC",
		"Ann\\",
		"x\\;y",
		"Crosby, Stills",
	]) {
		const text = textOf(chip);
		assert.deepEqual(chipsFrom(text, []), [chip], JSON.stringify(chip));
		assert.equal(textOf(chipsFrom(text, [])[0]), text, JSON.stringify(chip));
	}
});
