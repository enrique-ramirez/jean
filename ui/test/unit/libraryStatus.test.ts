import assert from "node:assert/strict";
import test from "node:test";

import {
	libraryStatusOf,
	readingNotice,
} from "../../src/domain/library/libraryStatus.ts";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import type { Hold } from "../../src/domain/track/libraryHolds.ts";
import type { FooJeanDiscovery } from "../../src/shared/api/discovery.ts";
import type { StateDocument } from "../../src/shared/api/state.ts";
import type { Translate } from "../../src/shared/i18n/useTranslate.ts";

type Announced = StateDocument["library"];

const said = ((key: string, fields?: Record<string, unknown>) =>
	fields ? `${key} ${JSON.stringify(fields)}` : key) as Translate;

const UNREACHABLE: FooJeanDiscovery = {
	state: { kind: "unreachable" },
	origin: null,
};

const discovered = (canReadLibrary: boolean) =>
	({
		state: { kind: "ready", capabilities: { canReadLibrary } },
		origin: "http://player",
	}) as FooJeanDiscovery;

const READY: Announced = {
	ready: true,
	structure: 4,
	revision: 9,
	trackCount: 54,
	columns: [...TRACK_EXPRESSIONS],
	changeCounts: TRACK_EXPRESSIONS.map(() => 0),
	build: null,
	halted: false,
};

const BUILDING: Announced = {
	...READY,
	ready: false,
	trackCount: 0,
	columns: [],
	build: { phase: "formatting", formatted: 40, total: 900 },
} as Announced;

const NONE: Hold = { kind: "none" };
const MISSED_ONCE: Hold = { kind: "failing", failures: 1, failedAt: 0 };
const FAILING: Hold = { kind: "failing", failures: 2, failedAt: 0 };
const REFUSED: Hold = { kind: "refused" };

test("the library is being checked for until discovery answers, whatever the player announced", () => {
	assert.deepEqual(libraryStatusOf(null, READY, NONE), { kind: "checking" });
});

test("a player that cannot be reached, or cannot read a library, outranks a failure to read it", () => {
	const halted = { ...READY, halted: true };

	assert.deepEqual(libraryStatusOf(UNREACHABLE, halted, FAILING), {
		kind: "unreachable",
	});
	assert.deepEqual(libraryStatusOf(discovered(false), halted, FAILING), {
		kind: "olderPlayer",
	});
});

test("a halted library, a refusal and a failure are each reported with their own reason", () => {
	const reasonOf = (announced: Announced, hold: Hold) => {
		const status = libraryStatusOf(discovered(true), announced, hold);
		return status.kind === "failed" ? status.failure.reason : status.kind;
	};

	assert.equal(reasonOf({ ...READY, halted: true }, NONE), "halted");
	assert.equal(reasonOf(READY, REFUSED), "refused");
	assert.equal(reasonOf(READY, FAILING), "failed");
});

test("a read that missed once says nothing while its retry is out, before the library is announced and after", () => {
	assert.deepEqual(libraryStatusOf(discovered(true), null, MISSED_ONCE), {
		kind: "reading",
		loaded: 0,
		total: 0,
	});
	assert.deepEqual(libraryStatusOf(discovered(true), READY, MISSED_ONCE), {
		kind: "ready",
	});
});

test("the library reads as reading until the player announces it ready with Jean's declaration", () => {
	const kindOf = (announced: Announced | null) =>
		libraryStatusOf(discovered(true), announced, NONE).kind;

	assert.equal(kindOf(null), "reading");
	assert.equal(kindOf(BUILDING), "reading");
	assert.equal(
		kindOf({ ...READY, columns: TRACK_EXPRESSIONS.slice(1) }),
		"reading",
	);
});

test("a library announced ready with Jean's declaration is ready, an empty one included", () => {
	assert.deepEqual(libraryStatusOf(discovered(true), READY, NONE), {
		kind: "ready",
	});
	assert.deepEqual(
		libraryStatusOf(discovered(true), { ...READY, trackCount: 0 }, NONE),
		{ kind: "ready" },
	);
});

test("while the library is checked for or the player builds it, the notice says it is reading your library", () => {
	assert.equal(
		readingNotice({ kind: "checking" }, "library.reading", said),
		"library.reading",
	);
	assert.equal(
		readingNotice(
			libraryStatusOf(discovered(true), null, NONE),
			"home.reading",
			said,
		),
		"home.reading",
	);
});
