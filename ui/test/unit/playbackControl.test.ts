import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const UI = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(UI, "src");

const filesUnder = (folder: string, keep: RegExp): string[] =>
	readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return filesUnder(path, keep);
		return keep.test(entry.name) ? [path] : [];
	});

// `foo_jean` never refuses a detached session's command for `controlPlayback`, so a file reading the
// permission straight refuses in a session what the player would take. The three still to move to
// the hook are named here, and the task that moves one takes its name off.
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
