import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tagKey } from "../../src/domain/track/fields.ts";

interface KeyCase {
	a: string;
	b: string;
	match: boolean;
}

const { keys }: { keys: KeyCase[] } = JSON.parse(
	readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"../../../plugins/fb2k/tests/fixtures/library_summary_cases.json",
		),
		"utf8",
	),
);

test("the client's tag key matches every conformance key pair as foo_jean does", () => {
	assert.ok(keys.length > 0);
	for (const { a, b, match } of keys)
		assert.equal(
			tagKey(a) === tagKey(b),
			match,
			`${JSON.stringify(a)} against ${JSON.stringify(b)}`,
		);
});
