import type { Page } from "./fixtures.ts";
import { expect, openLibrary, statusBar, test, trackRow } from "./fixtures.ts";

// The elapsed / total readout is also a button: pressing it swaps the left-hand
// figure for how much of the track is left.

test.describe("the clock in the status bar", () => {
	const clock = (page: Page) =>
		statusBar(page).getByRole("button", { name: /\d+:\d\d \/ \d+:\d\d/ });

	test("switches between elapsed and remaining, and remembers which", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the readout is desktop-only");

		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect
			.poll(() => player.player.playbackState, { timeout: 5000 })
			.toBe("playing");

		await expect(clock(page)).not.toContainText("-");

		await clock(page).click();
		await expect(clock(page)).toContainText("-");

		await page.reload();
		await expect(clock(page)).toContainText("-");

		await clock(page).click();
		await expect(clock(page)).not.toContainText("-");
	});

	test("counts down against the same total it counts up to", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "the readout is desktop-only");

		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect
			.poll(() => player.player.playbackState, { timeout: 5000 })
			.toBe("playing");

		const read = async () => {
			const text = (await clock(page).textContent()) ?? "";
			const [left, total] = text.split("/").map((part) => part.trim());
			const secs = (t: string) => {
				const [m, s] = t.replace("-", "").split(":").map(Number);
				return m * 60 + s;
			};
			return { left: secs(left), total: secs(total) };
		};

		const up = await read();
		await clock(page).click();
		const down = await read();

		expect(down.total).toBe(up.total);
		expect(Math.abs(up.left + down.left - up.total)).toBeLessThanOrEqual(2);
	});
});
