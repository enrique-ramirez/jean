import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { en } from "../../src/shared/i18n/en.ts";
import {
	fill,
	formOf,
	type Message,
	type Values,
} from "../../src/shared/i18n/message.ts";

const FOLDER = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../public/locales",
);

const shipped = (() => {
	try {
		return readdirSync(FOLDER).filter((name) => name.endsWith(".json"));
	} catch {
		return [];
	}
})();

const fieldsOf = (message: Message): Set<string> => {
	const forms =
		typeof message === "string" ? [message] : Object.values(message ?? {});
	return new Set(
		forms
			.flatMap((form) => [...String(form).matchAll(/\{(\w+)\}/g)])
			.map((match) => match[1]),
	);
};

test("the English catalogue is sorted, so a translator can diff two releases", () => {
	const keys = Object.keys(en);
	assert.deepEqual(keys, [...keys].sort());
});

test("every English plural carries `other`, which is the only form every language has", () => {
	for (const [key, message] of Object.entries(en))
		if (typeof message !== "string")
			assert.ok(
				typeof (message as { other?: unknown }).other === "string",
				`${key} has no 'other' form`,
			);
});

const PLURALS = new Intl.PluralRules("en");
const NUMBERS = new Intl.NumberFormat("en");

const reading = (message: Message, values: Values) =>
	fill(formOf(message, values, PLURALS), values, NUMBERS);

// `formOf` selects on `count` and on no other field, so a phrase counting
// anything else has a singular nobody ever sees.
test("the rating that did not land counts its stars, so one star never reads as '1 stars'", () => {
	const message = en["rate.didNotLand"];
	const one = { track: "Fizz", count: 1 };

	assert.notEqual(
		formOf(message, one, PLURALS),
		formOf(message, { ...one, count: 4 }, PLURALS),
		"rate.didNotLand reads the same for one star as for four",
	);
	assert.ok(
		!reading(message, one).includes("{"),
		`rate.didNotLand reads as '${reading(message, one)}', so the number it selects on is not the one it names`,
	);
});

for (const file of shipped) {
	const code = file.slice(0, -".json".length);
	const catalogue = JSON.parse(readFileSync(join(FOLDER, file), "utf8")) as
		| Record<string, Message>
		| unknown;

	test(`${code} is an object of phrases Jean still has`, () => {
		assert.ok(
			typeof catalogue === "object" &&
				catalogue !== null &&
				!Array.isArray(catalogue),
			`${file} is not an object`,
		);

		for (const key of Object.keys(catalogue as object))
			assert.ok(
				key in en,
				`${file} carries '${key}', which Jean no longer has`,
			);
	});

	test(`${code} fills the fields its English carries and invents none`, () => {
		for (const [key, message] of Object.entries(
			catalogue as Record<string, Message>,
		)) {
			if (!(key in en)) continue;

			const english = fieldsOf(en[key as keyof typeof en]);
			const translated = fieldsOf(message);
			for (const field of translated)
				assert.ok(
					english.has(field),
					`${file}: '${key}' fills {${field}}, which its English does not have`,
				);
			// The other direction, which is the one a reader sees: a phrase that
			// never names a field is rendered with the value missing and nothing
			// to say it is gone. Across the forms together, since a language may
			// spell its singular without the number.
			for (const field of english)
				assert.ok(
					translated.has(field),
					`${file}: '${key}' names {${field}} in no form, so it renders without it`,
				);
		}
	});

	test(`${code} spells its plurals the way Intl selects them`, () => {
		const allowed = new Set(["zero", "one", "two", "few", "many", "other"]);

		for (const [key, message] of Object.entries(
			catalogue as Record<string, Message>,
		)) {
			if (typeof message === "string") continue;

			assert.ok(
				typeof message.other === "string",
				`${file}: '${key}' has no 'other' form`,
			);
			for (const form of Object.keys(message))
				assert.ok(allowed.has(form), `${file}: '${key}' has no form '${form}'`);
		}
	});
}
