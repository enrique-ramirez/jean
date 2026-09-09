import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { HERO, SECTIONS } from "../embeds.ts";
import { part, section } from "../readme.ts";

const README = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "../../README.md"),
	"utf8",
);

const REGIONS = [
	"tagline",
	"more",
	"closing",
	"extra",
	"requirements",
	"install",
	"profiles",
];

test("the README still carries every section the site page is built out of", () => {
	for (const name of REGIONS) assert.ok(section(README, name).length > 0);
});

test("every section the page draws a player into has its heading and its words", () => {
	for (const entry of SECTIONS) {
		const words = part(README, entry.region);
		assert.ok(words.heading.length > 0, entry.region);
		assert.ok(words.body.length > 0, entry.region);
		assert.ok(entry.frames.length > 0, entry.region);
	}
});

test("a comparison carries exactly the two frames it draws", () => {
	for (const entry of SECTIONS)
		if (entry.shape === "compare") assert.equal(entry.frames.length, 2);
});

test("no two frames on the page share a title, which is all a screen reader has", () => {
	const titles = [
		HERO.title,
		...SECTIONS.flatMap((entry) => entry.frames.map((frame) => frame.title)),
	];
	assert.equal(new Set(titles).size, titles.length);
});

test("a frame that opens on a search asks the demo library something it can answer", () => {
	const captured = JSON.parse(
		readFileSync(
			fileURLToPath(import.meta.resolve("@jean/ui/demo/library.json")),
			"utf8",
		),
	) as { albums: { tracks: Record<string, string>[] }[] };

	const words = captured.albums
		.flatMap((album) => album.tracks)
		.flatMap((track) => [track["%title%"], track["%artist%"], track["%album%"]])
		.join("\n")
		.toLowerCase();

	for (const entry of SECTIONS)
		for (const frame of entry.frames) {
			const query = frame.route.startsWith("search/")
				? decodeURIComponent(frame.route.slice("search/".length))
				: null;
			if (query) assert.ok(words.includes(query.toLowerCase()), query);
		}
});
