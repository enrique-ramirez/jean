import assert from "node:assert/strict";
import { test } from "node:test";

import { awaitsDiscovery } from "../../src/domain/player/offersStart.ts";

const REFUSED_UNDER = 1_700_000_000_000;

test("with no withdrawal, the start row waits for nothing", () => {
	assert.equal(awaitsDiscovery(null, REFUSED_UNDER), false);
	assert.equal(awaitsDiscovery(null, 0), false);
});

test("under the answer the refusal was made under, the start row waits for discovery", () => {
	assert.equal(awaitsDiscovery(REFUSED_UNDER, REFUSED_UNDER), true);
});

test("a later answer offers the start row again", () => {
	assert.equal(awaitsDiscovery(REFUSED_UNDER, REFUSED_UNDER + 1), false);
});

test("an answer stamped earlier than the refusal's, as after the clock steps back, offers the start row again", () => {
	assert.equal(awaitsDiscovery(REFUSED_UNDER, REFUSED_UNDER - 60_000), false);
});
