import assert from "node:assert/strict";
import test from "node:test";

import { readingNotice } from "../../src/domain/library/libraryStatus.ts";
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
