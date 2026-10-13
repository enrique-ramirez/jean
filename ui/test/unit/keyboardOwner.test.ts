import assert from "node:assert/strict";
import test from "node:test";

import {
	claimKeyboard,
	keyboardOwner,
} from "../../src/shared/keyboard/keyboardOwner.ts";

// Overlays stack: a confirmation over Settings, the shortcut sheet over a menu.
// Which one the keys reach is decided here and nowhere a browser test can stand,
// since two overlays closing in the wrong order is an unmount race rather than
// anything a person can do with a pointer.

test("nobody owns the keyboard until an overlay claims it", () => {
	assert.equal(keyboardOwner(), null);
});

test("the latest claim still held owns the keyboard", () => {
	const releaseSettings = claimKeyboard("settings");
	const releaseConfirm = claimKeyboard("confirm");
	assert.equal(keyboardOwner(), "confirm");

	releaseConfirm();
	assert.equal(keyboardOwner(), "settings");

	releaseSettings();
	assert.equal(keyboardOwner(), null);
});

test("a claim released out of turn leaves the keyboard with the one over it, then hands it to the next", () => {
	const releaseSettings = claimKeyboard("settings");
	const releaseMenu = claimKeyboard("menu");
	const releaseConfirm = claimKeyboard("confirm");

	releaseMenu();
	assert.equal(keyboardOwner(), "confirm");

	releaseConfirm();
	assert.equal(keyboardOwner(), "settings");

	releaseSettings();
	assert.equal(keyboardOwner(), null);
});

test("two claims under one name are two claims, and releasing one keeps the other", () => {
	const releaseFirst = claimKeyboard("menu");
	const releaseSecond = claimKeyboard("menu");

	releaseFirst();
	assert.equal(keyboardOwner(), "menu");

	releaseSecond();
	assert.equal(keyboardOwner(), null);
});
