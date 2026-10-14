import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";

const VERIFY_LIBRARY = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../plugins/fb2k/scripts/verify-library.ps1",
);

const singleQuoted = (text: string): string[] =>
	Array.from(text.matchAll(/'((?:[^']|'')*)'/g), ([, body]) =>
		body.replaceAll("''", "'"),
	);

const declaredColumns = (script: string): string[] => {
	const literal = /^\$script:DeclaredColumns\s*=\s*@\(([\s\S]*?)^\)/m.exec(
		script,
	);
	if (!literal)
		throw new Error(
			`${VERIFY_LIBRARY} no longer assigns $script:DeclaredColumns`,
		);
	return singleQuoted(literal[1]);
};

const sorted = (columns: readonly string[]) => [...columns].sort();

test("verify-library.ps1 declares the columns fields.ts does", () => {
	const declared = declaredColumns(readFileSync(VERIFY_LIBRARY, "utf8"));
	assert.deepEqual(sorted(declared), sorted(TRACK_EXPRESSIONS));
});
