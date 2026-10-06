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

const PLAYING_ELSEWHERE_PHRASES: readonly string[] = [
	"listen.closePicker",
	"listen.control",
	"listen.controlNamed",
	"listen.controlling",
	"listen.ended",
	"listen.endedOwn",
	"listen.endedUnknown",
	"listen.goneBeforeJoin",
	"listen.handBack",
	"listen.join",
	"listen.joinNamed",
	"listen.joinRefused",
	"listen.leave",
	"listen.leaveNamed",
	"listen.listenerCount",
	"listen.listeningNow",
	"listen.noSpeakers",
	"listen.nobodyListening",
	"listen.nobodyNow",
	"listen.onStarted",
	"listen.onlyListener",
	"listen.playerBusy",
	"listen.playingTrack",
	"listen.private",
	"listen.share",
	"listen.shareOff",
	"listen.shareOn",
	"listen.skipped",
	"listen.start",
	"listen.startDetail",
	"listen.takenBack",
	"listen.withoutEffects",
	"settings.playback.offerListening",
	"settings.playback.offerListeningDetail",
];

const spanish = JSON.parse(
	readFileSync(
		new URL("../../public/locales/es.json", import.meta.url),
		"utf8",
	),
) as Record<string, unknown>;

test("the Spanish catalogue holds every phrase the picker draws for playing on another device", () => {
	const missing = PLAYING_ELSEWHERE_PHRASES.filter(
		(key) =>
			!Object.hasOwn(en, key) || !Object.hasOwn(spanish, key) || !spanish[key],
	);
	assert.deepEqual(missing, []);
});

const MECHANISM = /\b(?:engines?|detached|sessions?|sesi[oó]n|sesiones)\b/i;

function wordings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (value && typeof value === "object")
		return Object.values(value).flatMap(wordings);
	return [];
}

test("no phrase the picker draws for playing on another device names the mechanism, in English or Spanish", () => {
	const naming = PLAYING_ELSEWHERE_PHRASES.flatMap((key) =>
		(
			[
				["en", (en as Record<string, unknown>)[key]],
				["es", spanish[key]],
			] as const
		).flatMap(([language, value]) =>
			wordings(value)
				.filter((wording) => MECHANISM.test(wording.replace(/\{[^}]*\}/g, "")))
				.map((wording) => `${key} (${language}): ${wording}`),
		),
	);
	assert.deepEqual(naming, []);
});
