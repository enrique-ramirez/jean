import type { Page } from "./fixtures.ts";
import { expect, openLibrary, statusBar, test, trackRow } from "./fixtures.ts";

const dropTheStream = async (page: Page) => {
	const answer = await page.request.post("/__control/dropStream");
	const { dropped } = (await answer.json()) as { dropped: number };
	// A test that dropped nothing would assert that the app survived an event
	// that never happened.
	expect(dropped, "no update stream was open to drop").toBeGreaterThan(0);
};

test.describe("the update stream going away", () => {
	test("the app catches up with what the desktop did while it was gone", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(statusBar(page)).toContainText("Los Calientes");

		await dropTheStream(page);

		// Driven on the player, so nothing Jean did can be what brings it back:
		// somebody at the desktop pressed next while the phone's wifi was out.
		player.playItem("p7", 1);

		await expect(statusBar(page)).toContainText("Fizz");
		await expect(trackRow(page, 1)).toHaveAttribute("data-active", "true");
	});

	test("a playlist changed while it was gone still shows up", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");

		await dropTheStream(page);

		player.copyItems("p5", "p7", [0]);
		player.notifyPlaylists();

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "55");
	});

	test("the transport still works after the reconnect", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(statusBar(page)).toContainText("Los Calientes");

		await dropTheStream(page);
		player.playItem("p7", 1);
		await expect(statusBar(page)).toContainText("Fizz");

		// A reconnect that left two streams open, or none, shows up here: the
		// button reads its state from the snapshot the live one is pushing.
		await statusBar(page)
			.getByRole("button", { name: "Pause", exact: true })
			.click();
		await expect.poll(() => player.player.playbackState).toBe("paused");
		await expect(
			statusBar(page).getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
	});
});
