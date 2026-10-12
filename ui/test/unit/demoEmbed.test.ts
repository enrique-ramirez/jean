import assert from "node:assert/strict";
import test from "node:test";

import { applyFrameSettings } from "../../demo/embed.ts";

// A frame's storage is its own and dies with it; a visitor's is the browser's and persists. A link
// anybody can write must not be able to leave a setting behind in the second.
const withStorage = (t: test.TestContext) => {
	const held = new Map<string, string>();
	const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			setItem: (key: string, value: string) => void held.set(key, value),
		},
	});
	t.after(() => {
		if (real) Object.defineProperty(globalThis, "localStorage", real);
	});
	return held;
};

test("a frame's link sets what the frame opens with", (t) => {
	const held = withStorage(t);

	applyFrameSettings(new URLSearchParams("embed&set.layout=%22album%22"));

	assert.deepEqual([...held], [["jean.layout", '"album"']]);
});

test("the same link outside a frame stores nothing", (t) => {
	const held = withStorage(t);

	applyFrameSettings(
		new URLSearchParams("set.artistInfo=true&set.columns=%7B%7D"),
	);

	assert.deepEqual([...held], []);
});
