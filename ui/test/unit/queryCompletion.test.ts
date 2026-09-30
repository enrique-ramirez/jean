import assert from "node:assert/strict";
import test from "node:test";

import {
	type Completion,
	completionsAt,
	quoteValue,
	type ValueSource,
} from "../../src/domain/library/queryCompletion.ts";

// Each field holds values no other field holds, so a value suggested from the
// wrong list is a value that cannot appear.
const VALUES: ValueSource = {
	artist: ["Beyoncé", "Alice in Chains", "Brand New"],
	"album artist": ["Various Artists", "Babasónicos"],
	album: ["Jar Of Flies", "Deja Entendu"],
	genre: ["Rock", 'Rock "n" Roll', "Pop"],
};

const OPERATORS = [
	"HAS",
	"IS",
	"MISSING",
	"PRESENT",
	"GREATER",
	"LESS",
	"EQUAL",
	"BEFORE",
	"AFTER",
	"SINCE",
	"DURING",
];

const JUNCTIONS = ["AND", "OR", "NOT", "SORT BY"];

const at = (text: string, caret = text.length) =>
	completionsAt(text, caret, VALUES);

const inserts = (completion: Completion) =>
	completion.suggestions.map((suggestion) => suggestion.insert);

const kinds = (completion: Completion) =>
	new Set(completion.suggestions.map((suggestion) => suggestion.kind));

// What the field holds once the suggestion is taken: the promise a person
// sees, whichever way `from` and `insert` split the work between them.
function accept(text: string, caret: number, insert: string): string {
	const completion = completionsAt(text, caret, VALUES);
	const chosen = completion.suggestions.find(
		(suggestion) => suggestion.insert === insert,
	);
	assert.ok(
		chosen,
		`no suggestion inserts ${insert} in ${inserts(completion)}`,
	);
	return (
		text.slice(0, completion.from) + chosen.insert + text.slice(completion.to)
	);
}

test("an empty query suggests field names, and a field with a space comes quoted", () => {
	const completion = at("");

	assert.equal(completion.from, 0);
	assert.equal(completion.to, 0);
	assert.deepEqual(kinds(completion), new Set(["field"]));
	for (const field of ["artist", "album", "genre", "title", "date", "rating"])
		assert.ok(inserts(completion).includes(field), field);
	// Bare, foobar2000 would read `album` as the field and `artist` as the operator.
	assert.ok(inserts(completion).includes('"album artist"'));
	assert.ok(!inserts(completion).includes("album artist"));
});

test("the prefix typed at the start of a term narrows the fields and is replaced by the one taken", () => {
	const completion = at("gen");

	assert.deepEqual(kinds(completion), new Set(["field"]));
	assert.ok(inserts(completion).includes("genre"));
	for (const other of ["artist", "album", "title", "date", "rating"])
		assert.ok(!inserts(completion).includes(other), other);
	assert.equal(accept("gen", 3, "genre"), "genre");
});

test("a field is suggested again at the start of the term after a junction", () => {
	const text = "artist IS Beyoncé AND ti";

	assert.deepEqual(kinds(at(text)), new Set(["field"]));
	assert.equal(
		accept(text, text.length, "title"),
		"artist IS Beyoncé AND title",
	);
});

test("after a field every operator is suggested, upper case", () => {
	for (const field of ["artist", "rating", '"album artist"']) {
		const completion = at(`${field} `);

		assert.deepEqual(kinds(completion), new Set(["operator"]), field);
		assert.deepEqual(
			[...inserts(completion)].sort(),
			[...OPERATORS].sort(),
			field,
		);
	}
});

test("an operator typed in lower case narrows the operators and is inserted upper case", () => {
	const completion = at("artist i");

	assert.ok(inserts(completion).includes("IS"));
	assert.ok(!inserts(completion).includes("HAS"));
	assert.equal(accept("artist i", 8, "IS"), "artist IS");
	assert.equal(accept("date bef", 8, "BEFORE"), "date BEFORE");
});

test("after IS or HAS each of the four fields suggests its own values and no other field's", () => {
	const text = (field: string, operator: string) =>
		`${field.includes(" ") ? `"${field}"` : field} ${operator} `;

	for (const operator of ["IS", "HAS"])
		for (const [field, own] of Object.entries(VALUES)) {
			const completion = at(text(field, operator));
			const offered = new Set(
				completion.suggestions
					.filter((suggestion) => suggestion.kind === "value")
					.map((suggestion) => suggestion.insert),
			);
			const expected = new Set(own.map(quoteValue));

			assert.deepEqual(offered, expected, `${field} ${operator}`);
			assert.deepEqual(
				kinds(completion),
				new Set(["value"]),
				`${field} ${operator}`,
			);
		}
});

test("no values are suggested for a field outside the four, or after an operator other than IS or HAS", () => {
	for (const text of [
		"title IS ",
		"rating HAS ",
		"date IS ",
		"artist GREATER ",
		"genre EQUAL ",
		"artist BEFORE ",
	])
		assert.ok(!kinds(at(text)).has("value"), text);
});

test("values match the typed prefix with case and accents folded", () => {
	assert.equal(accept("artist IS beyonce", 17, "Beyoncé"), "artist IS Beyoncé");
	assert.equal(
		accept("artist HAS BEYONCÉ", 18, "Beyoncé"),
		"artist HAS Beyoncé",
	);
	assert.equal(
		accept('"album artist" IS babason', 25, "Babasónicos"),
		'"album artist" IS Babasónicos',
	);

	const narrowed = inserts(at("artist IS beyonce"));
	assert.ok(!narrowed.includes('"Alice in Chains"'));
	assert.ok(!narrowed.includes('"Brand New"'));
});

test("a value holding a space or a quote is inserted quoted, the quote doubled", () => {
	assert.equal(
		accept("artist IS ali", 13, '"Alice in Chains"'),
		'artist IS "Alice in Chains"',
	);
	assert.equal(
		accept("genre IS rock", 13, '"Rock ""n"" Roll"'),
		'genre IS "Rock ""n"" Roll"',
	);

	const genres = inserts(at("genre IS ro"));
	assert.ok(genres.includes("Rock"));
	assert.ok(!genres.includes('"Pop"') && !genres.includes("Pop"));
});

test("inside an unclosed quote values still match on what follows the quote, and the quote is not doubled", () => {
	const text = 'artist IS "alice i';

	assert.deepEqual(kinds(at(text)), new Set(["value"]));
	assert.equal(
		accept(text, text.length, '"Alice in Chains"'),
		'artist IS "Alice in Chains"',
	);
	assert.equal(accept('artist IS "bey', 14, "Beyoncé"), "artist IS Beyoncé");
});

test("only the text before the caret decides, and the text after it is kept", () => {
	const text = "artist IS Beyo AND genre IS Rock";

	assert.equal(at(text, 14).to, 14);
	assert.equal(
		accept(text, 14, "Beyoncé"),
		"artist IS Beyoncé AND genre IS Rock",
	);
});

test("after a complete term the junctions are suggested", () => {
	for (const text of [
		"artist IS Beyoncé ",
		'artist IS "Alice in Chains" ',
		"genre HAS Rock AND title IS Intro ",
		// MISSING and PRESENT take no value, so the field and the operator are the whole term.
		"rating MISSING ",
		"rating PRESENT ",
	]) {
		const completion = at(text);

		assert.deepEqual(kinds(completion), new Set(["junction"]), text);
		assert.deepEqual(
			[...inserts(completion)].sort(),
			[...JUNCTIONS].sort(),
			text,
		);
	}
});

test("a junction typed in lower case narrows the junctions and is inserted upper case", () => {
	assert.deepEqual(inserts(at("artist IS Beyoncé o")), ["OR"]);
	assert.equal(accept("artist IS Beyoncé o", 19, "OR"), "artist IS Beyoncé OR");
	assert.equal(
		accept("artist IS Beyoncé sor", 21, "SORT BY"),
		"artist IS Beyoncé SORT BY",
	);
});

test("quoteValue leaves a plain value bare, accented or not", () => {
	assert.equal(quoteValue("Rock"), "Rock");
	assert.equal(quoteValue("Beyoncé"), "Beyoncé");
});

test("quoteValue quotes a value holding a space, a double quote or a keyword, and doubles an inner quote", () => {
	assert.equal(quoteValue("Alice in Chains"), '"Alice in Chains"');
	assert.equal(quoteValue('Say"'), '"Say"""');
	assert.equal(quoteValue('Rock "n" Roll'), '"Rock ""n"" Roll"');
	// Bare, the player would read each of these as the keyword rather than the value.
	for (const keyword of ["AND", "OR", "NOT", "IS", "HAS", "MISSING"])
		assert.equal(quoteValue(keyword), `"${keyword}"`, keyword);
});

// foobar2000 groups terms in parentheses, so an opening one starts a term just
// as the start of the query does.
test("after an opening parenthesis, with or without a space, fields are suggested and the parenthesis is kept", () => {
	for (const text of [
		"(",
		"( ",
		"NOT (",
		"NOT ( ",
		"genre IS Rock AND (",
		"genre IS Rock OR ( ",
	]) {
		const completion = at(text);

		assert.deepEqual(kinds(completion), new Set(["field"]), text);
		assert.ok(inserts(completion).includes("artist"), text);
		assert.ok(inserts(completion).includes("genre"), text);
		assert.equal(accept(text, text.length, "genre"), `${text}genre`, text);
	}
});

test("a prefix typed after an opening parenthesis narrows the fields and never eats the parenthesis", () => {
	for (const [text, field, taken] of [
		["(gen", "genre", "(genre"],
		["NOT (gen", "genre", "NOT (genre"],
		["genre IS Rock AND (ti", "title", "genre IS Rock AND (title"],
	]) {
		const completion = at(text);

		assert.deepEqual(kinds(completion), new Set(["field"]), text);
		assert.ok(!inserts(completion).includes("artist"), text);
		assert.equal(accept(text, text.length, field), taken, text);
	}
});

test("after a closed group the junctions are suggested", () => {
	for (const text of [
		"(genre IS Rock) ",
		"NOT (artist IS Beyoncé OR artist IS Brand) ",
	]) {
		const completion = at(text);

		assert.deepEqual(kinds(completion), new Set(["junction"]), text);
		assert.deepEqual(
			[...inserts(completion)].sort(),
			[...JUNCTIONS].sort(),
			text,
		);
	}
});
