import type { Route } from "@playwright/test";
import { LATE_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { artistRoute } from "../../src/domain/track/routes.ts";
import { en } from "../../src/shared/i18n/en.ts";
import { COMPONENT_RATE_LIMITS } from "../fake-api/fooJean/rateLimits.ts";
import {
	createState,
	DEFAULT_PLAYLISTS,
	type Track,
} from "../fake-api/state.ts";
import {
	expect,
	expectSettlesAt,
	type FakePlayer,
	inSequence,
	openSettings,
	type Page,
	revealSearch,
	routeOf,
	rowByTitle,
	searchField,
	searchFor,
	settingsDialog,
	test,
	times,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";

const EXPORT = "/api/library/export";
const CHANGES = "/api/library/changes";

const CAPTURED_TRACKS = 54;
const GENERATED_TRACKS = 1000;

const FIRST_ROW_TITLE = "Rotten Apple";

const askedSince = (player: FakePlayer, route: string, from: number) =>
	player.requests
		.slice(from)
		.filter((entry) => entry.method === "GET" && routeOf(entry.path) === route);

const exportsSince = (player: FakePlayer, from: number) =>
	askedSince(player, EXPORT, from);

const loadingExportsSince = (player: FakePlayer, from: number) =>
	exportsSince(player, from).filter(
		(entry) =>
			new URLSearchParams(entry.path.split("?")[1]).get("spine") !== "false",
	);

const deltasSince = (player: FakePlayer, from: number) =>
	askedSince(player, CHANGES, from);

const grid = (page: Page) => page.getByRole("grid");

const expectLibraryDrawn = async (page: Page, count: number) => {
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(grid(page)).toHaveAttribute("aria-rowcount", String(count));
	await expect(trackRow(page, 0)).toContainText(FIRST_ROW_TITLE);
};

const ordinalTitled = (player: FakePlayer, title: string) =>
	player.ordinalOrder().findIndex((entry) => entry.track["%title%"] === title);

const playsOnFirstRow = (page: Page) =>
	trackRow(page, 0).locator("[data-zero]");

const countPlay = async (page: Page, player: FakePlayer, title: string) => {
	const answer = await page.request.post("/__control/play", {
		data: { ordinal: ordinalTitled(player, title) },
	});
	expect(answer.ok(), "the fake counts a play by ordinal").toBe(true);
};

type StoredField = "declaration" | "format" | "apiVersion" | "build";

const READ_STORED = `
const isPlain = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value) &&
	!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer) && !(value instanceof Blob);
const describing = (value, depth = 0) => {
	if (!isPlain(value) || depth > 3) return null;
	if (typeof value.snapshotId === "string") return value;
	for (const inner of Object.values(value)) {
		const found = describing(inner, depth + 1);
		if (found) return found;
	}
	return null;
};
// A database deleted since it was listed would be created again, empty, by opening it, so that open
// is abandoned rather than left for Jean to find.
const opened = (name) => new Promise((resolve) => {
	const request = indexedDB.open(name);
	request.onupgradeneeded = () => request.transaction.abort();
	request.onsuccess = () => resolve(request.result);
	request.onerror = () => resolve(null);
});
const walk = async (visit, mode = "readonly") => {
	for (const { name } of await indexedDB.databases()) {
		const db = await opened(name);
		if (!db) continue;
		for (const store of [...db.objectStoreNames]) {
			await new Promise((resolve, reject) => {
				const transaction = db.transaction(store, mode);
				const cursor = transaction.objectStore(store).openCursor();
				cursor.onsuccess = () => {
					const at = cursor.result;
					if (!at) return;
					visit(at);
					at.continue();
				};
				transaction.oncomplete = resolve;
				transaction.onerror = () => reject(transaction.error);
			});
		}
		db.close();
	}
};
`;

const storedCopies = (page: Page) =>
	page.evaluate(
		`(async () => { ${READ_STORED}
			const found = [];
			await walk((at) => { const copy = describing(at.value); if (copy) found.push(copy.snapshotId); });
			return found;
		})()`,
	) as Promise<string[]>;

const storedRecords = (page: Page) =>
	page.evaluate(
		`(async () => { ${READ_STORED}
			let count = 0;
			await walk(() => { count += 1; });
			return count;
		})()`,
	) as Promise<number>;

const untilStored = async (page: Page, player: FakePlayer) => {
	const snapshotId = player.librarySnapshotId();
	await expect
		.configure({ soft: true })
		.poll(() => storedCopies(page), {
			message: `a stored copy of snapshot ${snapshotId}`,
		})
		.toContain(snapshotId);
};

const rewriteStored = (page: Page, field: StoredField) =>
	page.evaluate(
		`(async () => { ${READ_STORED}
			const other = (value) =>
				typeof value === "string" ? value + "-other" :
				typeof value === "number" ? value + 1 :
				Array.isArray(value) ? [...value, "%jean_other_column%"] :
				undefined;
			let rewritten = 0;
			await walk((at) => {
				const copy = describing(at.value);
				if (!copy || !(${JSON.stringify(field)} in copy)) return;
				const changed = other(copy[${JSON.stringify(field)}]);
				if (changed === undefined) return;
				copy[${JSON.stringify(field)}] = changed;
				at.update(at.value);
				rewritten += 1;
			}, "readwrite");
			return rewritten;
		})()`,
	) as Promise<number>;

const deleteEveryDatabase = (page: Page) =>
	page.evaluate(async () => {
		for (const { name } of await indexedDB.databases())
			await new Promise<void>((resolve, reject) => {
				const request = indexedDB.deleteDatabase(name as string);
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
				request.onblocked = () =>
					reject(new Error(`${name} is still open somewhere`));
			});
	});

const leaveJean = async (page: Page) => {
	await page.goto("/__control/state");
};

const loadJean = async (page: Page) => {
	await page.goto("/#/all");
};

const catalogue: Readonly<Record<string, unknown>> = en;

const phrase = (key: string) => {
	const text = catalogue[key];
	if (typeof text !== "string")
		throw new Error(`en.ts holds no phrase under ${key}`);
	return text;
};

const LOAD_FAILURES = [
	"library.readFailed",
	"library.readRefused",
	"library.readTimedOut",
	"library.readTooLarge",
	"library.readUnavailable",
	"library.readUnreachable",
	"library.halted.summary",
].map(phrase);

const RECORD_WHAT_IS_SAID = (failures: string[]) => {
	const said: string[] = [];
	(window as unknown as { said: string[] }).said = said;
	const note = (text: string) => {
		if (text && !said.includes(text)) said.push(text);
	};
	const look = () => {
		for (const region of document.querySelectorAll(
			'[role="status"], [role="alert"]',
		))
			note(region.textContent?.trim() ?? "");
		const shown = document.body?.textContent ?? "";
		for (const failure of failures) if (shown.includes(failure)) note(failure);
	};
	new MutationObserver(look).observe(document, {
		childList: true,
		subtree: true,
		characterData: true,
	});
};

const whatWasSaid = (page: Page) =>
	page.evaluate(() => (window as unknown as { said: string[] }).said);

// A worker runs none of a page's init scripts, so the same lines are put ahead of every script the
// page or a worker loads. They run once per scope.
const inEveryScope = async (page: Page, fault: string) => {
	const once = `if (!self.__storeFault) { self.__storeFault = true; ${fault} }`;
	await page.addInitScript(once);
	await page.context().route(/\/assets\/[^?]+\.js(\?|$)/, async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			body: `${once}\n${await response.text()}`,
		});
	});
};

const NO_INDEXED_DB = `
for (let scope = self; scope; scope = Object.getPrototypeOf(scope))
	if (Object.prototype.hasOwnProperty.call(scope, "indexedDB")) delete scope.indexedDB;
`;

// Quota and private browsing both refuse a write by aborting its transaction.
const WRITES_ABORT = `
for (const name of ["put", "add"]) {
	const original = IDBObjectStore.prototype[name];
	IDBObjectStore.prototype[name] = function (...args) {
		const request = original.apply(this, args);
		this.transaction.abort();
		return request;
	};
}
`;

const WRITES_THROW = `
for (const name of ["put", "add"])
	IDBObjectStore.prototype[name] = function () {
		throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
	};
`;

const restartPlayer = (
	fakeServer: { reset: (next: FakePlayer) => FakePlayer },
	retagged: Record<string, Track> = {},
) =>
	fakeServer.reset(
		createState({
			playlists: DEFAULT_PLAYLISTS(),
			retagged,
			fooJean: {
				libraryBuilds: 2,
				rateLimits: { ...COMPONENT_RATE_LIMITS },
			},
		}),
	);

const recordExportsDownloaded = (page: Page) => {
	const downloaded: { isLoading: boolean }[] = [];
	page.on("response", (response) => {
		const url = new URL(response.url());
		if (routeOf(url.pathname) !== EXPORT || response.status() !== 200) return;
		downloaded.push({ isLoading: url.searchParams.get("spine") !== "false" });
	});
	return downloaded;
};

const setKeepLibrary = async (page: Page, isKept: boolean) => {
	await openSettings(page);
	await settingsDialog(page)
		.getByRole("button", { name: phrase("settings.advanced.title") })
		.click();
	const keep = settingsDialog(page).getByRole("switch", {
		name: phrase("settings.advanced.keepLibrary"),
	});
	await keep.click();
	if (isKept) await expect(keep).toBeChecked();
	else await expect(keep).not.toBeChecked();
};

test.beforeEach(async ({ page }) => {
	await page.addInitScript(RECORD_WHAT_IS_SAID, LOAD_FAILURES);
});

test.describe("a reload draws the library Jean stored", () => {
	test("with nothing changed, it downloads nothing at all: no export and no delta", async ({
		page,
		player,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilStored(page, player);
		await untilQuiet(player);

		const from = player.requests.length;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);

		await expectSettlesAt(
			player,
			() => ({
				exports: exportsSince(player, from).length,
				deltas: deltasSince(player, from).length,
			}),
			{ exports: 0, deltas: 0 },
		);
	});

	test("after a play while Jean was closed, it asks only for the delta and draws the new count", async ({
		page,
		player,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const before = Number(await playsOnFirstRow(page).innerText());
		await untilStored(page, player);
		await untilQuiet(player);

		await leaveJean(page);
		await countPlay(page, player, FIRST_ROW_TITLE);
		const from = player.requests.length;
		await loadJean(page);

		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		await expectSettlesAt(player, () => exportsSince(player, from).length, 0);
		expect(deltasSince(player, from).length).toBeGreaterThan(0);
	});
});

test.describe("a reload after a track was added while Jean was closed", () => {
	test.use({ mediaLibrarySize: GENERATED_TRACKS });

	test("asks only for the splice from the stored pair and draws the new row", async ({
		page,
		player,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, GENERATED_TRACKS);
		await untilStored(page, player);
		await untilQuiet(player);

		await leaveJean(page);
		await page.request.post("/__control/library", { data: { add: 1 } });
		await page.request.get("/api/state");
		const from = player.requests.length;
		await loadJean(page);

		await expectLibraryDrawn(page, GENERATED_TRACKS + 1);
		await expectSettlesAt(player, () => exportsSince(player, from).length, 0);
		expect(deltasSince(player, from).length).toBeGreaterThan(0);
	});
});

test.describe("a reload after the player restarted", () => {
	test("on the same library, it draws the stored copy, downloads no export, and follows the new run", async ({
		page,
		player,
		fakeServer,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const snapshotId = player.librarySnapshotId();
		const before = Number(await playsOnFirstRow(page).innerText());
		await untilStored(page, player);
		await untilQuiet(player);

		await leaveJean(page);
		const restarted = restartPlayer(fakeServer);
		const downloaded = recordExportsDownloaded(page);
		await loadJean(page);

		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect
			.poll(() => restarted.librarySnapshotId(), {
				message: "the new run, once declared, names the same library",
			})
			.toBe(snapshotId);
		await untilQuiet(restarted);
		expect(downloaded).toEqual([]);

		await countPlay(page, restarted, FIRST_ROW_TITLE);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		await untilQuiet(restarted);
		expect(downloaded).toEqual([]);
	});

	test("on a library that changed meanwhile, the stored pair answers 409, so it exports and stores the new copy", async ({
		page,
		player,
		fakeServer,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const before = Number(await playsOnFirstRow(page).innerText());
		await untilStored(page, player);
		await untilQuiet(player);

		await leaveJean(page);
		const restarted = restartPlayer(fakeServer, {
			[FIRST_ROW_TITLE]: { "%lastfm_play_count%": String(before + 7) },
		});
		const downloaded = recordExportsDownloaded(page);
		await loadJean(page);

		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 7));
		await expect
			.poll(() => downloaded.filter((one) => one.isLoading).length)
			.toBeGreaterThan(0);
		await untilStored(page, restarted);
		await untilQuiet(restarted);

		const from = restarted.requests.length;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 7));
		await expectSettlesAt(
			restarted,
			() => exportsSince(restarted, from).length,
			0,
		);
	});
});

test.describe("a stored copy under another key is thrown away and the export fetched", () => {
	const KEYS: { field: StoredField; what: string }[] = [
		{ field: "declaration", what: "the column declaration" },
		{ field: "format", what: "the JLIB format" },
		{ field: "apiVersion", what: "the component's apiVersion" },
		{ field: "build", what: "Jean's build" },
	];

	for (const { field, what } of KEYS)
		test(`${what} differing alone exports again, and the next reload draws from the copy that replaced it`, async ({
			page,
			player,
		}) => {
			await loadJean(page);
			await expectLibraryDrawn(page, CAPTURED_TRACKS);
			await untilStored(page, player);
			await untilQuiet(player);

			await leaveJean(page);
			expect(
				await rewriteStored(page, field),
				`a stored copy carries \`${field}\` beside its snapshotId`,
			).toBeGreaterThan(0);
			const from = player.requests.length;
			await loadJean(page);

			await expectLibraryDrawn(page, CAPTURED_TRACKS);
			await expect
				.poll(() => loadingExportsSince(player, from).length)
				.toBeGreaterThan(0);
			await untilStored(page, player);
			await untilQuiet(player);

			const second = player.requests.length;
			await page.reload();
			await expectLibraryDrawn(page, CAPTURED_TRACKS);
			await expectSettlesAt(
				player,
				() => exportsSince(player, second).length,
				0,
			);
		});
});

test.describe("a delta the player cannot give", () => {
	test("a 410 for the stored pair exports again, and the next reload draws from the copy that replaced it", async ({
		page,
		player,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilStored(page, player);
		await untilQuiet(player);

		await leaveJean(page);
		await page.request.post("/__control/library", { data: { add: 100 } });
		await page.request.get("/api/state");
		const from = player.requests.length;
		await loadJean(page);

		await expectLibraryDrawn(page, CAPTURED_TRACKS + 100);
		const asked = deltasSince(player, from);
		expect(asked.length, "the stored pair was asked first").toBeGreaterThan(0);
		await expect
			.poll(() => loadingExportsSince(player, from).length)
			.toBeGreaterThan(0);
		await untilStored(page, player);
		await untilQuiet(player);

		const second = player.requests.length;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS + 100);
		await expectSettlesAt(player, () => exportsSince(player, second).length, 0);
	});
});

test.describe("no store to keep it in", () => {
	const expectLoadedFromTheNetworkSilently = async (
		page: Page,
		player: FakePlayer,
		from: number,
	) => {
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect
			.poll(() => loadingExportsSince(player, from).length)
			.toBeGreaterThan(0);
		await untilQuiet(player);
		expect(await whatWasSaid(page)).toEqual([]);
	};

	const FAULTS = [
		{ name: "a write whose transaction aborts", fault: WRITES_ABORT },
		{ name: "a write that throws", fault: WRITES_THROW },
		{ name: "no IndexedDB at all", fault: NO_INDEXED_DB },
	];

	for (const { name, fault } of FAULTS)
		test(`${name}: each load comes from the network, with no message`, async ({
			page,
			player,
		}) => {
			await inEveryScope(page, fault);

			await loadJean(page);
			await expectLoadedFromTheNetworkSilently(page, player, 0);

			const from = player.requests.length;
			await page.reload();
			await expectLoadedFromTheNetworkSilently(page, player, from);
		});

	test("a store evicted between two visits: the next load comes from the network, with no message", async ({
		page,
		player,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilStored(page, player);
		await untilQuiet(player);

		await leaveJean(page);
		await deleteEveryDatabase(page);
		const from = player.requests.length;
		await loadJean(page);

		await expectLoadedFromTheNetworkSilently(page, player, from);
	});
});

test.describe("the switch for keeping the library", () => {
	test("turned off, it drops what is stored and the next reload downloads the export; turned on again, the next load stores it", async ({
		page,
		player,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilStored(page, player);
		await untilQuiet(player);

		await setKeepLibrary(page, false);
		await expect
			.poll(() => storedRecords(page), { message: "records left stored" })
			.toBe(0);

		const off = player.requests.length;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect
			.poll(() => loadingExportsSince(player, off).length)
			.toBeGreaterThan(0);
		await untilQuiet(player);
		expect(await storedRecords(page), "nothing stored while off").toBe(0);

		await setKeepLibrary(page, true);
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilStored(page, player);
		await untilQuiet(player);

		const on = player.requests.length;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expectSettlesAt(player, () => exportsSince(player, on).length, 0);
	});
});

const PLAY_COUNT = "%lastfm_play_count%";
const LAST_PLAYED = "%lastfm_last_played%";

const PLAYED_BEFORE_THE_RESTART = "Nutshell";

const playsOn = (page: Page, title: string) =>
	rowByTitle(page, title).locator("[data-zero]");

const tagOf = (player: FakePlayer, title: string, tag: string) =>
	player.ordinalOrder()[ordinalTitled(player, title)].track[tag];

const countOf = (player: FakePlayer, title: string) =>
	tagOf(player, title, PLAY_COUNT);

test.describe("a copy adopted across a restart", () => {
	test("after a play Jean kept, a play on the new run shows the player's count, and no export is downloaded", async ({
		page,
		player,
		fakeServer,
	}) => {
		const counted = countOf(player, PLAYED_BEFORE_THE_RESTART);
		expect(
			player
				.ordinalOrder()
				.filter((entry) => entry.track[PLAY_COUNT] === counted),
			"one track holds the count Nutshell starts at",
		).toHaveLength(1);

		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const before = Number(await playsOnFirstRow(page).innerText());
		const played = String(Number(counted) + 1);
		await countPlay(page, player, PLAYED_BEFORE_THE_RESTART);
		await expect(playsOn(page, PLAYED_BEFORE_THE_RESTART)).toHaveText(played);
		const snapshotId = player.librarySnapshotId();
		await untilStored(page, player);
		await untilQuiet(player);

		await leaveJean(page);
		// foobar2000 keeps its tags across a restart, the stamp a play wrote included.
		const restarted = restartPlayer(fakeServer, {
			[PLAYED_BEFORE_THE_RESTART]: {
				[PLAY_COUNT]: played,
				[LAST_PLAYED]: tagOf(player, PLAYED_BEFORE_THE_RESTART, LAST_PLAYED),
			},
		});
		const downloaded = recordExportsDownloaded(page);
		await loadJean(page);

		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect
			.poll(() => restarted.librarySnapshotId(), {
				message: "the new run, once declared, names the library Jean kept",
			})
			.toBe(snapshotId);
		await untilQuiet(restarted);

		await countPlay(page, restarted, FIRST_ROW_TITLE);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		await expect(playsOn(page, PLAYED_BEFORE_THE_RESTART)).toHaveText(played);
		await untilQuiet(restarted);
		expect(downloaded, "exports downloaded after the restart").toEqual([]);

		await searchFor(page, PLAYED_BEFORE_THE_RESTART.toLowerCase());
		await expect(trackRow(page, 0)).toContainText(PLAYED_BEFORE_THE_RESTART);

		await untilStored(page, restarted);
		await untilQuiet(restarted);
		await loadJean(page);
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		await expect(playsOn(page, PLAYED_BEFORE_THE_RESTART)).toHaveText(played);
		await untilQuiet(restarted);
		expect(downloaded, "exports downloaded after the restart").toEqual([]);
	});
});

const ONE_FOLDER = { tracks: GENERATED_TRACKS };

const TITLE_ON_SCREEN = "Track 1";

const rowTitled = (page: Page, title: string) =>
	page.getByRole("row").filter({ has: page.getByText(title, { exact: true }) });

const playsOnRowTitled = (page: Page, title: string) =>
	rowTitled(page, title).locator("[data-zero]");

const APPENDED_OUT_OF_ORDER = [
	{ title: "Track 4", count: "0" },
	{ title: "Track 2", count: "1" },
	{ title: "Track 3", count: "10" },
];

const WRITTEN_AFTER_THE_RELOAD = "1";

const storeOutOfOrderCounts = async (page: Page, player: FakePlayer) => {
	const startedAt = countOf(player, TITLE_ON_SCREEN);
	expect(
		APPENDED_OUT_OF_ORDER.every(
			({ count }) => count !== startedAt && count < startedAt,
		),
		`every track starts at a count, ${startedAt}, that sorts after the counts set here`,
	).toBe(true);

	await loadJean(page);
	await expect(grid(page)).toHaveAttribute(
		"aria-rowcount",
		String(GENERATED_TRACKS),
	);
	await inSequence(APPENDED_OUT_OF_ORDER, ({ title, count }) =>
		setPlayCount(page, player, title, count),
	);
	await untilStored(page, player);
	await untilQuiet(player);
	await leaveJean(page);
	return player.librarySnapshotId();
};

const expectTheSameLibraryElsewhere = (
	player: FakePlayer,
	stored: { snapshotId: string; structure: number },
) => {
	expect(player.librarySnapshotId(), "the library as it was stored").toBe(
		stored.snapshotId,
	);
	expect(
		player.libraryFeed.structure,
		"the structure the library is at now",
	).not.toBe(stored.structure);
};

test.describe("a reload after a track was added and removed again while Jean was closed", () => {
	test.use({ libraryShape: ONE_FOLDER });

	test("a play after it shows the count the player wrote, and no export is downloaded", async ({
		page,
		player,
	}) => {
		const snapshotId = await storeOutOfOrderCounts(page, player);
		const stored = { snapshotId, structure: player.libraryFeed.structure };

		await page.request.post("/__control/library", { data: { add: 1 } });
		await page.request.get("/api/state");
		await page.request.post("/__control/library", { data: { remove: 1 } });
		await page.request.get("/api/state");
		expectTheSameLibraryElsewhere(player, stored);

		const downloaded = recordExportsDownloaded(page);
		await loadJean(page);
		await expect(grid(page)).toHaveAttribute(
			"aria-rowcount",
			String(GENERATED_TRACKS),
		);
		await untilQuiet(player);

		await setPlayCount(page, player, TITLE_ON_SCREEN, WRITTEN_AFTER_THE_RELOAD);
		await expect(playsOnRowTitled(page, TITLE_ON_SCREEN)).toHaveText(
			WRITTEN_AFTER_THE_RELOAD,
		);
		await untilQuiet(player);
		expect(downloaded, "exports downloaded").toEqual([]);
	});
});

test.describe("a reload after the player rebuilt the same tracks while Jean was closed", () => {
	test.use({ libraryShape: ONE_FOLDER });

	test("a play after it shows the count the player wrote, and no export is downloaded", async ({
		page,
		player,
	}) => {
		const snapshotId = await storeOutOfOrderCounts(page, player);
		const stored = { snapshotId, structure: player.libraryFeed.structure };

		player.fooJean.libraryRebuilds = 1;
		await page.request.get("/api/state");
		expectTheSameLibraryElsewhere(player, stored);

		const downloaded = recordExportsDownloaded(page);
		await loadJean(page);
		await expect(grid(page)).toHaveAttribute(
			"aria-rowcount",
			String(GENERATED_TRACKS),
		);
		await untilQuiet(player);

		await setPlayCount(page, player, TITLE_ON_SCREEN, WRITTEN_AFTER_THE_RELOAD);
		await expect(playsOnRowTitled(page, TITLE_ON_SCREEN)).toHaveText(
			WRITTEN_AFTER_THE_RELOAD,
		);
		await untilQuiet(player);
		expect(downloaded, "exports downloaded").toEqual([]);
	});
});

const RECORD_COUNTS_SHOWN = (title: string) => {
	const shown: string[] = [];
	(window as unknown as { countsShown: string[] }).countsShown = shown;
	const look = () => {
		for (const row of document.querySelectorAll('[role="row"]')) {
			if (!row.textContent?.includes(title)) continue;
			const count = row.querySelector("[data-zero]")?.textContent ?? "";
			if (count && !shown.includes(count)) shown.push(count);
		}
	};
	new MutationObserver(look).observe(document, {
		childList: true,
		subtree: true,
		characterData: true,
	});
};

const countsShown = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { countsShown: string[] }).countsShown,
	);

const holdChanges = async (page: Page) => {
	let release = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let asked = 0;
	await page.route(
		(url) => routeOf(url.pathname) === CHANGES,
		async (route) => {
			asked += 1;
			await released;
			await route.continue();
		},
	);
	return { asked: () => asked, release };
};

const WHILE_HELD_MS = 750;

test.describe("a reload after the library changed while Jean was closed", () => {
	test("draws nothing of the stored copy until the changes from its pair have landed", async ({
		page,
		player,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const before = Number(await playsOnFirstRow(page).innerText());
		await untilStored(page, player);
		await untilQuiet(player);

		await leaveJean(page);
		await countPlay(page, player, FIRST_ROW_TITLE);
		await page.addInitScript(RECORD_COUNTS_SHOWN, FIRST_ROW_TITLE);
		const changes = await holdChanges(page);
		await loadJean(page);

		await expect
			.poll(changes.asked, { message: "the changes from the stored pair" })
			.toBeGreaterThan(0);
		await page.waitForTimeout(WHILE_HELD_MS);
		expect(
			await countsShown(page),
			"counts drawn while the changes were held",
		).toEqual([]);

		changes.release();
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		expect(await countsShown(page)).toEqual([String(before + 1)]);
	});
});

// Every page of Jean on the origin shares the one database, and each holds a connection to it from
// its own worker for as long as it is open.
test.describe("two tabs of Jean", () => {
	test("keeping turned off and on in one leaves both storing and drawing the library on their next reload", async ({
		page,
		player,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const before = Number(await playsOnFirstRow(page).innerText());
		await untilStored(page, player);
		await untilQuiet(player);

		const other = await page.context().newPage();
		await loadJean(other);
		await expectLibraryDrawn(other, CAPTURED_TRACKS);
		await untilQuiet(player);

		await openSettings(page);
		await settingsDialog(page)
			.getByRole("button", { name: phrase("settings.advanced.title") })
			.click();
		const keep = settingsDialog(page).getByRole("switch", {
			name: phrase("settings.advanced.keepLibrary"),
		});
		await keep.click();
		await expect(keep).not.toBeChecked();
		await keep.click();
		await expect(keep).toBeChecked();

		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilStored(page, player);
		await untilQuiet(player);

		const second = player.requests.length;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expectSettlesAt(player, () => exportsSince(player, second).length, 0);

		await countPlay(page, player, FIRST_ROW_TITLE);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		await expect(playsOnFirstRow(other)).toHaveText(String(before + 1));
		await untilStored(page, player);
		await untilQuiet(player);

		const third = player.requests.length;
		await other.reload();
		await expectLibraryDrawn(other, CAPTURED_TRACKS);
		await expect(playsOnFirstRow(other)).toHaveText(String(before + 1));
		await expectSettlesAt(player, () => exportsSince(player, third).length, 0);
	});
});

const OPEN_NEVER_ANSWERS = `
IDBFactory.prototype.open = function () {
	const request = new EventTarget();
	Object.assign(request, {
		readyState: "pending",
		onsuccess: null,
		onerror: null,
		onblocked: null,
		onupgradeneeded: null,
	});
	return request;
};
`;

const RECORD_FIRST_ROW = (title: string) => {
	const seen = window as unknown as { firstRowAt: number | null };
	seen.firstRowAt = null;
	const look = () => {
		if (seen.firstRowAt !== null) return;
		for (const row of document.querySelectorAll('[role="row"]'))
			if (row.textContent?.includes(title)) {
				seen.firstRowAt = performance.now();
				return;
			}
	};
	new MutationObserver(look).observe(document, {
		childList: true,
		subtree: true,
	});
};

const B6_MS: Record<string, number> = { desktop: 1_000, mobile: 2_000 };
const SMALL_BOUND_MS = 1_000;

test.describe("an IndexedDB whose open never answers", () => {
	test("a reload loads from the network within a second on desktop, two on mobile, and a small bound", async ({
		page,
		player,
	}, testInfo) => {
		await inEveryScope(page, OPEN_NEVER_ANSWERS);
		await page.addInitScript(RECORD_FIRST_ROW, FIRST_ROW_TITLE);

		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilQuiet(player);

		const from = player.requests.length;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const firstRowAt = await page.evaluate(
			() => (window as unknown as { firstRowAt: number | null }).firstRowAt,
		);
		expect(
			firstRowAt,
			"ms from navigation to the first row",
		).toBeLessThanOrEqual(B6_MS[testInfo.project.name] + SMALL_BOUND_MS);
		expect(loadingExportsSince(player, from).length).toBeGreaterThan(0);
	});
});

const MORE_THAN_KEPT = 70;

test.describe("a copy that has kept many changes", () => {
	test(`after ${MORE_THAN_KEPT} plays while open, a reload draws from the store and downloads no export`, async ({
		page,
		player,
	}) => {
		test.setTimeout(240_000);

		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const before = Number(await playsOnFirstRow(page).innerText());
		await untilStored(page, player);
		await untilQuiet(player);

		await times(MORE_THAN_KEPT, async (index) => {
			await countPlay(page, player, FIRST_ROW_TITLE);
			await expect(playsOnFirstRow(page)).toHaveText(
				String(before + index + 1),
			);
		});
		await untilStored(page, player);
		await untilQuiet(player);

		const from = player.requests.length;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect(playsOnFirstRow(page)).toHaveText(
			String(before + MORE_THAN_KEPT),
		);
		await expectSettlesAt(player, () => exportsSince(player, from).length, 0);
	});
});

const PLAYS_PAST_THE_FIRST_RENEWAL = 6;
const RENEWALS_ALLOWED_MEANWHILE = 1;
const KEPT_BEFORE_A_RENEWAL = 64;

test.describe("a copy that has kept many changes, whose renewal the player refuses", () => {
	test(`the ${PLAYS_PAST_THE_FIRST_RENEWAL} plays after the refusal do not each ask for the export again`, async ({
		page,
		player,
	}) => {
		test.setTimeout(240_000);

		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const before = Number(await playsOnFirstRow(page).innerText());
		await untilStored(page, player);
		await untilQuiet(player);

		player.fooJean.failLibraryExport = { status: 500, times: 1_000 };
		const from = player.requests.length;
		const play = async (index: number) => {
			await countPlay(page, player, FIRST_ROW_TITLE);
			await expect(playsOnFirstRow(page)).toHaveText(
				String(before + index + 1),
			);
		};

		await times(KEPT_BEFORE_A_RENEWAL + 1, play);
		await expect
			.poll(() => loadingExportsSince(player, from).length, {
				message: "the renewal was asked for once the copy outgrew its changes",
			})
			.toBeGreaterThan(0);
		await untilQuiet(player);
		const refused = loadingExportsSince(player, from).length;

		await times(PLAYS_PAST_THE_FIRST_RENEWAL, (index) =>
			play(KEPT_BEFORE_A_RENEWAL + 1 + index),
		);
		await untilQuiet(player);
		expect(
			loadingExportsSince(player, from).length - refused,
			`exports asked for over the ${PLAYS_PAST_THE_FIRST_RENEWAL} plays after the refused one`,
		).toBeLessThanOrEqual(RENEWALS_ALLOWED_MEANWHILE);
	});
});

const QUOTA_AFTER_BYTES = 10 * 1024 * 1024;
const QUOTA_CHANNEL = "jean-test-quota";

const QUOTA = `
let written = 0;
let announced = false;
const sizeOf = (value, depth = 0) => {
	if (value instanceof ArrayBuffer) return value.byteLength;
	if (ArrayBuffer.isView(value)) return value.byteLength;
	if (value instanceof Blob) return value.size;
	if (typeof value === "string") return value.length;
	if (!value || typeof value !== "object" || depth > 3) return 0;
	let size = 0;
	for (const inner of Object.values(value)) size += sizeOf(inner, depth + 1);
	return size;
};
for (const name of ["put", "add"]) {
	const original = IDBObjectStore.prototype[name];
	IDBObjectStore.prototype[name] = function (value, ...rest) {
		const request = original.call(this, value, ...rest);
		written += sizeOf(value);
		if (written > ${QUOTA_AFTER_BYTES}) {
			this.transaction.abort();
			if (!announced) new BroadcastChannel("${QUOTA_CHANNEL}").postMessage("refused");
			announced = true;
		}
		return request;
	};
}
`;

const HEAR_THE_QUOTA = (channel: string) => {
	const heard = window as unknown as { quotaRefused: boolean };
	heard.quotaRefused = false;
	new BroadcastChannel(channel).onmessage = () => {
		heard.quotaRefused = true;
	};
};

const quotaRefused = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { quotaRefused: boolean }).quotaRefused,
	);

const inTheWorkerWhile = async (
	page: Page,
	fault: string,
	isOn: () => boolean,
) => {
	const once = `if (typeof WorkerGlobalScope !== "undefined" && !self.__storeFault) { self.__storeFault = true; ${fault} }`;
	await page.context().route(/\/assets\/[^?]+\.js(\?|$)/, async (route) => {
		const response = await route.fetch();
		const body = await response.text();
		await route.fulfill({
			response,
			body: isOn() ? `${once}\n${body}` : body,
		});
	});
};

const setPlayCount = async (
	page: Page,
	player: FakePlayer,
	title: string,
	count: string,
) => {
	const answer = await page.request.post("/__control/play", {
		data: { ordinal: ordinalTitled(player, title), count },
	});
	expect(answer.ok(), "the fake sets a play count by ordinal").toBe(true);
	expect(countOf(player, title) === count, "the fake holds the count set").toBe(
		true,
	);
};

const paddedPastTheQuota = (count: string) =>
	count + " ".repeat(QUOTA_AFTER_BYTES + 3 * 1024 * 1024);

test.describe("a change whose write was cut short", () => {
	test("the store still draws the library on later reloads, once a shorter change was kept in its place", async ({
		page,
		player,
		fakeServer,
	}) => {
		let isFull = false;
		await inTheWorkerWhile(page, QUOTA, () => isFull);
		await page.addInitScript(HEAR_THE_QUOTA, QUOTA_CHANNEL);

		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const before = Number(await playsOnFirstRow(page).innerText());
		await untilStored(page, player);
		await untilQuiet(player);

		isFull = true;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilQuiet(player);
		await setPlayCount(
			page,
			player,
			FIRST_ROW_TITLE,
			paddedPastTheQuota(String(before)),
		);
		await expect
			.poll(() => quotaRefused(page), {
				message: "the store tried to write the change",
			})
			.toBe(true);
		await untilQuiet(player);
		isFull = false;

		await leaveJean(page);
		const restarted = restartPlayer(fakeServer);
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilQuiet(restarted);
		await countPlay(page, restarted, FIRST_ROW_TITLE);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		await untilStored(page, restarted);
		await untilQuiet(restarted);

		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		await untilStored(page, restarted);
		await untilQuiet(restarted);

		const from = restarted.requests.length;
		await page.reload();
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		await expectSettlesAt(
			restarted,
			() => exportsSince(restarted, from).length,
			0,
		);
	});
});

test.describe("a reload after a cell changed and changed back while Jean was closed", () => {
	test("draws the copy, and the next play downloads no export", async ({
		page,
		player,
	}) => {
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		const before = Number(await playsOnFirstRow(page).innerText());
		const snapshotId = player.librarySnapshotId();
		await untilStored(page, player);
		await untilQuiet(player);

		await leaveJean(page);
		await setPlayCount(page, player, FIRST_ROW_TITLE, String(before + 500));
		await setPlayCount(page, player, FIRST_ROW_TITLE, String(before));
		expect(player.librarySnapshotId(), "the library as it was stored").toBe(
			snapshotId,
		);
		const downloaded = recordExportsDownloaded(page);
		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await untilQuiet(player);

		await countPlay(page, player, FIRST_ROW_TITLE);
		await expect(playsOnFirstRow(page)).toHaveText(String(before + 1));
		await untilQuiet(player);
		expect(downloaded, "exports downloaded").toEqual([]);
	});
});

const isLatePart = (path: string) =>
	routeOf(path) === EXPORT &&
	new URLSearchParams(path.split("?")[1]).get("spine") === "false";

const PAST_THE_FIRST_RETRY_MS = 8_000;

test.describe("a late part the player refuses", () => {
	test.describe("as too large", () => {
		test.use({ fooJean: { holdSubset: [...LATE_EXPRESSIONS] } });

		test("is asked for once, and the page says the library is too large", async ({
			page,
			player,
		}) => {
			const lateAsks = () =>
				player.requests.filter(
					(entry) => entry.method === "GET" && isLatePart(entry.path),
				).length;

			await loadJean(page);
			await expectLibraryDrawn(page, CAPTURED_TRACKS);
			await expect.poll(lateAsks, { message: "the late part held" }).toBe(1);

			player.fooJean.libraryCeiling = 1;
			await page.request.post("/__control/holdSubset", { data: {} });

			await page.waitForTimeout(PAST_THE_FIRST_RETRY_MS);
			expect(lateAsks(), "times the late part was asked for").toBe(1);
			await expect(
				page.getByText(phrase("library.readTooLarge")).first(),
			).toBeVisible();
		});
	});

	test("refused as a bad request, is asked for once, and the page says the columns were refused", async ({
		page,
	}) => {
		const asked: string[] = [];
		page.on("request", (request) => {
			const url = new URL(request.url());
			if (isLatePart(`${url.pathname}${url.search}`)) asked.push(request.url());
		});
		let drawn = () => {};
		const isDrawn = new Promise<void>((resolve) => {
			drawn = resolve;
		});
		await page.route(
			(url) => isLatePart(`${url.pathname}${url.search}`),
			async (route) => {
				await isDrawn;
				await route.fulfill({
					status: 400,
					contentType: "application/json",
					body: JSON.stringify({
						error: "unacceptable column",
						detail: "'only' names a column that is not declared",
					}),
				});
			},
		);

		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		await expect.poll(() => asked.length).toBeGreaterThan(0);
		drawn();

		await page.waitForTimeout(PAST_THE_FIRST_RETRY_MS);
		expect(asked.length, "times the late part was asked for").toBe(1);
		await expect(
			page.getByText(phrase("library.readRefused")).first(),
		).toBeVisible();
	});
});

const ARTIST = "Babasónicos";

const REFUSALS = [
	{
		name: "as too large",
		said: "library.readTooLarge",
		refuse: async (route: Route, player: FakePlayer) => {
			player.fooJean.libraryCeiling = 1;
			await route.continue();
		},
	},
	{
		name: "as a bad request",
		said: "library.readRefused",
		refuse: (route: Route) =>
			route.fulfill({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({
					error: "unacceptable column",
					detail: "'only' names a column that is not declared",
				}),
			}),
	},
];

const holdTheLatePart = async (
	page: Page,
	player: FakePlayer,
	refuse: (route: Route, player: FakePlayer) => Promise<void>,
) => {
	let release = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(
		(url) => isLatePart(`${url.pathname}${url.search}`),
		async (route) => {
			await released;
			await refuse(route, player);
		},
	);
	return release;
};

const busyIn = (page: Page, scope: string) =>
	page.locator(`${scope}[aria-busy="true"], ${scope} [aria-busy="true"]`);

const visit = (page: Page, route: string) =>
	page.evaluate((hash) => {
		location.hash = hash;
	}, `#/${route}`);

for (const { name, said, refuse } of REFUSALS)
	test.describe(`a late part refused ${name}`, () => {
		test.describe("with the late columns shown", () => {
			test.skip(
				({ isMobile }) => isMobile,
				"a phone shows only time, plays and rating, none of them late",
			);
			test.use({ settings: { "jean.columns": ["codec", "bitrate"] } });

			test("leaves no row busy, and the page says why", async ({
				page,
				player,
			}) => {
				const release = await holdTheLatePart(page, player, refuse);
				await loadJean(page);
				await expectLibraryDrawn(page, CAPTURED_TRACKS);
				await expect(
					trackRow(page, 0),
					"a row waiting on the late columns",
				).toHaveAttribute("aria-busy", "true");

				release();
				await expect(page.getByText(phrase(said)).first()).toBeVisible();
				await expect(trackRow(page, 0)).toContainText(FIRST_ROW_TITLE);
				await expect(busyIn(page, '[role="grid"]')).toHaveCount(0);
			});
		});

		test("leaves Home, a shelf, an artist and the search's artists settled, and Play enabled", async ({
			page,
			player,
		}) => {
			const release = await holdTheLatePart(page, player, refuse);
			await loadJean(page);
			await expectLibraryDrawn(page, CAPTURED_TRACKS);
			release();
			await expect(page.getByText(phrase(said)).first()).toBeVisible();

			await visit(page, "home");
			await expect(
				page.getByRole("heading", { level: 2 }).first(),
			).toBeVisible();
			await expect(busyIn(page, "main"), "Home").toHaveCount(0);

			await visit(page, "shelf/added");
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			await expect(busyIn(page, "main"), "the shelf's page").toHaveCount(0);

			await visit(page, artistRoute(ARTIST));
			await expect(
				page.getByRole("heading", { level: 1, name: ARTIST }),
			).toBeVisible();
			await expect(
				page.getByRole("heading", { name: phrase("artist.discography") }),
			).toBeVisible();
			await expect(busyIn(page, "main"), "the artist's overview").toHaveCount(
				0,
			);

			await visit(page, artistRoute(ARTIST, "tracks"));
			await expect(
				page.locator("main").getByRole("button", { name: "Play", exact: true }),
			).toBeEnabled();
			await expect(busyIn(page, "main"), "the artist's tracks").toHaveCount(0);

			await revealSearch(page);
			await searchField(page).fill(ARTIST.slice(0, 5).toLowerCase());
			const results = page.getByRole("listbox");
			await expect(
				results
					.getByRole("option")
					.filter({ hasText: new RegExp(`^${ARTIST}`) }),
			).toBeVisible();
			await expect(
				busyIn(page, '[role="listbox"]'),
				"the search's artists",
			).toHaveCount(0);
		});
	});

// A failure arriving beside rows already drawn is heard by a screen reader only from a live region.
test.describe("a failure said beside the rows", () => {
	test("is announced, from a status region", async ({ page }) => {
		let drawn = () => {};
		const isDrawn = new Promise<void>((resolve) => {
			drawn = resolve;
		});
		await page.route(
			(url) => isLatePart(`${url.pathname}${url.search}`),
			async (route) => {
				await isDrawn;
				await route.fulfill({
					status: 400,
					contentType: "application/json",
					body: JSON.stringify({
						error: "unacceptable column",
						detail: "'only' names a column that is not declared",
					}),
				});
			},
		);

		await loadJean(page);
		await expectLibraryDrawn(page, CAPTURED_TRACKS);
		drawn();

		const said = page
			.locator("main")
			.getByText(phrase("library.readRefused"))
			.first();
		await expect(said).toBeVisible();
		await expect(trackRow(page, 0)).toContainText(FIRST_ROW_TITLE);
		const isLive = await said.evaluate(
			(element) =>
				element.closest(
					'[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]',
				) !== null,
		);
		expect(isLive, "the failure beside the rows sits in no live region").toBe(
			true,
		);
	});
});
