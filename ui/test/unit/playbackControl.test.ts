import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { whenControllable } from "../../src/domain/player/usePlaybackControl.ts";
import type { Translate } from "../../src/shared/i18n/locale.ts";

const UI = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(UI, "src");

const filesUnder = (folder: string, keep: RegExp): string[] =>
	readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return filesUnder(path, keep);
		return keep.test(entry.name) ? [path] : [];
	});

// `foo_jean` never refuses a detached session's command for `controlPlayback`, so a file reading the
// permission straight refuses in a session what the player would take. `useListener.ts` is the one
// that stays: `POST /api/volume` takes no session and always moves the player, so its fader answers
// to the permission itself.
const READERS = [
	"src/domain/player/useListener.ts",
	"src/domain/player/usePlaybackControl.ts",
	"src/features/now-playing/ListenHere.tsx",
	"src/shared/api/discovery.ts",
];

test("only the control hook, where the permission is defined, and the files still to move read permitsPlaybackControl", () => {
	const reading = filesUnder(SRC, /\.tsx?$/)
		.filter((file) =>
			readFileSync(file, "utf8").includes("permitsPlaybackControl"),
		)
		.map((file) => relative(UI, file))
		.sort();

	assert.deepEqual(reading, READERS);
});

const said = ((key: string, fields?: Record<string, unknown>) =>
	fields ? `${key} ${JSON.stringify(fields)}` : key) as Translate;

test("a control is pressable and keeps its own name while playback can be controlled", () => {
	const press = () => {};

	assert.deepEqual(whenControllable(true, press, "Shuffle", said), {
		onClick: press,
	});
});

test("with playback control off a control takes no press, reads as disabled and names the reason", () => {
	assert.deepEqual(
		whenControllable(false, () => {}, "Shuffle", said),
		{
			"aria-disabled": "true",
			"aria-label": 'player.controlOffName {"control":"Shuffle"}',
		},
	);
});
