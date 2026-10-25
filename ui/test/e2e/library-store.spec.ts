import {
	albumRoute,
	href,
	searchRoute,
} from "../../src/domain/track/routes.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	guidOfPlaylist,
	nowPlayingScreen,
	openSettings,
	test,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";

// The library lives in foo_jean and Jean asks it for the rows on screen, so the browser holds no copy
// of it: no worker keeps one and no database stores one.

const LEFT_BEHIND = "jean-library";

declare global {
	interface Window {
		__opened: string[];
	}
}

const recordDatabasesOpened = (page: Page) =>
	page.addInitScript(() => {
		window.__opened = [];
		const open = IDBFactory.prototype.open;
		IDBFactory.prototype.open = function (name: string, version?: number) {
			window.__opened.push(name);
			return open.call(this, name, version);
		};
	});

const databasesOpened = (page: Page) => page.evaluate(() => window.__opened);

const databasesHeld = (page: Page) =>
	page.evaluate(async () =>
		(await indexedDB.databases()).map((database) => database.name),
	);

// A page on Jean's origin that is not Jean, so the database is in place before Jean first loads.
const leaveADatabaseBehind = async (page: Page) => {
	await page.goto("/api/capabilities");
	await page.evaluate(
		(name) =>
			new Promise<void>((resolve, reject) => {
				const request = indexedDB.open(name, 1);
				request.onupgradeneeded = () =>
					request.result.createObjectStore("chunks").put(new Uint8Array(64), 0);
				request.onsuccess = () => {
					request.result.close();
					resolve();
				};
				request.onerror = () => reject(request.error);
			}),
		LEFT_BEHIND,
	);
};

const expectRowsDrawn = async (page: Page) => {
	await expect(trackRow(page, 0)).toBeVisible();
	await expect(trackRow(page, 0)).not.toHaveAttribute("aria-busy", "true");
};

const heading = (page: Page, name: string) =>
	page.getByRole("heading", { level: 1, name, exact: true });

interface Visit {
	name: string;
	open: (page: Page, player: FakePlayer) => Promise<void>;
}

const VISITS: Visit[] = [
	{
		name: "All Music",
		open: async (page) => {
			await page.goto("/#/all");
			await expect(heading(page, en["library.allMusic"])).toBeVisible();
			await expectRowsDrawn(page);
		},
	},
	{
		name: "an album",
		open: async (page) => {
			await page.goto(`/${href(albumRoute("Babasónicos", "Jessico"))}`);
			await expect(heading(page, "Jessico")).toBeVisible();
			await expectRowsDrawn(page);
		},
	},
	{
		name: "search results",
		open: async (page) => {
			await page.goto(`/${href(searchRoute("Babas"))}`);
			await expect(heading(page, "Babas")).toBeVisible();
			await expectRowsDrawn(page);
		},
	},
	{
		name: "a playlist",
		open: async (page, player) => {
			await page.goto(`/#/${guidOfPlaylist(player, "p7")}`);
			await expect(heading(page, "Library")).toBeVisible();
			await expectRowsDrawn(page);
		},
	},
	{
		name: "Home",
		open: async (page) => {
			await page.goto("/");
			await expect(
				page.getByRole("heading", { level: 1 }).first(),
			).toBeVisible();
		},
	},
	{
		name: "Now playing",
		open: async (page, player) => {
			player.playItem("p7", 2);
			await page.goto("/#/playing");
			await expect(nowPlayingScreen(page)).toBeVisible();
			await expect(nowPlayingScreen(page)).toContainText("Deléctrico");
		},
	},
	{
		name: "Settings",
		open: async (page) => {
			await page.goto("/");
			await openSettings(page);
		},
	},
];

for (const visit of VISITS)
	test(`opening ${visit.name} starts no worker and opens no IndexedDB database`, async ({
		page,
		player,
	}) => {
		const workers: string[] = [];
		page.on("worker", (worker) => workers.push(worker.url()));
		await recordDatabasesOpened(page);

		await visit.open(page, player);
		await untilQuiet(player);

		expect(workers).toEqual([]);
		expect(await databasesOpened(page)).toEqual([]);
	});

test("a jean-library database left on the device is deleted on Jean's first load, and stays gone across a reload", async ({
	page,
	player,
}) => {
	await leaveADatabaseBehind(page);
	expect(await databasesHeld(page)).toContain(LEFT_BEHIND);

	await VISITS[0].open(page, player);
	await expect
		.poll(() => databasesHeld(page), {
			message: "the database Jean left behind is still on the device",
		})
		.not.toContain(LEFT_BEHIND);

	await page.reload();
	await expectRowsDrawn(page);
	await untilQuiet(player);
	expect(await databasesHeld(page)).not.toContain(LEFT_BEHIND);
});
