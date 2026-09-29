import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SURFACES } from "../../src/app/surfaces.ts";

// What the app draws over itself. Each is a decision about what a user can
// link to, reload onto and reach from every input, so a new one is made on
// purpose rather than arriving with a feature.

const UI = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(UI, "src");

const filesUnder = (folder: string, keep: RegExp): string[] =>
	readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return filesUnder(path, keep);
		return keep.test(entry.name) ? [path] : [];
	});

const source = filesUnder(SRC, /\.(tsx?|css)$/);

// The test for a new surface is whether it is a place: it has a subject, it
// survives a reload, and Back means something. A place is a route, the way now
// playing is. What opens from state alone cannot be linked to or reloaded onto,
// which is right for a drawer opened over your work and shut, and wrong for
// anything something else needs to point at. These are the modals that exist,
// and `SURFACES` the rest; a new one that anything points at is a route instead.
const MODAL_WITHOUT_ROUTE = [
	"src/app/CommandPalette.tsx",
	"src/features/settings/SettingsDialog.tsx",
	"src/shared/keyboard/ShortcutSheet.tsx",
	"src/shared/ui/ActionMenu.tsx",
];

const DECLARED = {
	sidebar: "panel",
	queue: "panel",
	search: "bar",
	palette: "modal",
	shortcuts: "modal",
	settings: "modal",
	nowPlaying: "route",
};

test("nothing opens over the app without a route unless it is one of the known surfaces", () => {
	const modal = source
		.filter((file) => readFileSync(file, "utf8").includes("aria-modal"))
		.map((file) => relative(UI, file))
		.sort();

	const declared = Object.fromEntries(
		Object.entries(SURFACES).map(([name, surface]) => [name, surface.kind]),
	);

	assert.deepEqual(modal, MODAL_WITHOUT_ROUTE);
	assert.deepEqual(declared, DECLARED);
});

// Blanks out a comment's characters while keeping every newline, so a match
// against the result still reports the right line and a comment explaining
// why some other control has no tooltip does not count as one.
const withoutComments = (code: string): string =>
	code
		.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
		.replace(/\/\/.*/g, (line) => " ".repeat(line.length));

// A tooltip is a hover, and a phone has no hover; the `title` attribute a
// browser falls back on is out of reach of touch and of a screen reader both.
// So a control that is unavailable says why in the name it already announces.
test("there is no tooltip: nothing under src/ draws or names one, and no dependency brings one", () => {
	const naming = source.flatMap((file) =>
		withoutComments(readFileSync(file, "utf8"))
			.split("\n")
			.flatMap((line, index) =>
				/tool-?tip|tippy/i.test(line)
					? [`${relative(UI, file)}:${index + 1}`]
					: [],
			),
	);

	const manifest = JSON.parse(readFileSync(join(UI, "package.json"), "utf8"));
	const dependencies = Object.keys({
		...manifest.dependencies,
		...manifest.devDependencies,
	});

	assert.ok(source.length > 0, "no source file was read");
	assert.deepEqual(naming, []);
	assert.deepEqual(
		dependencies.filter((name) => /tool-?tip|tippy/i.test(name)),
		[],
	);
});
