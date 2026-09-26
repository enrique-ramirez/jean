import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { type TestContext } from "node:test";
import type { FieldAvailability } from "../../src/domain/track/fieldAvailability.ts";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	type LibraryColumns,
	libraryColumnsOf,
} from "../../src/domain/track/libraryColumns.ts";

// What a tab knows before its first snapshot is module state, read once, and
// node caches a module by its URL. So each case opens a tab of its own: the
// module and everything it imports from `src/` load again under a `?tab=`
// query, beside the copies the rest of this file holds.
//
// The views read availability through a hook. Inside a tab React is replaced by
// the one thing a hook needs outside a render, the current value of its store.

const SRC = new URL("../../src/", import.meta.url).href;
const TAB = /[?&]tab=(\d+)/;
const REACT_OUTSIDE_RENDER = `data:text/javascript,${encodeURIComponent(
	[
		"export const useSyncExternalStore = (subscribe, read) => read();",
		"export const useRef = (current) => ({ current });",
		"export const useCallback = (callback) => callback;",
		"export const useMemo = (make) => make();",
	].join("\n"),
)}`;

registerHooks({
	resolve(specifier, context, next) {
		const tab = specifier.match(TAB)?.[1] ?? context.parentURL?.match(TAB)?.[1];
		if (!tab) return next(specifier, context);
		if (specifier === "react")
			return { url: REACT_OUTSIDE_RENDER, shortCircuit: true };

		const resolved = next(specifier.replace(TAB, ""), context);
		return resolved.url.startsWith(SRC)
			? { ...resolved, url: `${resolved.url}?tab=${tab}` }
			: resolved;
	},
});

const KEY = "jean.fieldAvailability";

const nameOf = (field: number) => TRACK_EXPRESSIONS[field];
const ALL_FIELDS = Object.values(FIELD);
const allNamesBut = (...left: number[]) =>
	ALL_FIELDS.filter((field) => !left.includes(field)).map(nameOf);

interface Tab {
	isAvailable: (field: number) => boolean;
	record: (columns: LibraryColumns) => void;
	written: string[];
	stored: () => string | null;
}

let tabs = 0;

const openTab = async (
	t: TestContext,
	stored: string | null = null,
): Promise<Tab> => {
	const items = new Map<string, string>();
	if (stored !== null) items.set(KEY, stored);
	const written: string[] = [];
	const storage = {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => {
			written.push(key);
			items.set(key, String(value));
		},
		removeItem: (key: string) => {
			written.push(key);
			items.delete(key);
		},
	};

	const held = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	Object.defineProperty(globalThis, "localStorage", {
		value: storage,
		configurable: true,
		writable: true,
	});
	t.after(() => {
		if (held) Object.defineProperty(globalThis, "localStorage", held);
		else delete (globalThis as { localStorage?: unknown }).localStorage;
	});

	tabs += 1;
	const module = (await import(
		`../../src/domain/track/fieldAvailability.ts?tab=${tabs}`
	)) as {
		useAvailableFields: () => FieldAvailability;
		recordFieldAvailability: (columns: LibraryColumns) => void;
	};

	return {
		isAvailable: (field) => module.useAvailableFields().isAvailable(field),
		record: module.recordFieldAvailability,
		written,
		stored: () => items.get(KEY) ?? null,
	};
};

const snapshotWithout = (...unresolved: number[]) =>
	libraryColumnsOf(
		[
			TRACK_EXPRESSIONS.map((_, field) =>
				unresolved.includes(field) ? "?" : `value ${field}`,
			),
		],
		TRACK_EXPRESSIONS.length,
	);

const availabilityIn = (tab: Tab) =>
	Object.fromEntries(
		ALL_FIELDS.map((field) => [nameOf(field), tab.isAvailable(field)]),
	);

const everyField = (available: boolean) =>
	Object.fromEntries(ALL_FIELDS.map((field) => [nameOf(field), available]));

const storedNames = (tab: Tab) => {
	const stored = tab.stored();
	assert.ok(stored !== null, `nothing stored under ${KEY}`);
	const names = JSON.parse(stored) as unknown;
	assert.ok(Array.isArray(names), `${KEY} holds ${stored}, not a list`);
	return [...names].sort();
};

test("before any snapshot, a field the stored answer leaves out reads unavailable and the ones it names read available", async (t) => {
	// Stored in reverse, so an answer read by position rather than by name misreads it.
	const tab = await openTab(
		t,
		JSON.stringify(allNamesBut(FIELD.year).reverse()),
	);

	assert.deepEqual(availabilityIn(tab), {
		...everyField(true),
		[nameOf(FIELD.year)]: false,
	});
});

// Passes against the code as it stands, which already starts from every column:
// the case keeps that true once a stored answer can take its place.
test("with nothing usable stored, every field reads available", async (t) => {
	for (const stored of [null, "not json {"]) {
		const tab = await openTab(t, stored);
		assert.deepEqual(
			availabilityIn(tab),
			everyField(true),
			`with ${stored ?? "nothing"} stored`,
		);
	}
});

test("a stored field name this build does not know is passed over, and the names it does know still count", async (t) => {
	const tab = await openTab(
		t,
		JSON.stringify([...allNamesBut(FIELD.year), "%a field since removed%"]),
	);

	assert.deepEqual(availabilityIn(tab), {
		...everyField(true),
		[nameOf(FIELD.year)]: false,
	});
});

test("a snapshot stores the names of the fields that resolved, and the fields read as it says", async (t) => {
	const tab = await openTab(t);

	tab.record(snapshotWithout(FIELD.year, FIELD.genre));

	assert.deepEqual(
		storedNames(tab),
		allNamesBut(FIELD.year, FIELD.genre).sort(),
	);
	assert.deepEqual(availabilityIn(tab), {
		...everyField(true),
		[nameOf(FIELD.year)]: false,
		[nameOf(FIELD.genre)]: false,
	});
});

test("a snapshot replaces the stored answer rather than adding to it", async (t) => {
	const tab = await openTab(t, JSON.stringify(allNamesBut(FIELD.year)));

	tab.record(snapshotWithout(FIELD.genre));

	assert.deepEqual(storedNames(tab), allNamesBut(FIELD.genre).sort());
	assert.equal(tab.isAvailable(FIELD.year), true);
	assert.equal(tab.isAvailable(FIELD.genre), false);
});

// The page and the component share one origin, and `localStorage` is already
// partitioned by origin, so one key is one install.
test("the answer is stored under jean.fieldAvailability and no other key", async (t) => {
	const tab = await openTab(t);

	tab.record(snapshotWithout(FIELD.year));

	assert.deepEqual([...new Set(tab.written)], [KEY]);
});
