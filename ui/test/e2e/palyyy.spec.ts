import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	openLibrary,
	pressAndHold,
	statusBar,
	test,
	viewHeader,
} from "./fixtures.ts";

const MAY_THE_TENTH = new Date(2026, 4, 10, 12);
const HOLD_MS = 520;

const playToggle = (page: Page) =>
	statusBar(page).getByRole("button", { name: "Play", exact: true });

const asksToPlay = (player: FakePlayer) =>
	player.requests
		.filter((entry) => entry.method === "POST")
		.map((entry) => entry.path.split("?")[0])
		.filter((path) => /^\/api\/playback\/|\/play$/.test(path));

const holdWithTheMouse = async (page: Page, target: Locator) => {
	const box = (await target.boundingBox()) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(HOLD_MS);
	await page.mouse.up();
};

test.describe("palyyy", () => {
	test("holding the play button is answered in kind, and plays nothing", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		const toggle = playToggle(page);

		if (test.info().project.name === "mobile") await pressAndHold(page, toggle);
		else await holdWithTheMouse(page, toggle);

		await expect(
			page.getByRole("status").filter({ hasText: "Palyyy" }),
		).toBeVisible();
		await expect(toggle).toBeVisible();
		await expectSettlesAt(player, () => asksToPlay(player), []);
		expect(player.player.playbackState).toBe("stopped");
	});

	test("on May the 10th the word is respelled on screen, and not for a screen reader", async ({
		page,
	}) => {
		await page.clock.setFixedTime(MAY_THE_TENTH);
		await openLibrary(page);

		await expect(
			viewHeader(page).getByRole("button", { name: "Palyyy", exact: true }),
		).toBeVisible();
		await expect(playToggle(page)).toBeVisible();
	});
});
