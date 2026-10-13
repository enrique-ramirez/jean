import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deviceId } from "../../src/domain/player/device.ts";

const UI = join(dirname(fileURLToPath(import.meta.url)), "../..");

// A browser defines `crypto.randomUUID` only in a secure context, and a player
// on a LAN may serve Jean over plain HTTP. The e2e suite is served from
// localhost, which a browser counts as secure whatever the scheme.
test("a device on a page with no crypto.randomUUID still gets an id, and keeps it", (t) => {
	Object.defineProperty(crypto, "randomUUID", {
		value: undefined,
		configurable: true,
	});
	t.after(() => Reflect.deleteProperty(crypto, "randomUUID"));

	const id = deviceId();

	assert.notEqual(id, "");
	assert.equal(deviceId(), id);
});

// The kind of device is guessed from what the browser says of itself, and an
// iPad says it is a Mac. A wrong guess costs a label somebody can retype in
// Settings; anything that behaved differently by it would be wrong on that iPad
// with no way to correct it.
test("the guessed kind of device is its default name, and nothing but Settings reads the guess", () => {
	const readers = readdirSync(join(UI, "src"), {
		recursive: true,
		encoding: "utf8",
	})
		.filter((name) => /\.tsx?$/.test(name))
		.map((name) => join(UI, "src", name))
		.filter((file) => /\bdefaultDeviceName\b/.test(readFileSync(file, "utf8")))
		.map((file) => relative(UI, file))
		.sort();

	assert.deepEqual(readers, [
		"src/domain/player/device.ts",
		"src/features/settings/ThisDevice.tsx",
	]);
});
