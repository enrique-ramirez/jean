import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../../src/shared/i18n/en.ts";
import {
	localeState,
	setLocale,
	translate,
} from "../../src/shared/i18n/locale.ts";

// A translation is a file somebody dropped beside `index.html`, so its keys are read as untrusted.
// `JSON.parse` makes `__proto__` an ordinary key, and assigning it onward swaps the prototype of
// whatever receives it, which would answer every phrase the file never declared.
const HOSTILE = `{
	"__proto__": { "other": "x", "artistInfo.off": "Smuggled." },
	"constructor": "Not a phrase.",
	"artistInfo.readMore": "Mehr auf {source}"
}`;

test("a translation's inherited keys are not phrases", async (t) => {
	const realFetch = globalThis.fetch;
	const realDocument = globalThis.document;
	t.after(async () => {
		await setLocale(null);
		globalThis.fetch = realFetch;
		globalThis.document = realDocument;
	});
	globalThis.document = {
		baseURI: "http://127.0.0.1:9/",
		documentElement: { lang: "" },
	} as unknown as Document;
	globalThis.fetch = (async () =>
		new Response(HOSTILE, {
			headers: { "Content-Type": "application/json" },
		})) as typeof fetch;

	await setLocale("xx");

	assert.equal(localeState().active, "xx");
	assert.equal(translate("artistInfo.readMore", { source: "X" }), "Mehr auf X");
	assert.equal(translate("artistInfo.off"), en["artistInfo.off"]);
	assert.equal(localeState().missing, Object.keys(en).length - 1);
});

// Each phrase the picker draws for playing on another device. Spanish is held to these, and not to
// every key in the English catalogue.
const PLAYING_ELSEWHERE_PHRASES = [
	"listen.closePicker",
	"listen.noSpeakers",
	"settings.playback.offerListening",
	"settings.playback.offerListeningDetail",
];

test("the Spanish catalogue holds every phrase the picker draws for playing on another device", () => {
	const spanish = JSON.parse(
		readFileSync(
			new URL("../../public/locales/es.json", import.meta.url),
			"utf8",
		),
	) as Record<string, unknown>;

	const missing = PLAYING_ELSEWHERE_PHRASES.filter(
		(key) =>
			!Object.hasOwn(en, key) || !Object.hasOwn(spanish, key) || !spanish[key],
	);
	assert.deepEqual(missing, []);
});
