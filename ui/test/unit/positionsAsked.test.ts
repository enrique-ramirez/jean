import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_POSITIONS_ASKED } from "../../src/domain/track/rowWindows.ts";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const read = (path: string) => readFileSync(join(REPOSITORY, path), "utf8");

test("the most positions a list asks of a playlist at once is what the contract admits and what foo_jean accepts", () => {
	const declared =
		/- name: positions\n(?: {10}.*\n)*? {12}maxItems: (\d+)\n/.exec(
			read("contract/openapi.yaml"),
		);
	assert.ok(declared, "contract/openapi.yaml declares no cap on positions");
	assert.equal(MAX_POSITIONS_ASKED, Number(declared[1]));

	const accepted = /constexpr size_t kMaxPositionsAsked = (\d+);/.exec(
		read("plugins/fb2k/src/core/requests_playlists.h"),
	);
	assert.ok(accepted, "requests_playlists.h declares no kMaxPositionsAsked");
	assert.equal(MAX_POSITIONS_ASKED, Number(accepted[1]));
});
