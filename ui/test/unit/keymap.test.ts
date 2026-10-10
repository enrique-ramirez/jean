import assert from "node:assert/strict";
import test from "node:test";

import {
	isSingleKeyBinding,
	KEYMAP,
	SCOPE,
} from "../../src/shared/keyboard/keymap.ts";

// The layout rule is a pure invariant over the array, and Playwright cannot see
// it at all: Chromium synthesises US QWERTY codes, so `Shift+/` and `Shift+?`
// are indistinguishable in a spec and the difference only exists on somebody's
// Spanish or Dvorak keyboard. `keyboard.spec.ts` covers that the bindings fire.

const PUNCTUATION = /^[^A-Za-z0-9]$/;

const registrations = KEYMAP.flatMap((binding) =>
	binding.keys.map((key) => ({ id: binding.id, key: String(key) })),
);

test("a shifted punctuation binding is declared in both spellings", () => {
	// The matcher falls back to `event.code` through a QWERTY map, so `Shift+?`
	// matches the key that types a question mark on every layout and the bare `?`
	// covers the layouts that reach it without Shift. One of the two alone is a
	// shortcut that works on the machine it was written on.
	for (const { id, key } of registrations) {
		const character = key.startsWith("Shift+") ? key.slice(6) : null;
		if (character === null || !PUNCTUATION.test(character)) continue;

		const binding = KEYMAP.find((entry) => entry.id === id);
		assert.ok(
			binding?.keys.some((other) => String(other) === character),
			`${id} declares Shift+${character} without the bare ${character}`,
		);
	}
});

test("a punctuation binding is never declared as Shift alone", () => {
	// The mirror of the rule above. `=` and `-` for volume are unreachable
	// wherever a layout puts them behind Shift, where it is the modifier rather
	// than the character that differs, so a shifted spelling on its own is a
	// shortcut that works on the machine it was written on. Modified chords are
	// exempt: `Mod+,` is one key, not two.
	for (const binding of KEYMAP) {
		const spellings = binding.keys.map(String);
		const bare = spellings.filter(
			(key) => !key.includes("+") && PUNCTUATION.test(key),
		);
		const shifted = spellings.filter((key) =>
			/^Shift\+[^A-Za-z0-9]$/.test(key),
		);
		if (shifted.length === 0) continue;

		assert.ok(
			bare.length > 0,
			`${binding.id} is only reachable with Shift held`,
		);
	}
});

test("a letter is declared once, and never with Shift", () => {
	// For a letter the matcher returns on the `event.key` comparison and never
	// consults `event.code`, so the second spelling would be a registration that
	// can only ever double-fire.
	for (const { id, key } of registrations)
		assert.ok(
			!/^Shift\+[A-Za-z]$/.test(key),
			`${id} declares ${key}, and a letter needs no shifted spelling`,
		);
});

test("every binding names a scope that exists", () => {
	const scopes = new Set(Object.values(SCOPE));
	for (const binding of KEYMAP)
		assert.ok(
			scopes.has(binding.scope),
			`${binding.id} is in scope "${binding.scope}", which nothing declares`,
		);
});

test("ids are unique, because a handler is looked up by one", () => {
	const ids = KEYMAP.map((binding) => binding.id);
	assert.equal(new Set(ids).size, ids.length);
});

test("a binding with two registrations tells the sheet what one key to draw", () => {
	for (const binding of KEYMAP) {
		if (binding.keys.length < 2 || binding.hidden) continue;
		assert.ok(
			binding.shown,
			`${binding.id} has ${binding.keys.length} registrations and no \`shown\``,
		);
	}
});

test("the single-key switch covers the bare characters and nothing with a modifier or a named key", () => {
	const NAMED =
		/^(Space|Enter|Escape|Tab|Backspace|Delete|Home|End|Page(Up|Down)|Arrow\w+|F\d+|ContextMenu)$/;
	const BARE = /^(Shift\+)?[^+]$/;

	for (const binding of KEYMAP) {
		const spellings = binding.keys.map(String);
		const hasChord = spellings.some((key) =>
			/^(Mod|Ctrl|Control|Alt|Meta)\+/.test(key),
		);
		const hasNamed = spellings.some((key) =>
			NAMED.test(key.replace(/^Shift\+/, "")),
		);
		const allBare = spellings.every((key) => BARE.test(key));

		if (hasChord || hasNamed)
			assert.equal(
				isSingleKeyBinding(binding),
				false,
				`${binding.id} (${spellings.join(", ")}) is classified single`,
			);
		if (allBare)
			assert.equal(
				isSingleKeyBinding(binding),
				true,
				`${binding.id} (${spellings.join(", ")}) is not classified single`,
			);
	}

	for (const id of [
		"openPalette",
		"rate3",
		"volumeUp",
		"volumeDown",
		"showShortcuts",
	]) {
		const binding = KEYMAP.find((entry) => entry.id === id);
		assert.ok(binding, `${id} is not in the keymap`);
		assert.equal(
			isSingleKeyBinding(binding),
			true,
			`${id} is not classified single`,
		);
	}
});
