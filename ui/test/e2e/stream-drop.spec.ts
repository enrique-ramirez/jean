import {
	expect,
	globalControls,
	openLibrary,
	test,
	trackRow,
} from "./fixtures.ts";

// What the player is doing arrives on the component's poll alone, so recovering from an outage is
// the poll picking up where a failed tick left off.
test.describe("a poll cut off mid-flight", () => {
	test("a playlist changed while it was gone still shows up", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");

		player.fooJean.failState = 503;
		const droppedAt = player.requests.length;
		await expect.poll(() => player.requests.length).toBeGreaterThan(droppedAt);

		player.copyItems("p5", "p7", [0]);
		player.notifyPlaylists();

		player.fooJean.failState = null;

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "55");
	});

	test("a track queued while it was gone still shows up", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		const queue = (await globalControls(page, isMobile)).getByRole("button", {
			name: /^Queue/,
		});
		await expect(queue).toHaveAccessibleName("Queue");

		player.fooJean.failState = 503;
		const droppedAt = player.requests.length;
		await expect.poll(() => player.requests.length).toBeGreaterThan(droppedAt);

		// Queued at the desktop, so nothing Jean did can be what brings it back.
		expect(player.queueAdd("p7", 3)).toBe(true);

		player.fooJean.failState = null;

		await expect(queue).toHaveAccessibleName("Queue, 1 track");
	});
});
