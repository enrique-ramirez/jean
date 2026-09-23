import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const BEEFWEB_CLIENT = join(SRC, "shared/api/beefweb");

const sourcesUnder = (folder: string): string[] =>
	readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return sourcesUnder(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});

const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

const resolvedFrom = (file: string, specifier: string) => {
	if (specifier.startsWith("@/")) return join(SRC, specifier.slice(2));
	if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
	return null;
};

const namesTheClient = (target: string | null) =>
	target !== null && target.replace(/\.tsx?$/, "") === BEEFWEB_CLIENT;

test("nothing under src/ imports the beefweb client", () => {
	const importers = sourcesUnder(SRC).filter((file) =>
		[...readFileSync(file, "utf8").matchAll(SPECIFIER)].some((match) =>
			namesTheClient(resolvedFrom(file, match[1])),
		),
	);

	assert.deepEqual(
		importers.map((file) => relative(SRC, file)),
		[],
	);
});
