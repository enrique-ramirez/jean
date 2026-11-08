import assert from "node:assert/strict";
import test from "node:test";

import { matchesKeyboardEvent } from "@tanstack/react-hotkeys";

import {
	isSingleKeyBinding,
	KEYMAP,
	matchesBinding,
	SCOPE,
} from "../../src/shared/keyboard/keymap.ts";
import { isPressInTextField } from "../../src/shared/keyboard/pressTarget.ts";

// Playwright cannot see the layout rule at all: Chromium synthesises US QWERTY
// codes, so `Shift+/` and `?` are indistinguishable in a spec and the difference
// only exists on somebody's Spanish or Dvorak keyboard. `keyboard.spec.ts`
// covers that the bindings fire.

const PUNCTUATION = /^[^A-Za-z0-9]$/;

const registrations = KEYMAP.flatMap((binding) =>
	binding.keys.map((key) => ({ id: binding.id, key: String(key) })),
);

const press = (
	key: string,
	code: string,
	modifiers: { shiftKey?: boolean } = {},
) =>
	({
		key,
		code,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		...modifiers,
	}) as KeyboardEvent;

const QUESTION_MARKS = {
	"QWERTY, Shift with /": press("?", "Slash", { shiftKey: true }),
	"Spanish, Shift with '": press("?", "Minus", { shiftKey: true }),
	"a layout with ? unshifted": press("?", "Slash"),
};

test("? is declared once, and matches however a layout reaches it", () => {
	const spellings = KEYMAP.find(
		(binding) => binding.id === "showShortcuts",
	)?.keys.map(String);
	assert.deepEqual(spellings, ["?"]);

	for (const [layout, event] of Object.entries(QUESTION_MARKS))
		assert.ok(matchesBinding(event, "showShortcuts"), layout);

	assert.equal(
		matchesBinding(press("/", "Slash"), "showShortcuts"),
		false,
		"QWERTY / without Shift",
	);
});

test("a key that types another character, or a dead key, is not the binding QWERTY has there", () => {
	assert.ok(matchesBinding(press("[", "BracketLeft"), "previousTab"));

	// TanStack Hotkeys refuses a printable character typed on another key's position, and still
	// reads a dead key as the character QWERTY has on its code, which Jean refuses itself.
	const deadGrave = press("Dead", "BracketLeft");
	const dvorakSlash = press("/", "BracketLeft");
	assert.ok(
		matchesKeyboardEvent(deadGrave, "["),
		"TanStack Hotkeys no longer falls back to the code for a dead key",
	);
	assert.equal(
		matchesKeyboardEvent(dvorakSlash, "["),
		false,
		"TanStack Hotkeys takes Dvorak's / for the [ QWERTY has there",
	);

	assert.equal(
		matchesBinding(deadGrave, "previousTab"),
		false,
		"Spanish, where the key is a dead grave",
	);
	assert.equal(
		matchesBinding(dvorakSlash, "previousTab"),
		false,
		"Dvorak, where the key types /",
	);
});

test("a press inside a text field is dropped, and the finder's keys are not", () => {
	const pressAt = (target: object | null) =>
		({ key: "?", code: "Slash", target }) as unknown as KeyboardEvent;

	const dropped = {
		"a read-only input": { tagName: "INPUT", type: "text", readOnly: true },
		"a writable input": { tagName: "INPUT", type: "text", readOnly: false },
		"a checkbox": { tagName: "INPUT", type: "checkbox" },
		"a text area": { tagName: "TEXTAREA" },
		"a select": { tagName: "SELECT" },
		"an editable element": { tagName: "DIV", isContentEditable: true },
	};
	for (const [where, target] of Object.entries(dropped))
		assert.equal(isPressInTextField(pressAt(target)), true, where);

	const kept = {
		"a button input": { tagName: "INPUT", type: "button" },
		"a submit input": { tagName: "INPUT", type: "submit" },
		"a reset input": { tagName: "INPUT", type: "reset" },
		"an element that is no field": { tagName: "DIV" },
		"no target": null,
	};
	for (const [where, target] of Object.entries(kept))
		assert.equal(isPressInTextField(pressAt(target)), false, where);

	// The finder's keys work inside the finder's own field, and are exempt from the drop only by
	// declaring that they fire in a text field.
	const finder = KEYMAP.filter((binding) => binding.scope === SCOPE.finder);
	assert.ok(finder.length > 0);
	for (const binding of finder)
		assert.equal(binding.options?.ignoreInputs, false, binding.id);
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
