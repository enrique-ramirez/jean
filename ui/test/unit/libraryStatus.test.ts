import assert from "node:assert/strict";
import test from "node:test";

import {
	libraryStatusOf,
	readingNotice,
} from "../../src/domain/library/libraryStatus.ts";
import {
	EMPTY_PLAYLIST,
	type PlaylistSnapshot,
} from "../../src/domain/track/playlistEntries.ts";
import type { FooJeanDiscovery } from "../../src/shared/api/discovery.ts";
import type { LibraryFailure } from "../../src/shared/api/fooJeanLibrary.ts";
import type { Translate } from "../../src/shared/i18n/useTranslate.ts";

const said = ((key: string, fields?: Record<string, unknown>) =>
	fields ? `${key} ${JSON.stringify(fields)}` : key) as Translate;

const reading = { kind: "reading", loaded: 40, total: 900 } as const;

test("before anything has loaded, the reading notice is the plain phrase", () => {
	assert.equal(
		readingNotice({ kind: "checking" }, "library.reading", said),
		"library.reading",
	);
	assert.equal(
		readingNotice({ ...reading, loaded: 0 }, "home.reading", said),
		"home.reading",
	);
});

test("once rows arrive, the library counts them and a search words it its own way", () => {
	assert.equal(
		readingNotice(reading, "library.reading", said),
		'library.readingCount {"loaded":40,"total":900,"count":900}',
	);
	assert.equal(
		readingNotice(reading, "library.reading", said, "search.reading"),
		'search.reading {"loaded":40,"total":900}',
	);
});

const UNREACHABLE: FooJeanDiscovery = {
	state: { kind: "unreachable" },
	origin: null,
};

const discovered = (canReadLibrary: boolean) =>
	({
		state: { kind: "ready", capabilities: { canReadLibrary } },
		origin: "http://player",
	}) as FooJeanDiscovery;

const LOADED: PlaylistSnapshot = { ...EMPTY_PLAYLIST, loaded: 54, total: 54 };

const TOO_LARGE: LibraryFailure = {
	ok: false,
	reason: "too-large",
	detail: "",
};

test("the library is being checked for until discovery answers, whatever is already held", () => {
	assert.deepEqual(libraryStatusOf(null, LOADED), { kind: "checking" });
});

test("a player that cannot be reached, or cannot read a library, outranks the rows and a failure to read them", () => {
	const failed: PlaylistSnapshot = { ...LOADED, failure: TOO_LARGE };

	assert.deepEqual(libraryStatusOf(UNREACHABLE, failed), {
		kind: "unreachable",
	});
	assert.deepEqual(libraryStatusOf(discovered(false), failed), {
		kind: "olderPlayer",
	});
});

test("a failed read is reported with its reason, even while a retry is loading", () => {
	assert.deepEqual(
		libraryStatusOf(discovered(true), {
			...LOADED,
			isLoading: true,
			failure: TOO_LARGE,
		}),
		{ kind: "failed", failure: TOO_LARGE },
	);
});

test("the library reads as reading before a load has published and while one is under way, with how far it has got", () => {
	assert.deepEqual(libraryStatusOf(discovered(true), EMPTY_PLAYLIST), {
		kind: "reading",
		loaded: 0,
		total: 0,
	});
	assert.deepEqual(
		libraryStatusOf(discovered(true), {
			...LOADED,
			isLoading: true,
			loaded: 20,
		}),
		{ kind: "reading", loaded: 20, total: 54 },
	);
});

test("a published load that is not loading is ready, an empty library included", () => {
	assert.deepEqual(libraryStatusOf(discovered(true), LOADED), {
		kind: "ready",
	});
	assert.deepEqual(libraryStatusOf(discovered(true), { ...EMPTY_PLAYLIST }), {
		kind: "ready",
	});
});
