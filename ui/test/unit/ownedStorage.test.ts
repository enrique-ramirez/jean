import assert from "node:assert/strict";
import test from "node:test";

import { clearOwnedKeys } from "../../src/shared/lib/ownedStorage.ts";
import { MemoryStorage } from "./sessionStoreHarness.ts";

// What "Reset this device's settings" on the root error screen removes. The storage is the only
// list of what Jean has written to a browser, so the reset reads its keys rather than naming them.

const keysOf = (storage: Storage) =>
	Array.from({ length: storage.length }, (_, index) => storage.key(index));

const holding = (items: Record<string, string>) => {
	const storage = new MemoryStorage();
	for (const [key, value] of Object.entries(items)) storage.setItem(key, value);
	return storage;
};

test("every key Jean owns goes, however many there are", () => {
	const storage = holding({
		"jean.theme": '"light"',
		"jean.columns": "{}",
		"jean.session.raised": "[]",
	});

	clearOwnedKeys(storage);

	assert.deepEqual(keysOf(storage), []);
});

test("a key it is told to keep stays, with its value", () => {
	const storage = holding({
		"jean.deviceId": '"abc"',
		"jean.theme": '"light"',
		"jean.deviceName": '"Kitchen"',
	});

	clearOwnedKeys(storage, ["jean.deviceId", "jean.deviceName"]);

	assert.deepEqual(keysOf(storage), ["jean.deviceId", "jean.deviceName"]);
	assert.equal(storage.getItem("jean.deviceName"), '"Kitchen"');
});

test("what another app on the same origin stored is not Jean's to clear", () => {
	const storage = holding({
		"jean.theme": '"light"',
		jeanette: "1",
		"other.setting": "2",
	});

	clearOwnedKeys(storage);

	assert.deepEqual(keysOf(storage), ["jeanette", "other.setting"]);
});
