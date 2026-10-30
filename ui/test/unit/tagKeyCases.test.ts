import assert from "node:assert/strict";
import test from "node:test";
import { tagKey } from "../../src/domain/track/fields.ts";
import { summaryFile } from "./caseFiles.ts";

const { keys } = summaryFile();

test("the client's tag key matches every conformance key pair as foo_jean does", () => {
	assert.ok(keys.length > 0);
	for (const { a, b, match } of keys)
		assert.equal(
			tagKey(a) === tagKey(b),
			match,
			`${JSON.stringify(a)} against ${JSON.stringify(b)}`,
		);
});
