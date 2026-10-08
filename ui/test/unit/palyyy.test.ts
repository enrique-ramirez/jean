import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { setLocale, spoken, translate } from "../../src/shared/i18n/locale.ts";

const MAY_THE_TENTH = new Date(2026, 4, 10, 12).getTime();
const THE_DAY_AFTER = new Date(2026, 4, 11, 12).getTime();

const onThatDay = (t: test.TestContext, now: number) => {
	mock.timers.enable({ apis: ["Date"], now });
	t.after(() => mock.timers.reset());
};

test("on May the 10th, the word play is respelled wherever it is drawn", (t) => {
	onThatDay(t, MAY_THE_TENTH);

	assert.equal(translate("player.play"), "Palyyy");
	assert.equal(translate("shelf.top.title"), "Most palyyyed");
	assert.equal(translate("shelf.plays", { count: 3 }), "3 palyyys");
	assert.equal(translate("shortcut.playPause"), "Palyyy / pause");
});

test("a track's own title is the user's, and keeps its spelling", (t) => {
	onThatDay(t, MAY_THE_TENTH);

	assert.equal(
		translate("listen.skipped", { track: "Playground" }),
		"Could not palyyy “Playground”, so it was skipped.",
	);
});

test("playback, playlist and player are other words", (t) => {
	onThatDay(t, MAY_THE_TENTH);

	assert.equal(translate("player.order.title"), "Playback order");
	assert.equal(translate("playlist.eyebrow"), "Playlist");
	assert.equal(
		translate("connection.reconnecting"),
		"Reconnecting to the player…",
	);
});

test("what a screen reader says is spelled as the catalogue has it", (t) => {
	onThatDay(t, MAY_THE_TENTH);

	assert.equal(spoken("player.play"), "Play");
	assert.equal(
		spoken("player.controlOffName", { control: spoken("player.play") }),
		"Play (playback control is off)",
	);
});

test("any other day, play is play", (t) => {
	onThatDay(t, THE_DAY_AFTER);

	assert.equal(translate("player.play"), "Play");
	assert.equal(translate("shelf.top.title"), "Most played");
});

// A catalogue that does not carry a phrase shows it in English, and that English is still another
// language's screen.
test("another language is left alone, its English fallbacks included", async (t) => {
	onThatDay(t, MAY_THE_TENTH);

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
		new Response(JSON.stringify({ "player.pause": "Pausa" }), {
			headers: { "Content-Type": "application/json" },
		})) as typeof fetch;

	await setLocale("xx");

	assert.equal(translate("player.pause"), "Pausa");
	assert.equal(translate("player.play"), "Play");
});
