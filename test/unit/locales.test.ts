import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { en } from "../../src/shared/i18n/en.ts";
import type { Message } from "../../src/shared/i18n/message.ts";

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
			for (const field of fieldsOf(message))
				assert.ok(
					english.has(field),
					`${file}: '${key}' fills {${field}}, which its English does not have`,
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
