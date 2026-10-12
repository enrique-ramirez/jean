import { albumRoute } from "../../src/domain/track/routes.ts";
import { evaluate } from "../fake-api/titleFormat.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	playedFrom,
	sidebar,
	test,
	titleOfPlaylist,
	titlesIn,
	trackRow,
} from "./fixtures.ts";
import { dragFrom } from "./gestures.ts";
import { queueButton } from "./queue.ts";

const FAVORITES = "p2";
const DEFAULT_PLAYLIST = "p1";
const SECOND_ALBUM = { start: 3, count: 2 };

test.use({ settings: { "jean.layout": "album" } });

test.skip(
	({ isMobile }) => isMobile,
	"drag and double-click are the mouse's; touch has the menu",
);

const cover = (page: Page, album: number) =>
	page.locator("main [data-album-cover]").nth(album);

const album = (page: Page, at: number) =>
	page.locator("main [data-span-start]").nth(at);

const openFavorites = async (page: Page, player: FakePlayer) => {
	await page.goto(`/#/${guidOfPlaylist(player, FAVORITES)}`);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: titleOfPlaylist(player, FAVORITES),
		}),
	).toBeVisible();
	await expect(cover(page, 2)).toBeVisible();
	return titlesIn(player, FAVORITES);
};

const sidebarRow = (page: Page, title: string) =>
	sidebar(page)
		.locator("> div")
		.filter({ has: page.getByText(title, { exact: true }) });

const moveOver = async (page: Page, onto: Locator, fraction: number) => {
	const box = (await onto.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height * fraction, {
		steps: 16,
	});
};

const pressOn = async (page: Page, source: Locator) => {
	const box = (await source.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
};

const secondAlbumTitles = (titles: unknown[]) =>
	titles.slice(SECOND_ALBUM.start, SECOND_ALBUM.start + SECOND_ALBUM.count);

test("pressing a cover selects every track of its album and nothing else", async ({
	page,
	player,
}) => {
	await openFavorites(page, player);
	await cover(page, 1).click();

	const selected = page.locator('main [role="row"][aria-selected="true"]');
	await expect(selected).toHaveCount(SECOND_ALBUM.count);
	await expect(trackRow(page, SECOND_ALBUM.start)).toHaveAttribute(
		"aria-selected",
		"true",
	);
});

test("a cover dropped on a playlist in the sidebar copies its whole album there", async ({
	page,
	player,
}) => {
	const titles = await openFavorites(page, player);
	const before = titlesIn(player, DEFAULT_PLAYLIST);
	const target = sidebarRow(page, titleOfPlaylist(player, DEFAULT_PLAYLIST));

	await dragFrom(page, cover(page, 1), target);
	await expect(target).toHaveAttribute("data-drop-over", "true");
	await page.mouse.up();

	await expect
		.poll(() => titlesIn(player, DEFAULT_PLAYLIST))
		.toEqual([...before, ...secondAlbumTitles(titles)]);
});

test("a cover dropped on the queue button queues its whole album, in order", async ({
	page,
	player,
}) => {
	const titles = await openFavorites(page, player);

	await dragFrom(page, cover(page, 1), queueButton(page));
	await expect(queueButton(page)).toHaveAttribute("data-drop-over", "true");
	await page.mouse.up();

	await expect
		.poll(() => player.queuedEntries().map((entry) => entry.track["%title%"]))
		.toEqual(secondAlbumTitles(titles));
});

test("a cover dropped above the first album moves its album to the top, marking where it will land on the way", async ({
	page,
	player,
}) => {
	const titles = await openFavorites(page, player);
	const first = album(page, 0);

	await pressOn(page, cover(page, 1));
	await moveOver(page, first, 0.25);
	await expect(first).toHaveAttribute("data-drop-line", "before");
	await page.mouse.up();

	await expect
		.poll(() => titlesIn(player, FAVORITES))
		.toEqual([
			...secondAlbumTitles(titles),
			...titles.slice(0, SECOND_ALBUM.start),
			...titles.slice(SECOND_ALBUM.start + SECOND_ALBUM.count),
		]);
});

test("a cover dropped back on its own album sends nothing", async ({
	page,
	player,
}) => {
	await openFavorites(page, player);

	await pressOn(page, cover(page, 1));
	await moveOver(page, album(page, 1), 0.25);
	await expect(album(page, 1)).toHaveAttribute("data-drop-line", "before");
	await page.mouse.up();

	await expectSettlesAt(
		player,
		() =>
			player.requests.filter((entry) => entry.path.endsWith("/items/move"))
				.length,
		0,
	);
});

test("double-clicking a cover plays its album from the first track", async ({
	page,
	player,
}) => {
	await openFavorites(page, player);
	await cover(page, 1).dblclick();

	await expect
		.poll(() => playedFrom(player))
		.toEqual({
			id: guidOfPlaylist(player, FAVORITES),
			index: SECOND_ALBUM.start,
		});
});

test("the title beside a cover opens the album's own page", async ({
	page,
	player,
}) => {
	await openFavorites(page, player);
	const firstTrack = player.playlists.find((entry) => entry.id === FAVORITES)!
		.items[SECOND_ALBUM.start];
	const title = String(evaluate(firstTrack, "%album%"));
	const credit = String(evaluate(firstTrack, "$if2(%album artist%,%artist%)"));

	const link = album(page, 1).getByRole("link", { name: title, exact: true });
	await expect(link).toHaveAttribute("href", `#/${albumRoute(credit, title)}`);
	await link.click();

	await expect(
		page.getByRole("heading", { level: 1, name: title }),
	).toBeVisible();
});
